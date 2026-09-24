import { limit, onSnapshot, orderBy, query, setDoc, where, type Query } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { generateId } from "@/utils/id";
import { normalizeTimestamp } from "@/utils/date";
import { pingInboxChanged } from "@/utils/inboxEvents";
import { sendNotification } from "@/services/notificationService";
import { toggleUserPageAccess } from "@/services/pageService";
import type { ViewRequest, WorkspacePage } from "@/types";
import { isOsDeskId } from "@/services/osDeskService";
import { deskHref } from "@/utils/deskLinks";

function mapRequests(docs: { id: string; data: () => import("firebase/firestore").DocumentData }[]): ViewRequest[] {
  return docs
    .map((d) => ({ id: d.id, ...d.data() }) as ViewRequest)
    .map((r) => ({
      ...r,
      createdAt: normalizeTimestamp(r.createdAt),
      updatedAt: normalizeTimestamp(r.updatedAt),
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Окно запросов на просмотр: последние 20 в каждую сторону и не старше 30
 * дней. Раньше подписка брала ВСЕ запросы человека за всё время (от меня и
 * ко мне), и выборка только росла. Рассмотренный запрос старше месяца уже
 * никому не нужен; ОЖИДАЮЩИЕ видны всегда, любого возраста (см. `watchSide`).
 */
const VIEW_REQUESTS_LIMIT = 20;
const VIEW_REQUESTS_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

/**
 * Граница окна — начало суток (UTC) 30 дней назад, а не `Date.now() − 30 дней`.
 * Хук `useViewRequests` смонтирован в семи местах сразу; одинаковые запросы
 * SDK объединяет в одну цель, а граница «до миллисекунды» делала бы каждый
 * монтаж новым запросом — со своим чтением с сервера. Так цель меняется раз
 * в сутки.
 */
function viewRequestsSince(now = Date.now()): number {
  return Math.floor(now / DAY_MS) * DAY_MS - VIEW_REQUESTS_WINDOW_DAYS * DAY_MS;
}

let indexFallbackLogged = false;

/**
 * Две выборки об одном запросе могут прийти в разное время (окно уже знает
 * «одобрен», выборка ожидающих ещё нет) — верим более свежей правке.
 */
function newer(a: ViewRequest, b: ViewRequest): ViewRequest {
  return (b.updatedAt || 0) > (a.updatedAt || 0) ? b : a;
}

/**
 * Живая выборка одной стороны (`fromUid`/`toUid` == я). Равенство по своему
 * uid — то, что доказывает правилу list-запрос (читать можно только свои).
 * Окно требует составного индекса поле + createdAt (firestore.indexes.json);
 * пока он строится после деплоя, запрос падает с failed-precondition — тогда,
 * как у уведомлений, откатываемся на прежний полный запрос, иначе запросы
 * молча пропали бы из колокольчика и «Столов».
 *
 * Рядом с окном — узкая выборка ОЖИДАЮЩИХ (`status == pending`, без срока и
 * limit). Окно «20 последних» само по себе выталкивает старый, но ещё не
 * рассмотренный запрос: у ответственного он пропал бы из очереди и
 * колокольчика, а у просителя остался бы `pending`, и `requestDeskView`
 * не дал бы послать новый — доступа нет, пока запрос не выйдет из окна.
 * Ожидающих всегда единицы (повтор к тому же столу возвращает прежний), так
 * что выборка почти ничего не стоит. Два равенства сервер собирает без
 * составного индекса, а правило доказывается тем же равенством по uid.
 */
function watchSide(
  workspaceId: string,
  field: "fromUid" | "toUid",
  uid: string,
  onRows: (rows: ViewRequest[]) => void
): () => void {
  const base = paths.viewRequests(workspaceId);
  const bounded: Query = query(
    base,
    where(field, "==", uid),
    where("createdAt", ">=", viewRequestsSince()),
    orderBy("createdAt", "desc"),
    limit(VIEW_REQUESTS_LIMIT)
  );
  let windowRows: ViewRequest[] = [];
  let pendingRows: ViewRequest[] = [];
  const emit = () => {
    const byId = new Map<string, ViewRequest>();
    for (const row of [...windowRows, ...pendingRows]) {
      const prev = byId.get(row.id);
      byId.set(row.id, prev ? newer(prev, row) : row);
    }
    onRows(Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt));
  };
  const onWindow = (snap: { docs: { id: string; data: () => import("firebase/firestore").DocumentData }[] }) => {
    windowRows = mapRequests(snap.docs);
    emit();
  };
  let stopped = false;
  const unsubscribePending = onSnapshot(
    query(base, where(field, "==", uid), where("status", "==", "pending")),
    (snap) => {
      pendingRows = mapRequests(snap.docs);
      emit();
    },
    (error) => {
      // Без неё остаётся окно — как было до этой выборки.
      if (!stopped) console.error(`Подписка на ожидающие запросы просмотра (${field}) отклонена:`, error.code, error.message);
    }
  );
  let unsubscribe = onSnapshot(
    bounded,
    onWindow,
    (error) => {
      if (stopped) return;
      if (error.code !== "failed-precondition") {
        // Отказ — это «не знаем», а не «запросов нет»: список на экране остаётся.
        console.error(`Подписка на запросы просмотра (${field}) отклонена:`, error.code, error.message);
        return;
      }
      if (!indexFallbackLogged) {
        indexFallbackLogged = true;
        console.warn("Индекс запросов на просмотр ещё строится — пока читаем их целиком:", error.message);
      }
      unsubscribe = onSnapshot(
        query(base, where(field, "==", uid)),
        onWindow,
        (fallbackError) =>
          console.error(`Подписка на запросы просмотра (${field}) отклонена:`, fallbackError.code, fallbackError.message)
      );
    }
  );
  return () => {
    stopped = true;
    unsubscribe();
    unsubscribePending();
  };
}

export function subscribeToMyViewRequests(
  workspaceId: string,
  uid: string,
  cb: (rows: ViewRequest[]) => void
) {
  let fromRows: ViewRequest[] = [];
  let toRows: ViewRequest[] = [];
  const emit = () => {
    const byId = new Map<string, ViewRequest>();
    for (const row of [...fromRows, ...toRows]) byId.set(row.id, row);
    cb(Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt));
  };
  const unsubFrom = watchSide(workspaceId, "fromUid", uid, (rows) => {
    fromRows = rows;
    emit();
  });
  const unsubTo = watchSide(workspaceId, "toUid", uid, (rows) => {
    toRows = rows;
    emit();
  });
  return () => {
    unsubFrom();
    unsubTo();
  };
}

export function latestRequestForPage(requests: ViewRequest[], pageId: string, fromUid: string): ViewRequest | null {
  return requests.find((r) => r.pageId === pageId && r.fromUid === fromUid) ?? null;
}

export async function requestDeskView(input: {
  workspaceId: string;
  page: WorkspacePage;
  fromUid: string;
  fromName: string;
  toUid: string;
  existing: ViewRequest[];
}): Promise<ViewRequest | null> {
  if (!db) throw new Error("Firebase не настроен");
  const toUid = input.page.responsibleUserId;
  if (!toUid) throw new Error("У стола нет ответственного");
  const current = latestRequestForPage(input.existing, input.page.id, input.fromUid);
  if (current?.status === "pending") return current;
  const id = generateId("viewreq");
  const now = Date.now();
  const row: ViewRequest = {
    id,
    workspaceId: input.workspaceId,
    pageId: input.page.id,
    pageName: input.page.name,
    fromUid: input.fromUid,
    fromName: input.fromName,
    toUid,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
  await setDoc(paths.viewRequest(input.workspaceId, id), row);
  await sendNotification(
    {
      workspaceId: input.workspaceId,
      title: input.page.osDesk
        ? `${input.fromName} просит смотреть «${input.page.name}»`
        : `${input.fromName} просит смотреть стол ${input.page.name}`,
      body: "Принять или отклонить запрос на просмотр.",
      priority: "important",
      fromUid: input.fromUid,
      fromName: input.fromName,
      target: "selected",
      // Столов ОС в «Столах» нет — ведём на сам стол.
      href: input.page.osDesk ? deskHref(input.page.id) : "/desks",
      pageId: input.page.id,
      kind: "view-request",
      viewRequestId: id,
    },
    [toUid]
  ).catch(() => {
    /* request itself already saved */
  });
  pingInboxChanged();
  return row;
}

export async function resolveDeskViewRequest(input: {
  workspaceId: string;
  request: ViewRequest;
  page: WorkspacePage | undefined;
  status: "approved" | "denied";
  actorUid: string;
  actorName: string;
}) {
  if (!db) throw new Error("Firebase не настроен");
  // Grant BEFORE flipping the status. The access itself is the allowedUsers
  // entry — the request doc is just the paper trail — and the Принять /
  // Отклонить buttons only render while the request is still `pending`. With
  // the status written first, a failing grant left the request permanently
  // `approved` with no allowedUsers entry and no way to retry: the requester
  // was "approved" yet still locked out, and the approver had no button left
  // to press. This way a failed grant throws with the request untouched, so
  // the caller's error toast is honest and Принять can simply be clicked
  // again.
  // Без стола выдать доступ нечем — и тогда нельзя писать «одобрено»: запрос
  // закрылся бы, а человек остался бы без доступа и без кнопки повторить.
  // (Так было со столами ОС: колокольчик искал стол среди обычных столов.)
  if (input.status === "approved" && !input.page) {
    throw new Error("Стол не найден — обновите страницу и попробуйте ещё раз");
  }
  if (input.status === "approved" && input.page) {
    await toggleUserPageAccess(input.workspaceId, input.page, input.request.fromUid, true);
  }
  await setDoc(
    paths.viewRequest(input.workspaceId, input.request.id),
    { status: input.status, updatedAt: Date.now() },
    { merge: true }
  );
  await sendNotification(
    {
      workspaceId: input.workspaceId,
      title:
        input.status === "approved"
          ? `Доступ к столу «${input.request.pageName}» открыт`
          : `Запрос к столу «${input.request.pageName}» отклонён`,
      body:
        input.status === "approved"
          ? "Можно открыть стол."
          : "Можно отправить запрос ещё раз.",
      priority: "normal",
      fromUid: input.actorUid,
      fromName: input.actorName,
      target: "selected",
      href:
        input.status === "approved"
          ? deskHref(input.request.pageId)
          : isOsDeskId(input.request.pageId)
            ? "/os-desks"
            : "/desks",
      pageId: input.request.pageId,
      kind: "view-request-result",
      viewRequestId: input.request.id,
    },
    [input.request.fromUid]
  ).catch(() => {
    /* status already written */
  });
  pingInboxChanged();
}
