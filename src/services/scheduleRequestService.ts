import { deleteDoc, onSnapshot, query, setDoc, where, writeBatch, type FirestoreError } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths, withErrorReporting } from "@/firebase/firestore";
import { watchSbDocs, type DocView, type SbDoc } from "@/services/sb/docFeed";
import type { SbBackend } from "@/services/sb/sbCollections";
import { commitScheduleWrites, scheduleBackendFor, SCHEDULE_FEED } from "@/services/scheduleStore";
import { scheduleRequestId, techScheduleId, type ScheduleRequest } from "@/types";

function requestOf(doc: SbDoc): ScheduleRequest {
  return { ...(doc.data as unknown as ScheduleRequest), id: doc.id };
}

/** Вид запросов в Supabase; таблицы нет — `fallback` (Firestore). */
function watchRequests(
  workspaceId: string,
  view: DocView,
  onData: (requests: ScheduleRequest[]) => void,
  onError: ((error: FirestoreError) => void) | undefined,
  fallback: () => () => void
) {
  let fs: (() => void) | null = null;
  const stop = watchSbDocs(SCHEDULE_FEED, workspaceId, view, (docs) => onData(docs.map(requestOf)), {
    onError: (error) => onError?.(error as unknown as FirestoreError),
    onMissing: () => {
      fs ??= fallback();
    },
  });
  return () => {
    stop();
    fs?.();
  };
}

/**
 * Все запросы «на рассмотрении» — без привязки к месяцу. Это список
 * руководства: запрос за 30-е, поданный вечером, 1-го числа исчезал из
 * месячной выборки (страница открывается на новом месяце), и висел
 * нерассмотренным, пока кто-нибудь случайно не пролистает назад. Подтверждение
 * пишет отметку в месяц САМОГО запроса (`request.monthKey`), поэтому
 * показывать тут чужие месяцы безопасно.
 */
export function subscribePendingScheduleRequests(
  workspaceId: string,
  onData: (requests: ScheduleRequest[]) => void,
  onError?: (error: FirestoreError) => void,
  backend?: SbBackend | null
): () => void {
  if (!db) {
    onData([]);
    return () => {};
  }
  if ((backend ?? scheduleBackendFor(workspaceId)) === "supabase") {
    return watchRequests(
      workspaceId,
      { initial: (q) => q.eq("kind", "request").eq("status", "pending"), match: (d) => d.kind === "request" && d.data.status === "pending" },
      onData,
      onError,
      () => subscribePendingScheduleRequests(workspaceId, onData, onError, "firestore")
    );
  }
  return onSnapshot(
    query(paths.scheduleRequestsAll(workspaceId), where("status", "==", "pending")),
    (snapshot) => onData(snapshot.docs.map((d) => ({ ...(d.data() as ScheduleRequest), id: d.id }))),
    withErrorReporting(onError)
  );
}

/**
 * СВОИ запросы на отметку за месяц — для тех, кто подаёт запрос сам (технарь,
 * ОС): «ваш запрос на рассмотрении». Раньше выборка шла по всему месяцу, и
 * каждый открывший «График» читал запросы ВСЕХ людей, хотя показывал только
 * свой. Два равенства сервер собирает без составного индекса; правило чтения
 * (`isMember`) от фильтра не зависит. Руководство видит чужие запросы через
 * `subscribePendingScheduleRequests`.
 */
export function subscribeMyScheduleRequests(
  workspaceId: string,
  uid: string,
  monthKey: string,
  onData: (requests: ScheduleRequest[]) => void,
  onError?: (error: FirestoreError) => void,
  backend?: SbBackend | null
): () => void {
  if (!db || !uid) {
    onData([]);
    return () => {};
  }
  if ((backend ?? scheduleBackendFor(workspaceId)) === "supabase") {
    return watchRequests(
      workspaceId,
      {
        initial: (q) => q.eq("kind", "request").eq("uid", uid).eq("month_key", monthKey),
        match: (d) => d.kind === "request" && d.data.uid === uid && d.data.monthKey === monthKey,
      },
      onData,
      onError,
      () => subscribeMyScheduleRequests(workspaceId, uid, monthKey, onData, onError, "firestore")
    );
  }
  return onSnapshot(
    query(paths.scheduleRequestsAll(workspaceId), where("uid", "==", uid), where("monthKey", "==", monthKey)),
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
  const id = scheduleRequestId(input.uid, input.monthKey, input.dayKey);
  const data = {
    workspaceId: input.workspaceId,
    uid: input.uid,
    name: input.name,
    monthKey: input.monthKey,
    dayKey: input.dayKey,
    status: "pending",
    createdAt: Date.now(),
    resolvedAt: null,
    resolvedBy: null,
  };
  if (scheduleBackendFor(input.workspaceId) === "supabase") {
    await commitScheduleWrites(input.workspaceId, [{ kind: "request", id, op: "set", data }], "supabase");
    return;
  }
  await setDoc(paths.scheduleRequest(input.workspaceId, id), data);
}

/** Автор отзывает свой запрос, пока его не рассмотрели. */
export async function cancelScheduleRequest(workspaceId: string, requestId: string) {
  if (!db) throw new Error("Firebase не настроен");
  if (scheduleBackendFor(workspaceId) === "supabase") {
    await commitScheduleWrites(workspaceId, [{ kind: "request", id: requestId, op: "delete" }], "supabase");
    return;
  }
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
  if (scheduleBackendFor(input.workspaceId) === "supabase") {
    await commitScheduleWrites(
      input.workspaceId,
      [
        {
          kind: "request",
          id: input.request.id,
          op: "set",
          data: {
            workspaceId: input.workspaceId,
            uid: input.request.uid,
            name: input.request.name,
            monthKey: input.request.monthKey,
            dayKey: input.request.dayKey,
            status: input.approve ? "approved" : "declined",
            createdAt: input.request.createdAt,
            resolvedAt: Date.now(),
            resolvedBy: input.actorUid,
          },
        },
        ...(input.approve
          ? [
              {
                kind: "month" as const,
                id: techScheduleId(input.request.uid, input.request.monthKey),
                op: "merge" as const,
                data: {
                  workspaceId: input.workspaceId,
                  uid: input.request.uid,
                  monthKey: input.request.monthKey,
                  selfWork: { [input.request.dayKey]: true },
                  updatedAt: Date.now(),
                  updatedBy: input.actorUid,
                },
              },
            ]
          : []),
      ],
      "supabase"
    );
    return;
  }
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
