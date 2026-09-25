import { getDocs, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, where, writeBatch } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { supabaseRows } from "@/lib/supabaseRows";
import {
  isSbMissingError,
  markSbTableMissing,
  markSbTablePresent,
  sbBackendOf,
  sbTableRecheckDue,
  sbTargetOf,
  type SbBackend,
} from "@/services/sb/sbCollections";
import { readSnapshot, snapshotUid, writeSnapshot } from "@/services/sb/snapshotCache";
import { listenTopic, ringTopic } from "@/services/sb/topicDoorbell";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { generateId } from "@/utils/id";
import { normalizeTimestamp } from "@/utils/date";
import { memberHasRole, type Notification, type NotificationTargetKind, type Role, type WorkspaceMember, type WorkspacePage } from "@/types";
import { pingInboxChanged } from "@/utils/inboxEvents";

export interface SendNotificationInput {
  workspaceId: string;
  title: string;
  body: string;
  priority: "normal" | "important" | "urgent";
  fromUid: string;
  fromName: string;
  relatedAnnouncementId?: string | null;
  target: NotificationTargetKind;
  /** Required when target === "selected" */
  selectedUids?: string[];
  /** Required when target === "role" */
  role?: Role;
  href?: string | null;
  pageId?: string | null;
  kind?: Notification["kind"];
  viewRequestId?: string | null;
  ownerRequestId?: string | null;
}


/** Resolves the target picker's choice down to a concrete list of member uids to notify. */
export function resolveNotificationTargets(
  target: NotificationTargetKind,
  members: WorkspaceMember[],
  pages: WorkspacePage[],
  opts: { selectedUids?: string[]; role?: Role } = {}
): string[] {
  const active = members.filter((m) => m.status === "active");
  switch (target) {
    case "all":
      return active.map((m) => m.uid);
    case "selected":
      return opts.selectedUids ?? [];
    case "role":
      return active.filter((m) => Boolean(opts.role) && memberHasRole(m, opts.role!)).map((m) => m.uid);
    case "responsible": {
      const uids = new Set(pages.map((p) => p.responsibleUserId).filter((id): id is string => Boolean(id)));
      return Array.from(uids);
    }
    default:
      return [];
  }
}

// ---------------------------------------------------------------------
// Где живут уведомления — Firestore или Supabase
// (supabase/migrations/20260930_notifications.sql).
//
// Правило общее для переносимых коллекций (services/sb/sbCollections.ts,
// ключ "notifications"): строки таблиц в Supabase + нет выключателя Owner +
// таблица есть. Интерфейс сервиса не менялся — 15 вызывающих мест о
// хранилище не знают, поэтому решение берётся здесь, по документу workspace
// из стора (его держит живым useWorkspaceListBootstrap), в момент вызова.
//
// Переход (вкладки на старом коде живут до перезагрузки и пишут Firestore):
// в режиме Supabase рассылка идёт ТОЛЬКО в Supabase, а колокольчик читает
// Supabase ПЛЮС узкий хвост Firestore — свои уведомления, созданные после
// загрузки страницы (limit 10). Пустой хвост почти бесплатен.
// ---------------------------------------------------------------------

/** Тема звонка уведомлений workspace — без данных и без uid, см. topicDoorbell. */
export function notificationsTopic(workspaceId: string) {
  return `nova:${workspaceId}:notif`;
}

/**
 * Куда писать уведомления workspace прямо сейчас. Документа workspace у
 * вкладки нет (ещё не пришёл) — Firestore: получатели в режиме Supabase
 * дочитывают Firestore хвостом и такое не потеряют. Память «таблицы нет»
 * сама не истекает: пора переспросить — пробуем Supabase (отказ «нет
 * таблицы» снова поставит память и уведёт в Firestore), как пульс
 * присутствия. Без этого устройство с памятью «нет» писало бы в Firestore
 * вечно.
 */
export function notificationsBackendFor(workspaceId: string): SbBackend {
  const doc = useWorkspaceStore.getState().workspaces.find((w) => w.id === workspaceId);
  if (!doc) return "firestore";
  const backend = sbBackendOf(doc, "notifications");
  if (backend === "firestore" && sbTargetOf(doc, "notifications") === "supabase" && sbTableRecheckDue("notifications")) {
    return "supabase";
  }
  return backend;
}

const NOTIFICATIONS_TABLE = "notifications";
const NOTIFICATION_COLUMNS =
  "workspace_id,id,target_uid,from_uid,from_name,title,body,priority,href,page_id,kind,related_announcement_id,view_request_id,owner_request_id,read,created_at,rev,server_at";
/** Ответ «прочитать всё» — только то, что нужно окну и курсору (строк бывает сотня). */
const READ_RESULT_COLUMNS = "id,read,rev,server_at";

interface NotificationRow {
  workspace_id: string;
  id: string;
  target_uid: string;
  from_uid: string;
  from_name: string | null;
  title: string | null;
  body: string | null;
  priority: string | null;
  href: string | null;
  page_id: string | null;
  kind: string | null;
  related_announcement_id: string | null;
  view_request_id: string | null;
  owner_request_id: string | null;
  read: boolean;
  created_at: number | string;
  rev: number | string;
  server_at: string;
}

type ReadResultRow = Pick<NotificationRow, "id" | "read" | "rev" | "server_at">;

function sbError(error: { code?: string; message?: string }): Error {
  return Object.assign(new Error(error.message || "Supabase: запрос не прошёл"), { code: error.code ?? "" });
}

function millis(value: string | null | undefined): number {
  const ms = value ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

function rowToNotification(row: NotificationRow): Notification {
  const priority = row.priority === "important" || row.priority === "urgent" ? row.priority : "normal";
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    targetUid: row.target_uid,
    title: row.title ?? "",
    body: row.body ?? "",
    priority,
    fromUid: row.from_uid,
    fromName: row.from_name ?? "",
    read: Boolean(row.read),
    createdAt: Number(row.created_at) || 0,
    relatedAnnouncementId: row.related_announcement_id ?? null,
    href: row.href ?? null,
    pageId: row.page_id ?? null,
    kind: (row.kind ?? null) as Notification["kind"],
    viewRequestId: row.view_request_id ?? null,
    ownerRequestId: row.owner_request_id ?? null,
    source: "supabase",
    rev: Number(row.rev) || 0,
  };
}

/**
 * Откуда пришло каждое показанное уведомление — чтобы «прочитано» писать туда,
 * где оно лежит (markNotificationRead получает только id). Растёт на число
 * уведомлений за жизнь вкладки — сотни, не больше.
 */
const sourceById = new Map<string, "firestore" | "supabase">();
const SOURCE_MEMORY_MAX = 2000;

function rememberSources(rows: Notification[]) {
  for (const n of rows) sourceById.set(n.id, n.source ?? "firestore");
  if (sourceById.size > SOURCE_MEMORY_MAX) {
    const drop = sourceById.size - SOURCE_MEMORY_MAX;
    let i = 0;
    for (const key of sourceById.keys()) {
      if (i++ >= drop) break;
      sourceById.delete(key);
    }
  }
}

// ---------------------------------------------------------------------
// Рассылка.
// ---------------------------------------------------------------------

/** Кого приняла рассылка: setof text PostgREST отдаёт строками (на всякий случай разбираем и объекты). */
function acceptedUidsOf(data: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(data)) return out;
  for (const item of data) {
    if (typeof item === "string") out.add(item);
    else if (item && typeof item === "object") {
      const value = Object.values(item as Record<string, unknown>)[0];
      if (typeof value === "string") out.add(value);
    }
  }
  return out;
}

/**
 * Рассылка в Supabase ОДНИМ вызовом на всех получателей. Не бросает: `null` —
 * не легло совсем (нет SQL, отказ, сеть), иначе — кого база приняла
 * (участники workspace по копии прав). Остальным вызывающий пишет по-старому
 * в Firestore. После записи — звонок всем вкладкам workspace (без данных и
 * без uid: кому пришло, каждый узнаёт сам своим токеном).
 */
async function sbSendNotifications(input: SendNotificationInput, uids: string[], batchId: string): Promise<Set<string> | null> {
  try {
    const { data, error } = await supabaseRows.rpc("send_notifications", {
      p_workspace: input.workspaceId,
      p_uids: uids,
      p_payload: {
        id: batchId,
        fromUid: input.fromUid,
        fromName: input.fromName,
        title: input.title,
        body: input.body,
        priority: input.priority,
        href: input.href ?? null,
        pageId: input.pageId ?? null,
        kind: input.kind ?? null,
        relatedAnnouncementId: input.relatedAnnouncementId ?? null,
        viewRequestId: input.viewRequestId ?? null,
        ownerRequestId: input.ownerRequestId ?? null,
      },
    });
    if (error) {
      if (isSbMissingError(error)) markSbTableMissing("notifications");
      else console.warn("[notifications] рассылка в Supabase не прошла — пишу по-старому:", error.code, error.message);
      return null;
    }
    markSbTablePresent("notifications");
    const accepted = acceptedUidsOf(data);
    if (accepted.size > 0) ringTopic(notificationsTopic(input.workspaceId));
    return accepted;
  } catch (error) {
    console.warn("[notifications] рассылка в Supabase не прошла — пишу по-старому:", error);
    return null;
  }
}

/**
 * Прежний путь: документ на каждого получателя. `batchId` — рассылка шла в
 * Supabase и не легла (целиком или для части получателей): id тот же, что
 * получила бы строка Supabase. Если вызов на деле прошёл, а ответ потерялся,
 * читатель склеит две копии по id, и всплывашка будет одна.
 */
async function fsSendNotifications(input: SendNotificationInput, targetUids: string[], batchId: string | null) {
  if (!db) throw new Error("Firebase не настроен");
  const batch = writeBatch(db);
  for (const targetUid of targetUids) {
    const id = batchId ? `${batchId}_${targetUid}` : generateId("notif");
    const notification: Notification = {
      id,
      workspaceId: input.workspaceId,
      targetUid,
      title: input.title,
      body: input.body,
      priority: input.priority,
      fromUid: input.fromUid,
      fromName: input.fromName,
      read: false,
      createdAt: Date.now(),
      relatedAnnouncementId: input.relatedAnnouncementId ?? null,
      href: input.href ?? null,
      pageId: input.pageId ?? null,
      kind: input.kind ?? null,
      viewRequestId: input.viewRequestId ?? null,
      ownerRequestId: input.ownerRequestId ?? null,
    };
    batch.set(paths.notification(input.workspaceId, id), { ...notification, serverOrderAt: serverTimestamp() });
  }
  await batch.commit();
}

/**
 * Fan-out: по уведомлению на каждого получателя, чтобы запрос каждого был
 * простым и безопасным `targetUid == я`. Режим Supabase — одна вставка на
 * всех (send_notifications) и звонок; кого база не приняла (нет SQL, отказ,
 * человека ещё нет в копии прав) — по-старому в Firestore: их поймает хвост
 * колокольчика. Режим Firestore — всё как было.
 */
export async function sendNotification(input: SendNotificationInput, targetUids: string[]) {
  if (targetUids.length === 0) return;
  // Never notify the sender about their own action — every target-resolution
  // path is expected to already exclude them, but "responsible" (see
  // resolveNotificationTargets below) derives its list from raw page data
  // instead of the caller-filtered member list the other branches use, so
  // an Owner/Admin who is themselves responsible for a desk got notified
  // about their own announcement. Excluding here covers every call site
  // uniformly instead of re-fixing each target-resolution branch.
  const uniqueTargets = Array.from(new Set(targetUids)).filter((uid) => uid !== input.fromUid);
  let rest = uniqueTargets;
  let batchId: string | null = null;
  if (uniqueTargets.length > 0 && notificationsBackendFor(input.workspaceId) === "supabase") {
    batchId = generateId("notif");
    const accepted = await sbSendNotifications(input, uniqueTargets, batchId);
    if (accepted) rest = uniqueTargets.filter((uid) => !accepted.has(uid));
  }
  // Режим Firestore — как раньше, даже с пустым списком (пустой batch).
  if (rest.length > 0 || !batchId) await fsSendNotifications(input, rest, batchId);
  pingInboxChanged();
}

function mapNotifications(docs: { id: string; data: () => import("firebase/firestore").DocumentData }[]): Notification[] {
  return docs
    .map((d) => ({ id: d.id, ...d.data() }) as unknown as Notification)
    .map((n) => ({ ...n, createdAt: normalizeTimestamp(n.createdAt) }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Непрочитанные уведомления с этой ссылкой — запасной путь для
 * markPrivateConversationRead, когда общая подписка колокольчика ещё не
 * отдала снимок. Раньше здесь читалась ВСЯ история уведомлений человека (у
 * технаря — сотни, по одному на каждый заказ биржи) ради одной-двух строк.
 * Три равенства сервер собирает из одиночных индексов, составной не нужен, а
 * прочитано будет ровно то, что подходит. В режиме Supabase — то же одним
 * запросом туда (нет таблицы — по-старому Firestore).
 */
export async function fetchMyUnreadNotificationsByHref(workspaceId: string, uid: string, href: string): Promise<Notification[]> {
  if (notificationsBackendFor(workspaceId) === "supabase") {
    const { data, error } = await supabaseRows
      .from(NOTIFICATIONS_TABLE)
      .select(NOTIFICATION_COLUMNS)
      .eq("workspace_id", workspaceId)
      .eq("target_uid", uid)
      .eq("read", false)
      .eq("href", href)
      .order("created_at", { ascending: false })
      .limit(UNREAD_SWEEP_MAX);
    if (!error) {
      markSbTablePresent("notifications");
      const rows = ((data ?? []) as NotificationRow[]).map(rowToNotification);
      rememberSources(rows);
      return rows;
    }
    if (!isSbMissingError(error)) throw sbError(error);
    markSbTableMissing("notifications");
  }
  const q = query(
    paths.notifications(workspaceId),
    where("targetUid", "==", uid),
    where("read", "==", false),
    where("href", "==", href)
  );
  const snapshot = await getDocs(q);
  return mapNotifications(snapshot.docs);
}

/**
 * Сколько последних уведомлений держит живая подписка колокольчика.
 *
 * Раньше подписка брала ВСЕ уведомления человека за всё время, и каждый вход
 * в приложение перечитывал их целиком: квота Spark (50k чтений в сутки)
 * уходила на старьё, которое в колокольчике никто не листает. 40 — с запасом
 * больше, чем помещается в выпадашке.
 */
export const NOTIFICATIONS_LIVE_LIMIT = 40;

/** «Индекса ещё нет» пишем в консоль один раз: пока индекс строится, отказ приходит на каждую подписку. */
let indexFallbackLogged = false;

/**
 * Свои уведомления, живьём. `backend` решает useNotifications
 * (useSbBackend): Firestore — как было; Supabase — снимок из localStorage
 * (`fromCache = true`: рисовать можно, решать нельзя), затем окно 40 с
 * сервера, затем по звонку `nova:{ws}:notif` дельта `rev > курсор`, без
 * звонка — опрос раз в 45 с на видимой вкладке; плюс хвост Firestore (см.
 * выше). Нет таблицы (SQL не накатан) — молча прежняя подписка Firestore.
 */
export function subscribeMyNotifications(
  workspaceId: string,
  uid: string,
  cb: (rows: Notification[], fromCache?: boolean) => void,
  backend: SbBackend = "firestore"
) {
  if (backend === "supabase") return sbSubscribeMyNotifications(workspaceId, uid, cb);
  return fsSubscribeMyNotifications(workspaceId, uid, (rows) => cb(rows, false));
}

function fsSubscribeMyNotifications(workspaceId: string, uid: string, cb: (rows: Notification[]) => void) {
  const collectionRef = paths.notifications(workspaceId);
  // Ограниченный запрос требует составного индекса targetUid + createdAt
  // (firestore.indexes.json). После деплоя индекс строится несколько минут, и
  // всё это время запрос падает с failed-precondition — тогда откатываемся на
  // старый полный запрос, иначе колокольчик и всплывашки о заказах молча
  // опустели бы. `createdAt > 0` отсекает самые первые уведомления, где
  // createdAt успел побыть Timestamp (август 2026): в порядке Firestore
  // Timestamp стоит ПОСЛЕ чисел, и при сортировке по убыванию такие
  // документы навсегда заняли бы верх выдачи вместо свежих.
  const bounded = query(
    collectionRef,
    where("targetUid", "==", uid),
    where("createdAt", ">", 0),
    orderBy("createdAt", "desc"),
    limit(NOTIFICATIONS_LIVE_LIMIT)
  );
  let stopped = false;
  let unsubscribe = onSnapshot(
    bounded,
    (snap) => cb(mapNotifications(snap.docs)),
    (error) => {
      if (stopped) return;
      if (error.code !== "failed-precondition") {
        // Отказ — это «не знаем», а не «уведомлений нет»: последний список
        // остаётся на экране (см. «Критические уроки» в CLAUDE.md).
        console.error("Подписка на уведомления отклонена:", error.code, error.message);
        return;
      }
      if (!indexFallbackLogged) {
        indexFallbackLogged = true;
        console.warn("Индекс уведомлений ещё строится — пока читаем все уведомления целиком:", error.message);
      }
      unsubscribe = onSnapshot(
        query(collectionRef, where("targetUid", "==", uid)),
        (snap) => cb(mapNotifications(snap.docs)),
        (fallbackError) => console.error("Подписка на уведомления отклонена:", fallbackError.code, fallbackError.message)
      );
    }
  );
  return () => {
    stopped = true;
    unsubscribe();
  };
}

// ---------------------------------------------------------------------
// Хвост Firestore в режиме Supabase.
// ---------------------------------------------------------------------

/**
 * С какого момента хвост ловит уведомления Firestore: загрузка страницы минус
 * минута (часы отправителя и получателя расходятся). Всё, что старше,
 * вкладка в режиме Supabase из Firestore не читает вовсе — это и есть
 * экономия; уведомления старых вкладок, пришедшие после загрузки, ловит хвост.
 */
const FS_TAIL_FROM = Date.now() - 60_000;
const FS_TAIL_LIMIT = 10;

function subscribeFirestoreTail(workspaceId: string, uid: string, onRows: (rows: Notification[]) => void): () => void {
  if (!db) return () => {};
  try {
    return onSnapshot(
      // Тот же составной индекс targetUid + createdAt desc, что у окна Firestore.
      query(
        paths.notifications(workspaceId),
        where("targetUid", "==", uid),
        where("createdAt", ">", FS_TAIL_FROM),
        orderBy("createdAt", "desc"),
        limit(FS_TAIL_LIMIT)
      ),
      (snap) => onRows(mapNotifications(snap.docs).map((n) => ({ ...n, source: "firestore" as const }))),
      // Хвост не поднялся — колокольчик живёт на Supabase, теряются только
      // уведомления от вкладок на старом коде.
      (error) => console.warn("Хвост уведомлений Firestore отклонён:", error.code, error.message)
    );
  } catch (error) {
    console.warn("Хвост уведомлений Firestore не поднялся:", error);
    return () => {};
  }
}

/**
 * Два источника — один список. Одно и то же уведомление в обоих (рассылка в
 * Supabase прошла, но ответ потерялся, и оно записано ещё и в Firestore с тем
 * же id) показывается ОДИН раз: иначе два колокольчика и две всплывашки.
 */
function mergeSources(sb: Notification[], fs: Notification[]): Notification[] {
  const byId = new Map<string, Notification>();
  for (const n of fs) byId.set(n.id, n);
  for (const n of sb) {
    const other = byId.get(n.id);
    byId.set(n.id, other ? { ...n, read: n.read || other.read } : n);
  }
  const merged = [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
  rememberSources(merged);
  return merged;
}

function sbSubscribeMyNotifications(
  workspaceId: string,
  uid: string,
  cb: (rows: Notification[], fromCache?: boolean) => void
): () => void {
  let stopped = false;
  let sbRows: Notification[] | null = null;
  let sbFromCache = true;
  let tailRows: Notification[] = [];
  let fallback: (() => void) | null = null;
  let stopTail: () => void = () => {};
  let stopSb: () => void = () => {};

  // Пока Supabase не ответил (или не дал снимок), хвост в одиночку не
  // рисуется: «одно новое уведомление» вместо окна выглядело бы как потеря.
  const emit = () => {
    if (stopped || fallback || !sbRows) return;
    cb(mergeSources(sbRows, tailRows), sbFromCache);
  };

  stopSb = startSbNotifications(workspaceId, uid, (feed) => {
    if (stopped || fallback) return;
    if (feed.kind === "data") {
      sbRows = feed.rows;
      sbFromCache = feed.fromCache;
      emit();
      return;
    }
    // SQL не накатан — молча прежняя подписка Firestore (хвост она покрывает).
    stopSb();
    stopTail();
    fallback = fsSubscribeMyNotifications(workspaceId, uid, (rows) => cb(rows, false));
  });
  stopTail = subscribeFirestoreTail(workspaceId, uid, (rows) => {
    tailRows = rows;
    emit();
  });

  return () => {
    stopped = true;
    stopSb();
    stopTail();
    fallback?.();
  };
}

// ---------------------------------------------------------------------
// Supabase: окно, звонок, дельта.
// ---------------------------------------------------------------------

type SbNotificationsFeed = { kind: "data"; rows: Notification[]; fromCache: boolean } | { kind: "missing" };

/** Снимок окна в localStorage (ключ uid:ws:коллекция, стирается при выходе). */
const SNAPSHOT_NAME = "notifications";
/**
 * Запас курсора (как у счётчиков столов): rev выдаётся внутри транзакции, а
 * виден после фиксации, и правка с меньшим rev может зафиксироваться позже.
 * Строка годится в курсор, когда (по СЕРВЕРНОМУ времени) есть увиденная
 * строка хотя бы на 15 с новее ИЛИ когда эта вкладка сама увидела её 15 с
 * назад: всё, что получило номер раньше неё, за это время зафиксировано
 * (записи PostgREST — короткие транзакции). Второе условие — длительность
 * по часам этой же вкладки, чужие часы в нём не участвуют; без него курсор
 * стоял бы перед самым свежим уведомлением, и каждая дельта заново качала бы
 * его.
 */
const CURSOR_SAFETY_MS = 15_000;
/** Склейка звонков: серия рассылок — одна дельта. Короткая: всплывашка о заказе должна прийти ≤2 с. */
const RING_SETTLE_MS = 250;
/** Без звонка (канал не поднялся, писатель в обход клиента) — опрос на видимой вкладке. */
const POLL_MS = 45_000;
const RETRY_MS = [3_000, 10_000, 30_000];
/** Страница дельты: после «прочитать всё» на другом устройстве строк бывает больше окна. */
const DELTA_PAGE = 200;

interface LiveFeed {
  workspaceId: string;
  uid: string;
  /** Свою правку «прочитано» показать сразу (как Firestore-SDK); вернуть — при отказе. */
  markLocal: (match: (n: Notification) => boolean) => () => void;
  /** Ответ своей правки (новые rev) — в окно и в курсор, без лишней выборки. */
  absorb: (rows: ReadResultRow[]) => void;
}

const liveFeeds = new Set<LiveFeed>();

function feedsOf(workspaceId: string, uid?: string): LiveFeed[] {
  return [...liveFeeds].filter((f) => f.workspaceId === workspaceId && (!uid || f.uid === uid));
}

function startSbNotifications(
  workspaceId: string,
  uid: string,
  emit: (feed: SbNotificationsFeed) => void
): () => void {
  let stopped = false;
  let serverSynced = false;
  const byId = new Map<string, { n: Notification; rev: number }>();
  /** Увиденные номера правок, ещё не ушедшие под курсор. */
  let revLog: { rev: number; at: number; seenAt: number }[] = [];
  let newestAt = 0;
  let cursorRev = 0;
  let inFlight = false;
  let again = false;
  let failures = 0;
  let ringTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  // Снимок — только своего человека (ключ всё равно по uid вошедшего).
  const cached = snapshotUid() === uid ? readSnapshot<Notification[]>(workspaceId, SNAPSHOT_NAME) : null;
  if (cached && Array.isArray(cached.value)) {
    // Сразу, но после возврата из subscribe: подписчик ещё не готов.
    queueMicrotask(() => {
      if (!stopped && !serverSynced) emit({ kind: "data", rows: cached.value, fromCache: true });
    });
  }

  function noteRevs(rows: { rev: number | string; server_at: string }[]) {
    const seenAt = Date.now();
    for (const row of rows) {
      const rev = Number(row.rev) || 0;
      const at = millis(row.server_at);
      newestAt = Math.max(newestAt, at);
      if (rev > cursorRev) revLog.push({ rev, at, seenAt });
    }
  }

  function cursor(): number {
    const now = Date.now();
    for (const entry of revLog) {
      const settled = entry.at <= newestAt - CURSOR_SAFETY_MS || now - entry.seenAt >= CURSOR_SAFETY_MS;
      if (settled && entry.rev > cursorRev) cursorRev = entry.rev;
    }
    revLog = revLog.filter((entry) => entry.rev > cursorRev);
    return cursorRev;
  }

  function windowRows(): Notification[] {
    return [...byId.values()]
      .map((entry) => entry.n)
      .sort((a, b) => b.createdAt - a.createdAt || (b.rev ?? 0) - (a.rev ?? 0))
      .slice(0, NOTIFICATIONS_LIVE_LIMIT);
  }

  /** Окно — последние 40 по времени создания; что выпало, не держим. */
  function trim() {
    if (byId.size <= NOTIFICATIONS_LIVE_LIMIT) return;
    const keep = new Set(windowRows().map((n) => n.id));
    for (const id of [...byId.keys()]) if (!keep.has(id)) byId.delete(id);
  }

  /**
   * Нижняя граница дельты по времени создания: окно полное — правки строк
   * СТАРШЕ окна (их «прочитано» с другого устройства) качать незачем.
   * created_at ставит сервер (send_notifications), поэтому новое всегда не
   * старше границы.
   */
  function floor(): number | null {
    if (byId.size < NOTIFICATIONS_LIVE_LIMIT) return null;
    let oldest = Infinity;
    for (const entry of byId.values()) oldest = Math.min(oldest, entry.n.createdAt);
    return Number.isFinite(oldest) ? oldest : null;
  }

  function publish() {
    const rows = windowRows();
    writeSnapshot(workspaceId, SNAPSHOT_NAME, rows);
    emit({ kind: "data", rows, fromCache: false });
  }

  function visible() {
    return typeof document === "undefined" || document.visibilityState === "visible";
  }

  function base() {
    return supabaseRows
      .from(NOTIFICATIONS_TABLE)
      .select(NOTIFICATION_COLUMNS)
      .eq("workspace_id", workspaceId)
      .eq("target_uid", uid);
  }

  function take(row: NotificationRow): boolean {
    const rev = Number(row.rev) || 0;
    const known = byId.get(row.id);
    // Дубли из запаса курсора и обгоны — по rev, а не по времени прихода.
    if (known && known.rev >= rev) return false;
    byId.set(row.id, { n: rowToNotification(row), rev });
    return true;
  }

  async function fetchRows() {
    if (stopped) return;
    if (inFlight) {
      again = true;
      return;
    }
    inFlight = true;
    try {
      let changed = false;
      if (!serverSynced) {
        // Первая выборка — окно целиком (последние 40); дальше — только дельта.
        const { data, error } = await base().order("created_at", { ascending: false }).limit(NOTIFICATIONS_LIVE_LIMIT);
        if (stopped) return;
        if (error) throw error;
        const rows = (data ?? []) as NotificationRow[];
        byId.clear();
        for (const row of rows) take(row);
        noteRevs(rows);
        changed = true;
      } else {
        const after = cursor();
        const bottom = floor();
        for (let from = 0; ; from += DELTA_PAGE) {
          let request = base().gt("rev", after);
          if (bottom !== null) request = request.gte("created_at", bottom);
          const { data, error } = await request.order("rev", { ascending: true }).range(from, from + DELTA_PAGE - 1);
          if (stopped) return;
          if (error) throw error;
          const rows = (data ?? []) as NotificationRow[];
          for (const row of rows) if (take(row)) changed = true;
          noteRevs(rows);
          if (rows.length < DELTA_PAGE) break;
        }
        trim();
      }
      markSbTablePresent("notifications");
      serverSynced = true;
      failures = 0;
      if (changed) publish();
    } catch (error) {
      if (stopped) return;
      if (isSbMissingError(error)) {
        markSbTableMissing("notifications");
        stop();
        emit({ kind: "missing" });
        return;
      }
      // Отказ — «не знаем», а не «уведомлений нет»: последний список
      // остаётся на экране, повтор 3 → 10 → 30 с.
      const delay = RETRY_MS[Math.min(failures, RETRY_MS.length - 1)];
      failures += 1;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void fetchRows();
      }, delay);
    } finally {
      inFlight = false;
      if (again && !stopped) {
        again = false;
        void fetchRows();
      }
    }
  }

  // Звонок доходит и до СВЁРНУТОЙ вкладки — она и показывает всплывашку
  // браузера о заказе, поэтому дочитывает сразу (в отличие от счётчиков).
  function onRing() {
    if (stopped || ringTimer) return;
    ringTimer = setTimeout(() => {
      ringTimer = null;
      void fetchRows();
    }, RING_SETTLE_MS);
  }

  const feed: LiveFeed = {
    workspaceId,
    uid,
    markLocal(match) {
      if (!serverSynced) return () => {};
      const flipped: string[] = [];
      for (const [id, entry] of byId) {
        if (entry.n.read || !match(entry.n)) continue;
        entry.n = { ...entry.n, read: true };
        flipped.push(id);
      }
      if (flipped.length > 0) publish();
      return () => {
        if (stopped) return;
        let reverted = false;
        for (const id of flipped) {
          const entry = byId.get(id);
          // Строка с тех пор сменилась на сервере — верим серверу.
          if (entry && entry.n.read) {
            entry.n = { ...entry.n, read: false };
            reverted = true;
          }
        }
        if (reverted) publish();
        // Правдой всё равно станет следующая дельта.
        void fetchRows();
      };
    },
    absorb(rows) {
      if (stopped) return;
      if (!serverSynced) {
        // Окно ещё в пути и могло уйти в базу раньше правки — сразу за ним дельта.
        again = inFlight || again;
        return;
      }
      let changed = false;
      for (const row of rows) {
        const rev = Number(row.rev) || 0;
        const entry = byId.get(row.id);
        if (!entry || entry.rev >= rev) continue;
        entry.rev = rev;
        entry.n = { ...entry.n, read: Boolean(row.read), rev };
        changed = true;
      }
      noteRevs(rows);
      if (changed) publish();
    },
  };
  liveFeeds.add(feed);

  const stopListening = listenTopic(notificationsTopic(workspaceId), onRing);
  // Свёрнутая вкладка тоже спрашивает (браузер будит её не чаще раза в минуту): звук и
  // всплывашку о заказе играет именно она, и если звонок не дошёл (канал
  // Realtime отвалился, вкладку усыпили), заказ иначе молчал бы до возврата
  // на вкладку (жалоба Nurba 25.09.2026 «звук пропал» после переезда
  // уведомлений в Supabase). Запросы Supabase не тарифицируются.
  const pollTimer = setInterval(() => {
    if (serverSynced) void fetchRows();
  }, POLL_MS);
  // Возврат на вкладку — сразу дельта: опрос на телефоне не ждать.
  const onVisibility = () => {
    if (visible() && serverSynced) void fetchRows();
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);

  function stop() {
    if (stopped) return;
    stopped = true;
    liveFeeds.delete(feed);
    stopListening();
    clearInterval(pollTimer);
    if (ringTimer) clearTimeout(ringTimer);
    if (retryTimer) clearTimeout(retryTimer);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
  }

  void fetchRows();
  return stop;
}

// ---------------------------------------------------------------------
// Чистка.
// ---------------------------------------------------------------------

/** Прочитанные уведомления старше этого срока больше не нужны никому. */
const NOTIFICATION_KEEP_READ_MS = 14 * 24 * 60 * 60 * 1000;
const NOTIFICATION_CLEANUP_EVERY_MS = 24 * 60 * 60 * 1000;
/** За один заход — один batch (лимит 500 операций). Что не влезло, уйдёт завтра. */
const NOTIFICATION_CLEANUP_MAX = 400;
/** Когда эта вкладка уже пробовала чистить — на случай, если localStorage недоступен. */
const cleanupTriedAt = new Map<string, number>();

/** Пора ли чистить по отметке (вкладки и localStorage); ставит отметку вкладки. */
function cleanupDue(stampKey: string, now: number): boolean {
  const triedAt = cleanupTriedAt.get(stampKey);
  if (triedAt !== undefined && now - triedAt < NOTIFICATION_CLEANUP_EVERY_MS) return false;
  cleanupTriedAt.set(stampKey, now);
  try {
    const last = Number(localStorage.getItem(stampKey) ?? 0);
    if (Number.isFinite(last) && now - last < NOTIFICATION_CLEANUP_EVERY_MS) return false;
  } catch {
    /* localStorage закрыт (приватный режим) — хватит отметки этой вкладки */
  }
  return true;
}

function writeCleanupStamp(stampKey: string, at: number) {
  try {
    localStorage.setItem(stampKey, String(at));
  } catch {
    /* без localStorage повторим при следующем открытии вкладки */
  }
}

/**
 * Раз в сутки на человека удаляет его СОБСТВЕННЫЕ прочитанные уведомления
 * старше 14 дней.
 *
 * Supabase: один вызов cleanup_read_notifications (DELETE под политикой
 * «только свои»), pg_cron не нужен. Отметка своя (`nova:notif-cleanup-sb:`):
 * у Firestore — своя очередь.
 *
 * Firestore: удаления идут отдельной квотой (20k в сутки на Spark), а не
 * записями, и сами строки колокольчика никому уже не нужны: копятся они
 * быстро — по одному документу каждому технарю на каждый заказ биржи.
 * Непрочитанные не трогаем никогда: их человек ещё не видел. В режиме
 * Supabase Firestore-чистка остаётся — она дочищает то, что осталось от
 * времени до переезда (читает ровно то, что удалит; пусто — одно чтение).
 *
 * Правило notifications пускает удалять только свои (`targetUid == я`), и
 * запрос обязан фильтровать именно по targetUid — иначе list-запрос падает
 * целиком. Выборка идёт по составному индексу targetUid + read + createdAt,
 * поэтому читаются ровно те документы, что будут удалены. Пока индекс
 * строится (или кончилась квота), чистка просто не проходит — отметку не
 * ставим и пробуем при следующем открытии приложения.
 */
export async function cleanupOldReadNotifications(workspaceId: string, uid: string): Promise<void> {
  if (notificationsBackendFor(workspaceId) === "supabase") await sbCleanupOldReadNotifications(workspaceId, uid);
  await fsCleanupOldReadNotifications(workspaceId, uid);
}

async function sbCleanupOldReadNotifications(workspaceId: string, uid: string): Promise<void> {
  const stampKey = `nova:notif-cleanup-sb:${workspaceId}:${uid}`;
  const now = Date.now();
  if (!cleanupDue(stampKey, now)) return;
  try {
    const { error } = await supabaseRows.rpc("cleanup_read_notifications", { p_workspace: workspaceId });
    if (error) {
      if (isSbMissingError(error)) markSbTableMissing("notifications");
      else console.warn("Чистка старых уведомлений (Supabase) не прошла, повторим позже:", error.code);
      return;
    }
    writeCleanupStamp(stampKey, now);
  } catch (error) {
    console.warn("Чистка старых уведомлений (Supabase) не прошла, повторим позже:", error);
  }
}

async function fsCleanupOldReadNotifications(workspaceId: string, uid: string): Promise<void> {
  if (!db) return;
  const stampKey = `nova:notif-cleanup:${workspaceId}:${uid}`;
  const now = Date.now();
  if (!cleanupDue(stampKey, now)) return;
  try {
    const q = query(
      paths.notifications(workspaceId),
      where("targetUid", "==", uid),
      where("read", "==", true),
      where("createdAt", "<", now - NOTIFICATION_KEEP_READ_MS),
      orderBy("createdAt"),
      limit(NOTIFICATION_CLEANUP_MAX)
    );
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
      const batch = writeBatch(db);
      snapshot.docs.forEach((d) => batch.delete(d.ref));
      try {
        await batch.commit();
      } catch (commitError) {
        // Выборка уже оплачена — не повторять её на каждом открытии
        // приложения: следующая попытка через 6 часов.
        writeCleanupStamp(stampKey, now - NOTIFICATION_CLEANUP_EVERY_MS + 6 * 60 * 60 * 1000);
        throw commitError;
      }
    }
    writeCleanupStamp(stampKey, now);
  } catch (error) {
    const code = (error as { code?: string } | null)?.code ?? "unknown";
    console.warn("Чистка старых уведомлений не прошла, повторим позже:", code);
  }
}

// ---------------------------------------------------------------------
// «Прочитано».
// ---------------------------------------------------------------------

/**
 * UPDATE «прочитано» в Supabase с ответом (новые rev) — в окно и курсор
 * живых подписок этой вкладки. Своё показывается сразу (`markLocal`, как
 * Firestore-SDK), отказ возвращает как было. Бросает ошибку запроса.
 */
async function sbMarkRead(
  workspaceId: string,
  targetUid: string | null,
  match: (n: Notification) => boolean,
  run: () => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>
): Promise<number> {
  const reverts = feedsOf(workspaceId, targetUid ?? undefined).map((f) => f.markLocal(match));
  const { data, error } = await run();
  if (error) {
    reverts.forEach((revert) => revert());
    if (isSbMissingError(error)) markSbTableMissing("notifications");
    throw sbError(error);
  }
  markSbTablePresent("notifications");
  const rows = (data ?? []) as ReadResultRow[];
  feedsOf(workspaceId, targetUid ?? undefined).forEach((f) => f.absorb(rows));
  return rows.length;
}

function sbReadUpdate(workspaceId: string) {
  return supabaseRows.from(NOTIFICATIONS_TABLE).update({ read: true }).eq("workspace_id", workspaceId);
}

export async function markNotificationRead(workspaceId: string, id: string) {
  const source = sourceById.get(id);
  if (source === "supabase" || (!source && notificationsBackendFor(workspaceId) === "supabase")) {
    try {
      const updated = await sbMarkRead(
        workspaceId,
        null,
        (n) => n.id === id,
        () => sbReadUpdate(workspaceId).eq("id", id).select(READ_RESULT_COLUMNS)
      );
      // Строка своя в Supabase (или уже прочитана там — 0 строк) — готово.
      if (updated > 0 || source === "supabase") {
        pingInboxChanged();
        return;
      }
    } catch (error) {
      // Нет таблицы (память уже поставлена в sbMarkRead) — Firestore ниже.
      if (!isSbMissingError(error)) throw error;
    }
    // Источник неизвестен и в Supabase строки нет — это документ Firestore
    // (вкладка на старом коде). Не нашёлся и там — не беда, отказ глотаем:
    // setDoc несуществующего документа правило отклонит.
    if (!db) return;
    try {
      await setDoc(paths.notification(workspaceId, id), { read: true }, { merge: true });
    } catch (error) {
      console.warn("Уведомление не нашлось ни в Supabase, ни в Firestore:", (error as { code?: string })?.code);
    }
    pingInboxChanged();
    return;
  }
  if (!db) return;
  await setDoc(paths.notification(workspaceId, id), { read: true }, { merge: true });
  pingInboxChanged();
}

/** Сколько непрочитанных ЗА окном подписки добираем за одно открытие колокольчика. */
const UNREAD_SWEEP_MAX = 200;

/**
 * Живая подписка видит только последние NOTIFICATIONS_LIVE_LIMIT. Если окно
 * забито непрочитанными до самого старого — за ним наверняка лежат ещё
 * (технарь пару дней не заходил, а заказы биржи шли), и отметить надо и их:
 * чистка удаляет только ПРОЧИТАННЫЕ, и такие строки висели бы вечно, а через
 * две недели всплывали бы в колокольчике «9+» из старья.
 */
function windowMayHideUnread(notifications: Notification[]): Notification | null {
  if (notifications.length < NOTIFICATIONS_LIVE_LIMIT) return null;
  let oldest: Notification | null = null;
  for (const n of notifications) if (!oldest || n.createdAt < oldest.createdAt) oldest = n;
  return oldest && !oldest.read ? oldest : null;
}

/** Добор за окном уже идёт — повторное открытие колокольчика его не дублирует. */
const unreadSweepsInFlight = new Set<string>();

/**
 * «Прочитать всё». Supabase — ОДИН UPDATE: мои непрочитанные с rev не новее
 * самого нового увиденного. Граница по rev нужна, чтобы не пометить
 * прочитанным заказ, пришедший в ту же секунду и ещё не показанный (он
 * остался бы без звука и всплывашки); старые непрочитанные за окном тот же
 * запрос забирает сам, добор не нужен. Хвост Firestore (и весь режим
 * Firestore) — как раньше.
 */
export async function markAllNotificationsRead(workspaceId: string, notifications: Notification[]) {
  const unread = notifications.filter((n) => !n.read);
  if (unread.length === 0) return;
  const sbKnown = notifications.filter((n) => n.source === "supabase");
  const sbUnread = unread.filter((n) => n.source === "supabase");
  const fsUnread = unread.filter((n) => n.source !== "supabase");
  const tasks: Promise<void>[] = [];
  if (sbUnread.length > 0) {
    const maxRev = Math.max(...sbKnown.map((n) => n.rev ?? 0));
    const targetUid = sbUnread[0].targetUid;
    tasks.push(
      sbMarkRead(
        workspaceId,
        targetUid,
        (n) => n.source === "supabase" && (n.rev ?? 0) <= maxRev,
        () =>
          sbReadUpdate(workspaceId)
            .eq("target_uid", targetUid)
            .eq("read", false)
            .lte("rev", maxRev)
            .select(READ_RESULT_COLUMNS)
      ).then(() => pingInboxChanged())
    );
  }
  // Окно целиком из Firestore — прежний режим, с добором за окном.
  if (fsUnread.length > 0) tasks.push(fsMarkAllRead(workspaceId, fsUnread, sbKnown.length === 0 ? notifications : null));
  await Promise.all(tasks);
}

async function fsMarkAllRead(workspaceId: string, unread: Notification[], window: Notification[] | null) {
  if (!db) return;
  const oldestUnread = window ? windowMayHideUnread(window) : null;
  // Сначала — видимые: запись сразу отражается в подписке (read: true
  // локально), и повторное открытие колокольчика видит «всё прочитано», а
  // не отправляет то же самое ещё раз.
  const batch = writeBatch(db);
  unread.forEach((n) => batch.set(paths.notification(workspaceId, n.id), { read: true }, { merge: true }));
  const committed = batch.commit();
  pingInboxChanged();
  await committed;
  const targetUid = oldestUnread?.targetUid;
  const sweepKey = `${workspaceId}:${targetUid}`;
  if (!oldestUnread || !targetUid || unreadSweepsInFlight.has(sweepKey)) return;
  unreadSweepsInFlight.add(sweepKey);
  try {
    // Только то, что СТАРШЕ окна (видимые уже отмечены), от старых к новым —
    // тот же составной индекс targetUid + read + createdAt, что у чистки.
    const snapshot = await getDocs(
      query(
        paths.notifications(workspaceId),
        where("targetUid", "==", targetUid),
        where("read", "==", false),
        where("createdAt", "<", oldestUnread.createdAt),
        orderBy("createdAt"),
        limit(UNREAD_SWEEP_MAX)
      )
    );
    if (!snapshot.empty) {
      const older = writeBatch(db);
      snapshot.docs.forEach((d) => older.set(d.ref, { read: true }, { merge: true }));
      await older.commit();
      pingInboxChanged();
    }
  } catch (error) {
    // Не вышло добрать — видимые уже отмечены, остальное доберёт следующее открытие.
    console.warn("Не удалось дочитать старые непрочитанные уведомления:", (error as { code?: string })?.code);
  } finally {
    unreadSweepsInFlight.delete(sweepKey);
  }
}

/** Pings each @mentioned person with a lightweight notification. Never blocks/breaks sending the chat message itself if it fails. */
export async function notifyMentions(
  workspaceId: string,
  fromUid: string,
  fromName: string,
  mentionedUids: string[],
  context: string,
  href = "/chat"
) {
  const targets = mentionedUids.filter((uid) => uid !== fromUid);
  if (targets.length === 0) return;
  try {
    await sendNotification(
      {
        workspaceId,
        title: `${fromName} упомянул(а) вас`,
        body: context.slice(0, 140),
        priority: "normal",
        fromUid,
        fromName,
        target: "selected",
        href,
      },
      targets
    );
  } catch (error) {
    console.error("notifyMentions failed:", error);
  }
}
