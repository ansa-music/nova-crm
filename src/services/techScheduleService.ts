import { deleteField, onSnapshot, query, setDoc, where, writeBatch, type FirestoreError, type WriteBatch } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths, withErrorReporting } from "@/firebase/firestore";
import { techScheduleId, type ScheduleDayState, type ScheduleHours, type TechSchedule } from "@/types";

/**
 * График месяца по всем технарям. Читают его все участники: «Заказы»
 * показывают, кто сегодня на выходном, а без этого ОС выдавал бы заказ
 * человеку, которого сегодня нет.
 */
export function subscribeTechSchedules(
  workspaceId: string,
  monthKey: string,
  /**
   * `fromServer` — снимок подтверждён сервером. Без сети SDK сразу отдаёт
   * снимок из кэша, и для непрочитанного ещё месяца он ПУСТОЙ: показывать его
   * можно, а править поверх него нельзя — шаблон недели счёл бы базу пустой.
   */
  onData: (schedules: TechSchedule[], fromServer: boolean) => void,
  onError?: (error: FirestoreError) => void
) {
  if (!db) {
    onData([], true);
    return () => {};
  }
  return onSnapshot(
    query(paths.techSchedulesAll(workspaceId), where("monthKey", "==", monthKey)),
    // Без includeMetadataChanges снимок «из кэша → с сервера» с тем же
    // содержимым не пришёл бы вовсе, и флаг навсегда остался бы «из кэша».
    { includeMetadataChanges: true },
    (snapshot) =>
      onData(
        snapshot.docs.map((d) => ({ ...(d.data() as TechSchedule), id: d.id })),
        !snapshot.metadata.fromCache
      ),
    withErrorReporting(onError)
  );
}

/**
 * Часы дня для записи с merge. Вложенная карта при merge СЛИВАЕТСЯ со
 * старой: без явного удаления подпись «10–12, 15–19» от прошлой смены
 * оставалась бы у новых часов и показывалась вместо них. `undefined`
 * внутри тоже нельзя — `ignoreUndefinedProperties` выключен.
 */
function hoursWrite(hours: ScheduleHours) {
  return { from: hours.from, to: hours.to || "", label: hours.label ? hours.label : deleteField() };
}

/**
 * Один день из меню дня (Тимлид/Owner). «Рабочий» — это УДАЛЕНИЕ ключа, а не
 * значение `"work"`: иначе в документе копились бы записи «рабочий», и
 * отличить «день не трогали» от «вернули в рабочие» стало бы невозможно.
 *
 * Снимает заодно отметку «пришёл в рабочий день» того же дня: если день
 * заново сделали выходным, старая отметка не должна молча это перебивать.
 */
export async function setScheduleDay(input: {
  workspaceId: string;
  uid: string;
  monthKey: string;
  dayKey: string;
  state: ScheduleDayState;
  actorUid: string;
}) {
  if (!db) throw new Error("Firebase не настроен");
  await setDoc(
    paths.techSchedule(input.workspaceId, techScheduleId(input.uid, input.monthKey)),
    {
      workspaceId: input.workspaceId,
      uid: input.uid,
      monthKey: input.monthKey,
      days: { [input.dayKey]: input.state === "work" ? deleteField() : input.state },
      selfWork: { [input.dayKey]: deleteField() },
      // Часы бывают только у рабочего дня. Оставленные под выходным, они
      // пропадали из клетки и меню, а при возврате дня в рабочие молча
      // всплывали — смена, которую никто уже не ставил.
      ...(input.state === "work" ? {} : { hours: { [input.dayKey]: deleteField() } }),
      updatedAt: Date.now(),
      updatedBy: input.actorUid,
    },
    { merge: true }
  );
}

/**
 * Отметка «пришёл в рабочий день»: человек вышел, хотя у него стоял выходной.
 * Ставит её ТОЛЬКО руководство — как и сам выходной. Раньше это мог сделать
 * сам технарь, но тогда у него в руках было состояние, которое переопределяет
 * отметку Тимлида, и график переставал быть документом руководителя.
 *
 * Поле в документе осталось `selfWork` — данные за прошлые месяцы лежат
 * именно под этим ключом, переименование их бы осиротило.
 */
export async function setCameToWorkDay(input: {
  workspaceId: string;
  uid: string;
  monthKey: string;
  dayKey: string;
  came: boolean;
  /**
   * Снять заодно часы дня. Нужно, когда «пришёл» снимают с дня, который под
   * отметкой остаётся выходным: часы, поставленные «пришедшему», иначе
   * оставались бы под выходным невидимыми и всплыли бы потом.
   */
  clearHours?: boolean;
  actorUid: string;
}) {
  if (!db) throw new Error("Firebase не настроен");
  await setDoc(
    paths.techSchedule(input.workspaceId, techScheduleId(input.uid, input.monthKey)),
    {
      workspaceId: input.workspaceId,
      uid: input.uid,
      monthKey: input.monthKey,
      selfWork: { [input.dayKey]: input.came ? true : deleteField() },
      ...(input.clearHours ? { hours: { [input.dayKey]: deleteField() } } : {}),
      updatedAt: Date.now(),
      updatedBy: input.actorUid,
    },
    { merge: true }
  );
}

/**
 * Гибридная смена: «с 12:00 до 15:00». День при этом остаётся рабочим —
 * часы лежат отдельным полем и на `days` не влияют, иначе человек с
 * частичной сменой выпадал бы из откликов на заказы целиком.
 */
export async function setScheduleHours(input: {
  workspaceId: string;
  uid: string;
  monthKey: string;
  dayKey: string;
  hours: ScheduleHours | null;
  actorUid: string;
}) {
  if (!db) throw new Error("Firebase не настроен");
  await setDoc(
    paths.techSchedule(input.workspaceId, techScheduleId(input.uid, input.monthKey)),
    {
      workspaceId: input.workspaceId,
      uid: input.uid,
      monthKey: input.monthKey,
      hours: { [input.dayKey]: input.hours ? hoursWrite(input.hours) : deleteField() },
      updatedAt: Date.now(),
      updatedBy: input.actorUid,
    },
    { merge: true }
  );
}

/**
 * Сохранение режима правки: выходные проставляют пачкой и жмут «Сохранить».
 * Всё уходит ОДНИМ batch — иначе полсотни кликов превратились бы в полсотни
 * записей, и на середине прерванное сохранение оставило бы месяц наполовину
 * правленым.
 */
export interface ScheduleDraftChange {
  uid: string;
  days?: Record<string, ScheduleDayState>;
  hours?: Record<string, ScheduleHours | null>;
}

export async function saveScheduleDraft(input: {
  workspaceId: string;
  monthKey: string;
  actorUid: string;
  /**
   * По человеку: день → состояние (`"work"` = убрать пометку) и день → часы
   * (`null` = снять часы). Шаблон недели раскладывает месяц разом, поэтому
   * тут легко набирается под сотню дней — всё равно один batch.
   */
  changes: ScheduleDraftChange[];
}) {
  if (!db) throw new Error("Firebase не настроен");
  if (input.changes.length === 0) return;
  const batch = writeBatch(db);
  addScheduleChangesToBatch(batch, input);
  await batch.commit();
}

/**
 * Те же записи, что у `saveScheduleDraft`, но в ЧУЖОЙ batch: неделя графика
 * пишет себя и раскладку по месяцам одной пачкой, чтобы после сбоя не
 * остаться с новой неделей и старым месяцем.
 */
export function addScheduleChangesToBatch(
  batch: WriteBatch,
  input: { workspaceId: string; monthKey: string; actorUid: string; changes: ScheduleDraftChange[] }
) {
  for (const change of input.changes) {
    const days: Record<string, unknown> = {};
    const selfWork: Record<string, unknown> = {};
    const hours: Record<string, unknown> = {};
    for (const [dayKey, state] of Object.entries(change.days ?? {})) {
      days[dayKey] = state === "work" ? deleteField() : state;
      // День снова рабочий или заново выходной — старая отметка «пришёл»
      // к нему уже не относится.
      selfWork[dayKey] = deleteField();
    }
    for (const [dayKey, value] of Object.entries(change.hours ?? {})) {
      hours[dayKey] = value ? hoursWrite(value) : deleteField();
    }
    // Выходной и «отпросился» снимают часы того же дня (см. setScheduleDay).
    for (const [dayKey, state] of Object.entries(change.days ?? {})) {
      if (state !== "work") hours[dayKey] = deleteField();
    }
    // ПУСТУЮ карту отправлять нельзя. SDK кладёт пустой объект в маску
    // обновления целиком («создать пустую карту»), и при merge:true сервер
    // ЗАМЕНЯЕТ всё поле на {}: сохранение одних выходных стирало человеку все
    // часы смен за месяц, а сохранение одних часов — все выходные,
    // «отпросился» и «пришёл». Поле уходит, только если в нём есть ключи.
    const data: Record<string, unknown> = {
      workspaceId: input.workspaceId,
      uid: change.uid,
      monthKey: input.monthKey,
      updatedAt: Date.now(),
      updatedBy: input.actorUid,
    };
    if (Object.keys(days).length > 0) data.days = days;
    if (Object.keys(selfWork).length > 0) data.selfWork = selfWork;
    if (Object.keys(hours).length > 0) data.hours = hours;
    batch.set(paths.techSchedule(input.workspaceId, techScheduleId(change.uid, input.monthKey)), data, { merge: true });
  }
}
