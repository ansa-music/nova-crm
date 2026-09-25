import {
  CollectionReference,
  DocumentData,
  deleteDoc,
  doc,
  getCountFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { getDocsResumable, paths, withErrorReporting } from "@/firebase/firestore";
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
import { listenTopic, ringTopic } from "@/services/sb/topicDoorbell";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { generateId } from "@/utils/id";
import { normalizeTimestamp } from "@/utils/date";
import type { ChatMessage, ChatThread } from "@/types";

/**
 * Чаты: общий чат workspace, чат стола, комментарии к строке, личка. Все
 * четыре — одна модель сообщения (`ChatMessage`) и один сервис; нить
 * описывает `ChatThread`, а где она живёт — `workspace.sbCollections.chat`
 * (26.09.2026, SQL 20261009): пока таблицы нет — Firestore, как раньше.
 *
 * Firestore: сообщения упорядочены по `serverOrderAt` (serverTimestamp), НЕ
 * по `createdAt` — часы устройств расходятся на минуты, и порядок по
 * клиентскому числу у других участников путался. `createdAt` — число для
 * показа (не рендерить Firestore Timestamp напрямую — «Invalid time value»).
 *
 * Supabase: окно последних `max` строк нити + дельта по `rev` по звонку
 * `nova:{ws}:chat` (без данных) и опросу раз в 45 с на видимой вкладке;
 * `created_at` — серверное. Сообщения Firestore-эпохи (до переезда) нить
 * дочитывает из Firestore один раз за сессию и склеивает по id — история
 * не пропадает, а правка/удаление такого сообщения идут в Firestore.
 * Своё сообщение ложится в открытые нити сразу (оптимистично), RPC
 * `send_chat_message` подменяет его серверной строкой.
 */

export function chatTopic(workspaceId: string) {
  return `nova:${workspaceId}:chat`;
}

/** Ключ нити — он же значение `thread` в chat_messages. */
export function chatThreadKey(thread: ChatThread): string {
  switch (thread.kind) {
    case "ws":
      return "ws";
    case "page":
      return `page:${thread.pageId}`;
    case "row":
      return `row:${thread.pageId}:${thread.rowId}`;
    case "dm":
      return `dm:${thread.chatId}`;
  }
}

/** Коллекция Firestore той же нити. */
export function chatThreadRef(thread: ChatThread): CollectionReference<DocumentData> {
  switch (thread.kind) {
    case "ws":
      return paths.workspaceChat(thread.workspaceId);
    case "page":
      return paths.pageChat(thread.workspaceId, thread.pageId);
    case "row":
      return paths.rowComments(thread.workspaceId, thread.pageId, thread.rowId);
    case "dm":
      return paths.privateChatMessages(thread.workspaceId, thread.chatId);
  }
}

/** Где живут чаты этого workspace — по документу workspace из стора (как у уведомлений). */
export function chatBackendFor(workspaceId: string): SbBackend {
  const docWs = useWorkspaceStore.getState().workspaces.find((w) => w.id === workspaceId);
  if (!docWs) return "firestore";
  const backend = sbBackendOf(docWs, "chat");
  if (backend === "firestore" && sbTargetOf(docWs, "chat") === "supabase" && sbTableRecheckDue("chat")) {
    return "supabase";
  }
  return backend;
}

function sbError(error: { code?: string; message?: string }): Error {
  return Object.assign(new Error(error.message || "Supabase"), { code: error.code });
}

// ---------------------------------------------------------------------
// Firestore.
// ---------------------------------------------------------------------

/**
 * Только ПОСЛЕДНИЕ `max` сообщений. Подписка на весь чат читала каждое
 * сообщение за всё время — при каждом открытии, у каждого человека (счётчик
 * непрочитанных в меню висит у всех), и это съедало дневную квоту Spark.
 * Сортируем по `serverOrderAt` (он есть у всех сообщений после перехода на
 * серверное время); совсем старые сообщения без него сюда не попадают —
 * их показывает «Показать ранние» (`fetchChat`, разово по кнопке).
 *
 * Третий аргумент `onData` — снимок из кэша на диске (`fromCache`): по нему
 * можно рисовать, но не решать (правило CLAUDE.md). Подписка идёт с
 * `includeMetadataChanges`, чтобы переход «кэш → сервер» пришёл, даже если
 * сообщения не изменились; снимки, где поменялись только метаданные (своё
 * сообщение подтвердил сервер), а источник тот же, дальше не отдаём — общему
 * чату и личкам лишняя перерисовка ни к чему.
 */
function fsSubscribeToRecentChat(
  ref: CollectionReference<DocumentData>,
  max: number,
  onData: (messages: ChatMessage[], hasEarlier: boolean, fromCache: boolean) => void,
  onError?: (error: import("firebase/firestore").FirestoreError) => void
) {
  let lastFromCache: boolean | null = null;
  return onSnapshot(
    query(ref, orderBy("serverOrderAt", "desc"), limit(max)),
    { includeMetadataChanges: true },
    (snapshot) => {
      const fromCache = snapshot.metadata.fromCache;
      if (lastFromCache === fromCache && snapshot.docChanges().length === 0) return;
      lastFromCache = fromCache;
      const items = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as unknown as ChatMessage & { serverOrderAt?: unknown });
      items.forEach((m) => (m.createdAt = normalizeTimestamp(m.createdAt)));
      items.sort((a, b) => orderKey(a) - orderKey(b));
      onData(items, snapshot.size >= max, fromCache);
    },
    withErrorReporting(onError)
  );
}

function orderKey(m: ChatMessage & { serverOrderAt?: unknown }): number {
  return m.serverOrderAt ? normalizeTimestamp(m.serverOrderAt) : m.createdAt;
}

function mapChatDocs(docs: { id: string; data: () => DocumentData }[]): ChatMessage[] {
  const items = docs.map((d) => ({ id: d.id, ...d.data() }) as unknown as ChatMessage & { serverOrderAt?: unknown });
  items.forEach((m) => (m.createdAt = normalizeTimestamp(m.createdAt)));
  items.sort((a, b) => orderKey(a) - orderKey(b));
  return items;
}

/**
 * Вся нить разово — через `getDocsResumable`, а не `getDocs` (правило CLAUDE.md
 * о разовых чтениях): с кэшем на диске повторное чтение той же нити платит
 * только за изменившееся.
 */
export async function fetchChat(thread: ChatThread): Promise<ChatMessage[]> {
  const snapshot = await getDocsResumable(chatThreadRef(thread));
  return mapChatDocs(snapshot.docs);
}

/**
 * Сообщения без `serverOrderAt` (писались до перехода на серверное время),
 * уже найденные в этой сессии: путь нити → они сами. Пустой массив — «проверено,
 * таких нет». Такие сообщения больше никто не создаёт, поэтому один раз за
 * сессию достаточно.
 *
 * Это статичный снимок: в живое окно такие сообщения не попадают никогда
 * (правка и удаление `serverOrderAt` не ставят). Поэтому СВОЮ правку и
 * удаление (`editChatMessage`/`deleteChatMessage`) переносим сюда сами и
 * будим открытые панели этой нити (`legacyListeners`); чужую правку старого
 * сообщения человек увидит в следующей сессии.
 */
const legacyByPath = new Map<string, ChatMessage[]>();
/** Открытые панели нити → перерисовать при правке старого сообщения. */
const legacyListeners = new Map<string, Set<() => void>>();

function patchLegacy(path: string, messageId: string, patch: Partial<ChatMessage> | null) {
  const list = legacyByPath.get(path);
  if (!list || !list.some((m) => m.id === messageId)) return;
  legacyByPath.set(
    path,
    patch ? list.map((m) => (m.id === messageId ? { ...m, ...patch } : m)) : list.filter((m) => m.id !== messageId)
  );
  legacyListeners.get(path)?.forEach((fn) => fn());
}

/**
 * Старые сообщения нити, которых нет в окне по `serverOrderAt`: окно не
 * полное и с сервера — спрашиваем счётчик нити (1 чтение), больше окна —
 * дочитываем всю нить и берём документы без поля. Один раз за сессию на нить.
 */
async function loadLegacyWithoutOrder(ref: CollectionReference<DocumentData>, windowSize: number): Promise<ChatMessage[]> {
  const known = legacyByPath.get(ref.path);
  if (known) return known;
  try {
    const total = (await getCountFromServer(ref)).data().count;
    if (total <= windowSize) {
      legacyByPath.set(ref.path, []);
      return [];
    }
    const all = mapChatDocs((await getDocsResumable(ref)).docs);
    const old = all.filter((m) => !(m as ChatMessage & { serverOrderAt?: unknown }).serverOrderAt);
    legacyByPath.set(ref.path, old);
    return old;
  } catch {
    // Нет сети или отказ — просто без старых сообщений; следующее открытие спросит снова.
    return [];
  }
}

/**
 * Чат стола и комментарии к строке — окном последних `max` сообщений, как
 * общий чат. Раньше подписка шла на ВСЮ нить без limit: каждое открытие
 * панели читало историю стола за всё время.
 *
 * Окно сортирует по `serverOrderAt`, а Firestore молча выкидывает из такой
 * выборки документы без этого поля — самые старые сообщения. В общем чате с
 * этим смирились; здесь нить могла состоять ТОЛЬКО из них, и панель
 * показала бы пустоту. Поэтому, когда окно НЕ полное (в нём вся новая
 * история), один раз за сессию на нить спрашиваем счётчик всей нити
 * (`getCountFromServer` — 1 чтение): больше, чем в окне, — значит, старые
 * есть, и их дочитываем разово. Полное окно ничего не проверяет: старые
 * сообщения старше любого нового и понадобятся, только когда «Показать
 * ранние» дойдёт до конца.
 *
 * Решает только снимок С СЕРВЕРА: окно из кэша — это, может быть, 30
 * сообщений прошлой недели, а в нити уже 400; «не полное» по кэшу и счётчик
 * 400 > 30 дочитали бы всю нить ради окна из 60.
 */
function fsSubscribeToRecentThread(
  ref: CollectionReference<DocumentData>,
  max: number,
  onData: (messages: ChatMessage[], hasEarlier: boolean) => void,
  onError?: (error: import("firebase/firestore").FirestoreError) => void
) {
  let stopped = false;
  let windowItems: ChatMessage[] = [];
  let windowFull = false;
  let checking = false;
  const emit = () => {
    const legacy = legacyByPath.get(ref.path) ?? [];
    if (!legacy.length) {
      onData(windowItems, windowFull);
      return;
    }
    const inWindow = new Set(windowItems.map((m) => m.id));
    const merged = [...legacy.filter((m) => !inWindow.has(m.id)), ...windowItems];
    merged.sort((a, b) => orderKey(a) - orderKey(b));
    onData(merged, windowFull);
  };
  const checkLegacy = async (windowSize: number) => {
    if (checking || legacyByPath.has(ref.path)) return;
    checking = true;
    try {
      await loadLegacyWithoutOrder(ref, windowSize);
      if (!stopped) emit();
    } finally {
      checking = false;
    }
  };
  const unsubscribe = fsSubscribeToRecentChat(
    ref,
    max,
    (items, full, fromCache) => {
      windowItems = items;
      windowFull = full;
      emit();
      if (!full && !fromCache) void checkLegacy(items.length);
    },
    onError
  );
  let pathListeners = legacyListeners.get(ref.path);
  if (!pathListeners) legacyListeners.set(ref.path, (pathListeners = new Set()));
  pathListeners.add(emit);
  return () => {
    stopped = true;
    unsubscribe();
    pathListeners.delete(emit);
    if (!pathListeners.size) legacyListeners.delete(ref.path);
  };
}

export interface SendMessageInput {
  authorUid: string;
  authorName: string;
  authorPhotoURL?: string | null;
  text: string;
  replyTo?: ChatMessage | null;
}

function buildMessage(id: string, input: SendMessageInput): ChatMessage {
  return {
    id,
    authorUid: input.authorUid,
    authorName: input.authorName,
    authorPhotoURL: input.authorPhotoURL ?? null,
    text: input.text,
    createdAt: Date.now(),
    editedAt: null,
    deleted: false,
    replyToId: input.replyTo?.id ?? null,
    replyToAuthorName: input.replyTo?.authorName ?? null,
    replyToText: input.replyTo ? input.replyTo.text.slice(0, 140) : null,
  };
}

async function fsSendChatMessage(ref: CollectionReference<DocumentData>, input: SendMessageInput, id = generateId("msg")) {
  const message = buildMessage(id, input);
  await setDoc(doc(ref, id), { ...message, serverOrderAt: serverTimestamp() });
  return message;
}

async function fsEditChatMessage(ref: CollectionReference<DocumentData>, messageId: string, text: string, editedAt: number) {
  await setDoc(doc(ref, messageId), { text, editedAt }, { merge: true });
  // Старое сообщение без serverOrderAt живёт в статичном снимке — см. legacyByPath.
  patchLegacy(ref.path, messageId, { text, editedAt });
}

async function fsDeleteChatMessage(ref: CollectionReference<DocumentData>, messageId: string, editedAt: number) {
  await setDoc(doc(ref, messageId), { text: "", deleted: true, editedAt }, { merge: true });
  patchLegacy(ref.path, messageId, { text: "", deleted: true, editedAt });
}

// ---------------------------------------------------------------------
// Supabase.
// ---------------------------------------------------------------------

const CHAT_TABLE = "chat_messages";
const CHAT_COLUMNS =
  "workspace_id,id,kind,thread,author_uid,author_name,author_photo_url,text,created_at,edited_at,deleted,reply_to_id,reply_to_author_name,reply_to_text,rev,server_at";
/** Склейка звонков: серия сообщений — одна дельта. */
const RING_SETTLE_MS = 250;
/** Без звонка — опрос на видимой вкладке. */
const POLL_MS = 45_000;
const RETRY_MS = [3_000, 10_000, 30_000];
const DELTA_PAGE = 200;
/**
 * Запас курсора (как у уведомлений): rev выдаётся внутри транзакции, а виден
 * после фиксации — строка годится в курсор, когда по серверному времени есть
 * строка на 15 с новее или эта вкладка видела её 15 с назад.
 */
const CURSOR_SAFETY_MS = 15_000;

interface ChatRow {
  workspace_id: string;
  id: string;
  kind: string;
  thread: string;
  author_uid: string;
  author_name: string | null;
  author_photo_url: string | null;
  text: string | null;
  created_at: number | string;
  edited_at: number | string | null;
  deleted: boolean;
  reply_to_id: string | null;
  reply_to_author_name: string | null;
  reply_to_text: string | null;
  rev: number | string;
  server_at: string;
}

type SbMessage = ChatMessage & { rev: number };

function millis(value: string | null | undefined): number {
  const t = value ? Date.parse(value) : NaN;
  return Number.isFinite(t) ? t : 0;
}

function rowToMessage(row: ChatRow): SbMessage {
  return {
    id: row.id,
    authorUid: row.author_uid,
    authorName: row.author_name ?? "",
    authorPhotoURL: row.author_photo_url ?? null,
    text: row.text ?? "",
    createdAt: Number(row.created_at),
    editedAt: row.edited_at === null || row.edited_at === undefined ? null : Number(row.edited_at),
    deleted: Boolean(row.deleted),
    replyToId: row.reply_to_id ?? null,
    replyToAuthorName: row.reply_to_author_name ?? null,
    replyToText: row.reply_to_text ?? null,
    rev: Number(row.rev) || 0,
  };
}

/** Открытые нити этой вкладки: своё сообщение и правка ложатся в них сразу. */
interface LiveThread {
  add(message: SbMessage): void;
  remove(id: string): void;
  patch(id: string, patch: Partial<ChatMessage>): void;
  isLegacy(id: string): boolean;
}
const liveThreads = new Map<string, Set<LiveThread>>();

function liveOf(workspaceId: string, key: string): LiveThread[] {
  return [...(liveThreads.get(`${workspaceId}|${key}`) ?? [])];
}

/**
 * Сообщения Firestore-эпохи для нити в Supabase-режиме: окно последних `max`
 * по `serverOrderAt` (плюс, у чата стола и комментариев, совсем старые без
 * поля — как в fsSubscribeToRecentThread). Память на нить и размер окна.
 */
const legacyWindows = new Map<string, Promise<{ rows: ChatMessage[]; full: boolean }>>();

function loadLegacyWindow(thread: ChatThread, max: number): Promise<{ rows: ChatMessage[]; full: boolean }> {
  const key = `${thread.workspaceId}|${chatThreadKey(thread)}|${max}`;
  const known = legacyWindows.get(key);
  if (known) return known;
  const run = (async () => {
    if (!db) return { rows: [], full: false };
    const ref = chatThreadRef(thread);
    try {
      const snap = await getDocsResumable(query(ref, orderBy("serverOrderAt", "desc"), limit(max)));
      const rows = mapChatDocs(snap.docs);
      const full = snap.size >= max;
      if (!full && (thread.kind === "page" || thread.kind === "row")) {
        const old = await loadLegacyWithoutOrder(ref, rows.length);
        const inWindow = new Set(rows.map((m) => m.id));
        return { rows: [...old.filter((m) => !inWindow.has(m.id)), ...rows], full };
      }
      return { rows, full };
    } catch {
      legacyWindows.delete(key);
      return { rows: [], full: false };
    }
  })();
  legacyWindows.set(key, run);
  return run;
}

function sbSubscribe(
  thread: ChatThread,
  max: number,
  onData: (messages: ChatMessage[], hasEarlier: boolean, fromCache: boolean) => void,
  onError: ((error: import("firebase/firestore").FirestoreError) => void) | undefined,
  legacyAware: boolean
): () => void {
  const workspaceId = thread.workspaceId;
  const key = chatThreadKey(thread);
  let stopped = false;
  let fallback: (() => void) | null = null;
  const byId = new Map<string, SbMessage>();
  let legacy: ChatMessage[] = [];
  let legacyFull = false;
  let serverSynced = false;
  let inFlight = false;
  let again = false;
  let failures = 0;
  let revLog: { rev: number; at: number; seenAt: number }[] = [];
  let newestAt = 0;
  let cursorRev = 0;
  let ringTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;
  let stopRing: (() => void) | null = null;

  const emit = () => {
    if (stopped || fallback || !serverSynced) return;
    const own = [...byId.values()];
    const ids = new Set(own.map((m) => m.id));
    const merged: ChatMessage[] = [...legacy.filter((m) => !ids.has(m.id)), ...own];
    merged.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    onData(merged, own.length >= max || legacyFull, false);
  };

  const startFallback = () => {
    if (stopped || fallback) return;
    stopRing?.();
    stopRing = null;
    if (poll) clearInterval(poll);
    poll = null;
    const ref = chatThreadRef(thread);
    fallback = legacyAware
      ? fsSubscribeToRecentThread(ref, max, (items, more) => onData(items, more, false), onError)
      : fsSubscribeToRecentChat(ref, max, onData, onError);
  };

  function noteRevs(rows: ChatRow[]) {
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

  function take(row: ChatRow): boolean {
    const rev = Number(row.rev) || 0;
    const known = byId.get(row.id);
    if (known && known.rev >= rev) return false;
    byId.set(row.id, rowToMessage(row));
    return true;
  }

  function base() {
    return supabaseRows.from(CHAT_TABLE).select(CHAT_COLUMNS).eq("workspace_id", workspaceId).eq("thread", key);
  }

  async function fetchRows() {
    if (stopped || fallback) return;
    if (inFlight) {
      again = true;
      return;
    }
    inFlight = true;
    try {
      let changed = false;
      if (!serverSynced) {
        const { data, error } = await base().order("created_at", { ascending: false }).limit(max);
        if (stopped) return;
        if (error) throw error;
        const rows = (data ?? []) as ChatRow[];
        // Оптимистичные строки (rev 0) сохраняем — сервер их подтвердит своей строкой.
        for (const row of rows) take(row);
        noteRevs(rows);
        serverSynced = true;
        changed = true;
      } else {
        const after = cursor();
        for (let from = 0; ; from += DELTA_PAGE) {
          const { data, error } = await base().gt("rev", after).order("rev", { ascending: true }).range(from, from + DELTA_PAGE - 1);
          if (stopped) return;
          if (error) throw error;
          const rows = (data ?? []) as ChatRow[];
          for (const row of rows) if (take(row)) changed = true;
          noteRevs(rows);
          if (rows.length < DELTA_PAGE) break;
        }
      }
      markSbTablePresent("chat");
      failures = 0;
      if (changed) emit();
    } catch (error) {
      if (stopped) return;
      if (isSbMissingError(error)) {
        markSbTableMissing("chat");
        startFallback();
        return;
      }
      const delay = RETRY_MS[Math.min(failures, RETRY_MS.length - 1)];
      failures += 1;
      if (!retryTimer) {
        retryTimer = setTimeout(() => {
          retryTimer = null;
          void fetchRows();
        }, delay);
      }
      // Первое окно так и не прочиталось — панель узнаёт об отказе, как от Firestore.
      if (!serverSynced && failures === 1) {
        const e = error as { code?: string; message?: string };
        onError?.(Object.assign(new Error(e?.message || "chat"), { code: e?.code || "unavailable" }) as import("firebase/firestore").FirestoreError);
      }
    } finally {
      inFlight = false;
      if (again) {
        again = false;
        void fetchRows();
      }
    }
  }

  const schedule = () => {
    if (stopped || fallback || ringTimer) return;
    ringTimer = setTimeout(() => {
      ringTimer = null;
      void fetchRows();
    }, RING_SETTLE_MS);
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") schedule();
  };

  const live: LiveThread = {
    add(message) {
      byId.set(message.id, message);
      emit();
    },
    remove(id) {
      if (byId.delete(id)) emit();
    },
    patch(id, patch) {
      const known = byId.get(id);
      if (known) {
        byId.set(id, { ...known, ...patch });
      } else {
        legacy = legacy.map((m) => (m.id === id ? { ...m, ...patch } : m));
      }
      emit();
    },
    isLegacy: (id) => !byId.has(id) && legacy.some((m) => m.id === id),
  };
  const liveKey = `${workspaceId}|${key}`;
  let set = liveThreads.get(liveKey);
  if (!set) liveThreads.set(liveKey, (set = new Set()));
  set.add(live);

  stopRing = listenTopic(chatTopic(workspaceId), schedule);
  document.addEventListener("visibilitychange", onVisible);
  poll = setInterval(() => {
    if (document.visibilityState === "visible") void fetchRows();
  }, POLL_MS);
  void fetchRows();
  void loadLegacyWindow(thread, max).then((result) => {
    if (stopped) return;
    legacy = result.rows;
    legacyFull = result.full;
    emit();
  });

  return () => {
    stopped = true;
    set?.delete(live);
    if (set && set.size === 0) liveThreads.delete(liveKey);
    stopRing?.();
    document.removeEventListener("visibilitychange", onVisible);
    if (ringTimer) clearTimeout(ringTimer);
    if (retryTimer) clearTimeout(retryTimer);
    if (poll) clearInterval(poll);
    fallback?.();
  };
}

// ---------------------------------------------------------------------
// Общий вход.
// ---------------------------------------------------------------------

export function subscribeToRecentChat(
  thread: ChatThread,
  max: number,
  onData: (messages: ChatMessage[], hasEarlier: boolean, fromCache: boolean) => void,
  onError?: (error: import("firebase/firestore").FirestoreError) => void
) {
  if (chatBackendFor(thread.workspaceId) === "supabase") return sbSubscribe(thread, max, onData, onError, false);
  return fsSubscribeToRecentChat(chatThreadRef(thread), max, onData, onError);
}

export function subscribeToRecentThread(
  thread: ChatThread,
  max: number,
  onData: (messages: ChatMessage[], hasEarlier: boolean) => void,
  onError?: (error: import("firebase/firestore").FirestoreError) => void
) {
  if (chatBackendFor(thread.workspaceId) === "supabase") {
    return sbSubscribe(thread, max, (items, more) => onData(items, more), onError, true);
  }
  return fsSubscribeToRecentThread(chatThreadRef(thread), max, onData, onError);
}

export async function sendChatMessage(thread: ChatThread, input: SendMessageInput): Promise<ChatMessage> {
  const workspaceId = thread.workspaceId;
  if (chatBackendFor(workspaceId) !== "supabase") return fsSendChatMessage(chatThreadRef(thread), input);
  const id = generateId("msg");
  const message = buildMessage(id, input);
  const key = chatThreadKey(thread);
  // Своё сообщение — на экран сразу, как делал Firestore SDK.
  liveOf(workspaceId, key).forEach((l) => l.add({ ...message, rev: 0 }));
  try {
    const { data, error } = await supabaseRows.rpc("send_chat_message", {
      p_workspace: workspaceId,
      p_kind: thread.kind,
      p_page: thread.kind === "page" || thread.kind === "row" ? thread.pageId : null,
      p_row: thread.kind === "row" ? thread.rowId : null,
      p_peer: thread.kind === "dm" ? thread.peerUid : null,
      p_message: {
        id,
        text: message.text,
        authorName: message.authorName,
        authorPhotoURL: message.authorPhotoURL,
        replyToId: message.replyToId,
        replyToAuthorName: message.replyToAuthorName,
        replyToText: message.replyToText,
      },
    });
    if (error) throw sbError(error);
    markSbTablePresent("chat");
    const row = data as ChatRow | null;
    const saved = row && typeof row === "object" && row.id ? rowToMessage(row) : { ...message, rev: 0 };
    liveOf(workspaceId, key).forEach((l) => l.add(saved));
    ringTopic(chatTopic(workspaceId));
    return saved;
  } catch (error) {
    liveOf(workspaceId, key).forEach((l) => l.remove(id));
    if (isSbMissingError(error)) {
      // SQL 20261009 ещё не вставлен — по-старому, документом Firestore.
      markSbTableMissing("chat");
      return fsSendChatMessage(chatThreadRef(thread), input, id);
    }
    throw error;
  }
}

/**
 * Правка: строка в Supabase — UPDATE (права и набор столбцов держит база);
 * 0 строк — сообщение Firestore-эпохи, правим его там.
 */
async function sbPatchMessage(thread: ChatThread, messageId: string, patch: { text: string; deleted?: boolean }, editedAt: number): Promise<boolean> {
  const workspaceId = thread.workspaceId;
  const key = chatThreadKey(thread);
  const lives = liveOf(workspaceId, key);
  if (lives.some((l) => l.isLegacy(messageId))) return false;
  const { data, error } = await supabaseRows
    .from(CHAT_TABLE)
    .update({ text: patch.text, edited_at: editedAt, ...(patch.deleted ? { deleted: true } : {}) })
    .eq("workspace_id", workspaceId)
    .eq("id", messageId)
    .select("id");
  if (error) {
    if (isSbMissingError(error)) {
      markSbTableMissing("chat");
      return false;
    }
    throw sbError(error);
  }
  if (!Array.isArray(data) || data.length === 0) return false;
  markSbTablePresent("chat");
  lives.forEach((l) => l.patch(messageId, { text: patch.text, editedAt, ...(patch.deleted ? { deleted: true } : {}) }));
  ringTopic(chatTopic(workspaceId));
  return true;
}

export async function editChatMessage(thread: ChatThread, messageId: string, text: string) {
  const editedAt = Date.now();
  if (chatBackendFor(thread.workspaceId) === "supabase" && (await sbPatchMessage(thread, messageId, { text }, editedAt))) return;
  await fsEditChatMessage(chatThreadRef(thread), messageId, text, editedAt);
  liveOf(thread.workspaceId, chatThreadKey(thread)).forEach((l) => l.patch(messageId, { text, editedAt }));
}

/** Soft-delete: keeps the doc (so replies referencing it still resolve) but clears the text and marks it deleted. */
export async function deleteChatMessage(thread: ChatThread, messageId: string) {
  const editedAt = Date.now();
  if (chatBackendFor(thread.workspaceId) === "supabase" && (await sbPatchMessage(thread, messageId, { text: "", deleted: true }, editedAt))) return;
  await fsDeleteChatMessage(chatThreadRef(thread), messageId, editedAt);
  liveOf(thread.workspaceId, chatThreadKey(thread)).forEach((l) => l.patch(messageId, { text: "", deleted: true, editedAt }));
}

export async function hardDeleteChatMessage(thread: ChatThread, messageId: string) {
  const ref = chatThreadRef(thread);
  await deleteDoc(doc(ref, messageId));
  patchLegacy(ref.path, messageId, null);
}
