import { deleteDoc, onSnapshot, query, setDoc, where, writeBatch, type FirestoreError } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths, withErrorReporting } from "@/firebase/firestore";
import { scheduleRequestId, techScheduleId, type ScheduleRequest } from "@/types";

/** Запросы на отметку за месяц. Читают все участники — список висит только на «Графике». */
export function subscribeScheduleRequests(
  workspaceId: string,
  monthKey: string,
  onData: (requests: ScheduleRequest[]) => void,
  onError?: (error: FirestoreError) => void
) {
  if (!db) {
    onData([]);
    return () => {};
  }
  return onSnapshot(
    query(paths.scheduleRequestsAll(workspaceId), where("monthKey", "==", monthKey)),
    (snapshot) => onData(snapshot.docs.map((d) => ({ ...(d.data() as ScheduleRequest), id: d.id }))),
    withErrorReporting(onError)
  );
}

/**
 * «Я вышел в выходной, отметьте меня». Документ ПЕРЕЗАПИСЫВАЕТСЯ целиком: на
 * один день у человека один запрос, и повторная отправка после отказа — это
 * тот же документ снова в `pending`, а не второй в списке.
 */
export async function requestScheduleMark(input: {
  workspaceId: string;
  uid: string;
  name: string;
  monthKey: string;
  dayKey: string;
}) {
  if (!db) throw new Error("Firebase не настроен");
  await setDoc(
    paths.scheduleRequest(input.workspaceId, scheduleRequestId(input.uid, input.monthKey, input.dayKey)),
    {
      workspaceId: input.workspaceId,
      uid: input.uid,
      name: input.name,
      monthKey: input.monthKey,
      dayKey: input.dayKey,
      status: "pending",
      createdAt: Date.now(),
      resolvedAt: null,
      resolvedBy: null,
    }
  );
}

/** Автор отзывает свой запрос, пока его не рассмотрели. */
export async function cancelScheduleRequest(workspaceId: string, requestId: string) {
  if (!db) throw new Error("Firebase не настроен");
  await deleteDoc(paths.scheduleRequest(workspaceId, requestId));
}

/**
 * Решение руководства. Подтверждение пишет отметку в график и статус запроса
 * ОДНИМ batch: иначе после сбоя в середине запрос выглядел бы принятым, а в
 * графике отметки не было бы — и человек считался бы прогулявшим.
 */
export async function resolveScheduleRequest(input: {
  workspaceId: string;
  request: ScheduleRequest;
  approve: boolean;
  actorUid: string;
}) {
  if (!db) throw new Error("Firebase не настроен");
  const batch = writeBatch(db);
  batch.set(
    paths.scheduleRequest(input.workspaceId, input.request.id),
    {
      workspaceId: input.workspaceId,
      uid: input.request.uid,
      name: input.request.name,
      monthKey: input.request.monthKey,
      dayKey: input.request.dayKey,
      status: input.approve ? "approved" : "declined",
      createdAt: input.request.createdAt,
      resolvedAt: Date.now(),
      resolvedBy: input.actorUid,
    }
  );
  if (input.approve) {
    batch.set(
      paths.techSchedule(input.workspaceId, techScheduleId(input.request.uid, input.request.monthKey)),
      {
        workspaceId: input.workspaceId,
        uid: input.request.uid,
        monthKey: input.request.monthKey,
        selfWork: { [input.request.dayKey]: true },
        updatedAt: Date.now(),
        updatedBy: input.actorUid,
      },
      { merge: true }
    );
  }
  await batch.commit();
}
