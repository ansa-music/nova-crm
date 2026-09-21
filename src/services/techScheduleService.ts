import { deleteField, onSnapshot, query, setDoc, where, type FirestoreError } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths, withErrorReporting } from "@/firebase/firestore";
import { techScheduleId, type ScheduleDayState, type TechSchedule } from "@/types";

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
 * Тимлид/Owner ставит день. «Рабочий» — это УДАЛЕНИЕ ключа, а не значение
 * `"work"`: иначе в документе копились бы записи «рабочий», и отличить
 * «день не трогали» от «вернули в рабочие» стало бы невозможно.
 *
 * Снимает заодно `selfWork` того же дня: если человеку заново поставили
 * выходной, его вчерашнее «вышел на смену» не должно молча это перебивать.
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
 * «Вышел на смену» — единственное, что технарь может в своём графике, и
 * только в одну сторону: добавить себе рабочий день. Убрать выходной,
 * поставленный Тимлидом, он не может — `days` правила ему не отдают.
 */
export async function setSelfWorkDay(input: {
  workspaceId: string;
  uid: string;
  monthKey: string;
  dayKey: string;
  working: boolean;
}) {
  if (!db) throw new Error("Firebase не настроен");
  await setDoc(
    paths.techSchedule(input.workspaceId, techScheduleId(input.uid, input.monthKey)),
    {
      workspaceId: input.workspaceId,
      uid: input.uid,
      monthKey: input.monthKey,
      selfWork: { [input.dayKey]: input.working ? true : deleteField() },
      updatedAt: Date.now(),
    },
    { merge: true }
  );
}
