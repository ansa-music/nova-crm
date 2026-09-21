import { deleteField, onSnapshot, query, setDoc, where, writeBatch, type FirestoreError } from "firebase/firestore";
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
  onData: (schedules: TechSchedule[]) => void,
  onError?: (error: FirestoreError) => void
) {
  if (!db) {
    onData([]);
    return () => {};
  }
  return onSnapshot(
    query(paths.techSchedulesAll(workspaceId), where("monthKey", "==", monthKey)),
    (snapshot) => onData(snapshot.docs.map((d) => ({ ...(d.data() as TechSchedule), id: d.id }))),
    withErrorReporting(onError)
  );
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
      hours: { [input.dayKey]: input.hours ?? deleteField() },
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
export async function saveScheduleDraft(input: {
  workspaceId: string;
  monthKey: string;
  actorUid: string;
  /** По человеку: день → состояние. `"work"` означает «убрать пометку». */
  changes: Array<{ uid: string; days: Record<string, ScheduleDayState> }>;
}) {
  if (!db) throw new Error("Firebase не настроен");
  if (input.changes.length === 0) return;
  const batch = writeBatch(db);
  for (const change of input.changes) {
    const days: Record<string, unknown> = {};
    const selfWork: Record<string, unknown> = {};
    for (const [dayKey, state] of Object.entries(change.days)) {
      days[dayKey] = state === "work" ? deleteField() : state;
      // День снова рабочий или заново выходной — старая отметка «пришёл»
      // к нему уже не относится.
      selfWork[dayKey] = deleteField();
    }
    batch.set(
      paths.techSchedule(input.workspaceId, techScheduleId(change.uid, input.monthKey)),
      {
        workspaceId: input.workspaceId,
        uid: change.uid,
        monthKey: input.monthKey,
        days,
        selfWork,
        updatedAt: Date.now(),
        updatedBy: input.actorUid,
      },
      { merge: true }
    );
  }
  await batch.commit();
}
