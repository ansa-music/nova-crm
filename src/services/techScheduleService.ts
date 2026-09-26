import { onSnapshot, query, where, type FirestoreError } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths, withErrorReporting } from "@/firebase/firestore";
import { watchSbDocs, type SbDoc } from "@/services/sb/docFeed";
import type { SbBackend } from "@/services/sb/sbCollections";
import { commitScheduleWrites, scheduleBackendFor, SCHED_DEL, SCHEDULE_FEED, type ScheduleWrite } from "@/services/scheduleStore";
import { techScheduleId, type ScheduleDayState, type ScheduleHours, type TechSchedule } from "@/types";

function monthOf(doc: SbDoc): TechSchedule {
  return { ...(doc.data as unknown as TechSchedule), id: doc.id };
}

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
  onError?: (error: FirestoreError) => void,
  /** Где график (useScheduleBackend); нет — по стору в момент подписки. */
  backend?: SbBackend | null
) {
  if (!db) {
    onData([], true);
    return () => {};
  }
  if ((backend ?? scheduleBackendFor(workspaceId)) === "supabase") {
    let fallback: (() => void) | null = null;
    const stop = watchSbDocs(
      SCHEDULE_FEED,
      workspaceId,
      { initial: (q) => q.eq("kind", "month").eq("month_key", monthKey), match: (d) => d.kind === "month" && d.data.monthKey === monthKey },
      (docs) => onData(docs.map(monthOf), true),
      {
        onError: (error) => onError?.(error as unknown as FirestoreError),
        onMissing: () => {
          fallback ??= subscribeTechSchedules(workspaceId, monthKey, onData, onError, "firestore");
        },
      }
    );
    return () => {
      stop();
      fallback?.();
    };
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
 * График ОДНОГО человека за месяц — для карточки «Мой график». Отдельный
 * точечный слушатель, а не общий список: карточка показывает эту и следующую
 * неделю и не зависит от того, какой месяц открыт в общей сетке.
 */
export function subscribeTechSchedule(
  workspaceId: string,
  uid: string,
  monthKey: string,
  onData: (schedule: TechSchedule | null) => void,
  onError?: (error: FirestoreError) => void,
  backend?: SbBackend | null
) {
  if (!db) {
    onData(null);
    return () => {};
  }
  const id = techScheduleId(uid, monthKey);
  if ((backend ?? scheduleBackendFor(workspaceId)) === "supabase") {
    let fallback: (() => void) | null = null;
    const stop = watchSbDocs(
      SCHEDULE_FEED,
      workspaceId,
      { initial: (q) => q.eq("kind", "month").eq("id", id), match: (d) => d.kind === "month" && d.id === id },
      (docs) => onData(docs[0] ? monthOf(docs[0]) : null),
      {
        onError: (error) => onError?.(error as unknown as FirestoreError),
        onMissing: () => {
          fallback ??= subscribeTechSchedule(workspaceId, uid, monthKey, onData, onError, "firestore");
        },
      }
    );
    return () => {
      stop();
      fallback?.();
    };
  }
  return onSnapshot(
    paths.techSchedule(workspaceId, id),
    (snapshot) => onData(snapshot.exists() ? { ...(snapshot.data() as TechSchedule), id: snapshot.id } : null),
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
  return { from: hours.from, to: hours.to || "", label: hours.label ? hours.label : SCHED_DEL };
}

function monthWrite(workspaceId: string, uid: string, monthKey: string, data: Record<string, unknown>): ScheduleWrite {
  return { kind: "month", id: techScheduleId(uid, monthKey), op: "merge", data: { workspaceId, uid, monthKey, ...data } };
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
  await commitScheduleWrites(input.workspaceId, [
    monthWrite(input.workspaceId, input.uid, input.monthKey, {
      days: { [input.dayKey]: input.state === "work" ? SCHED_DEL : input.state },
      selfWork: { [input.dayKey]: SCHED_DEL },
      // Часы бывают только у рабочего дня. Оставленные под выходным, они
      // пропадали из клетки и меню, а при возврате дня в рабочие молча
      // всплывали — смена, которую никто уже не ставил.
      ...(input.state === "work" ? {} : { hours: { [input.dayKey]: SCHED_DEL } }),
      updatedAt: Date.now(),
      updatedBy: input.actorUid,
    }),
  ]);
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
  await commitScheduleWrites(input.workspaceId, [
    monthWrite(input.workspaceId, input.uid, input.monthKey, {
      selfWork: { [input.dayKey]: input.came ? true : SCHED_DEL },
      ...(input.clearHours ? { hours: { [input.dayKey]: SCHED_DEL } } : {}),
      updatedAt: Date.now(),
      updatedBy: input.actorUid,
    }),
  ]);
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
  await commitScheduleWrites(input.workspaceId, [
    monthWrite(input.workspaceId, input.uid, input.monthKey, {
      hours: { [input.dayKey]: input.hours ? hoursWrite(input.hours) : SCHED_DEL },
      updatedAt: Date.now(),
      updatedBy: input.actorUid,
    }),
  ]);
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
  /**
   * Отметка «пришёл в рабочий день» (`selfWork`): true — поставить, false —
   * снять. Идёт ПОСЛЕ `days`, поэтому перебивает снятие отметки, которое
   * `days` делает у тронутого дня: так «Отменить» в окне человека
   * возвращает день целиком, вместе с «пришёл».
   */
  came?: Record<string, boolean>;
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
  if (input.changes.length === 0) return;
  await commitScheduleWrites(input.workspaceId, scheduleChangesToWrites(input));
}

/**
 * Те же записи, что у `saveScheduleDraft`, списком — в ЧУЖУЮ пачку: неделя
 * графика пишет себя и раскладку по месяцам одной пачкой, чтобы после сбоя
 * не остаться с новой неделей и старым месяцем.
 */
export function scheduleChangesToWrites(input: {
  workspaceId: string;
  monthKey: string;
  actorUid: string;
  changes: ScheduleDraftChange[];
}): ScheduleWrite[] {
  const writes: ScheduleWrite[] = [];
  for (const change of input.changes) {
    const days: Record<string, unknown> = {};
    const selfWork: Record<string, unknown> = {};
    const hours: Record<string, unknown> = {};
    for (const [dayKey, state] of Object.entries(change.days ?? {})) {
      days[dayKey] = state === "work" ? SCHED_DEL : state;
      // День снова рабочий или заново выходной — старая отметка «пришёл»
      // к нему уже не относится.
      selfWork[dayKey] = SCHED_DEL;
    }
    for (const [dayKey, came] of Object.entries(change.came ?? {})) {
      selfWork[dayKey] = came ? true : SCHED_DEL;
    }
    for (const [dayKey, value] of Object.entries(change.hours ?? {})) {
      hours[dayKey] = value ? hoursWrite(value) : SCHED_DEL;
    }
    // Выходной и «отпросился» снимают часы того же дня (см. setScheduleDay).
    // Кроме дня, который тем же действием отмечен «пришёл»: он рабочий, и его
    // часы (возврат через «Отменить») должны остаться.
    for (const [dayKey, state] of Object.entries(change.days ?? {})) {
      if (state !== "work" && !change.came?.[dayKey]) hours[dayKey] = SCHED_DEL;
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
    writes.push({ kind: "month", id: techScheduleId(change.uid, input.monthKey), op: "merge", data });
  }
  return writes;
}
