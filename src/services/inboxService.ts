import { getDocs, onSnapshot, query, setDoc, where } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { getDocsResumable, paths } from "@/firebase/firestore";
import { supabaseRows } from "@/lib/supabaseRows";
import { chatBackendFor, chatTopic } from "@/services/chatService";
import { isSbMissingError, markSbTableMissing, markSbTablePresent } from "@/services/sb/sbCollections";
import { listenTopic, ringTopic } from "@/services/sb/topicDoorbell";
import { normalizeTimestamp } from "@/utils/date";
import type { PrivateChatMeta, ReadMarker } from "@/types";
import { pingInboxChanged } from "@/utils/inboxEvents";
import {
  NOTIFICATIONS_LIVE_LIMIT,
  fetchMyUnreadNotificationsByHref,
  markNotificationRead,
} from "@/services/notificationService";
import { getSharedNotifications } from "@/hooks/useNotifications";

/**
 * Supabase-режим чатов (20261009): карточку личной переписки ведёт сама
 * `send_chat_message` — клиенту писать нечего. Firestore — как раньше.
 */
export async function upsertPrivateChatMeta(
  workspaceId: string,
  chatId: string,
  participants: [string, string],
  lastMessageText: string,
  lastMessageFromUid: string,
  lastMessageFromName: string
) {
  if (!db) return;
  if (chatBackendFor(workspaceId) === "supabase") return;
  const meta: PrivateChatMeta = {
    id: chatId,
    participants,
    lastMessageText: lastMessageText.slice(0, 140),
    lastMessageAt: Date.now(),
    lastMessageFromUid,
    lastMessageFromName,
  };
  await setDoc(paths.privateChatMeta(workspaceId, chatId), meta, { merge: true });
}

export async function fetchMyConversations(workspaceId: string, uid: string): Promise<PrivateChatMeta[]> {
  const q = query(paths.privateChats(workspaceId), where("participants", "array-contains", uid));
  const snapshot = await getDocs(q);
  return snapshot.docs
    .map((d) => ({ id: d.id, ...d.data() }) as unknown as PrivateChatMeta)
    .map((c) => ({ ...c, lastMessageAt: normalizeTimestamp(c.lastMessageAt) }))
    .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
}

/**
 * Отметки «прочитано» — не чаще раза в 30 секунд на переписку и только когда
 * есть что отмечать.
 *
 * Раньше чат писал отметку на КАЖДОЕ изменение списка сообщений: пришло
 * чужое, отправил своё, догрузил ранние — запись. Открытый чат с живой
 * перепиской давал сотни записей в день на человека (квота Spark — 20k
 * записей в сутки на всех). Теперь вызывающий передаёт время самого свежего
 * ЧУЖОГО сообщения, которое видит, и запись уходит, только если оно новее
 * уже записанной отметки. Частые вызовы подряд склеиваются: вместо записи
 * ставится одна отложенная на конец 30-секундного окна — отметка всё равно
 * доедет, просто одна вместо десятка.
 */
const READ_MARK_MIN_GAP_MS = 30_000;

export interface MarkReadOptions {
  /**
   * Время самого свежего ЧУЖОГО сообщения, которое сейчас видит экран.
   * null — чужих сообщений нет, отмечать нечего; не передано — неизвестно,
   * пишем (с паузой).
   */
  latestForeignAt?: number | null;
  /** Явное «Прочитано» кнопкой: без проверок и без паузы. */
  force?: boolean;
}

/**
 * Последняя известная отметка на каждую переписку (`workspaceId|id отметки`):
 * из подписки на свои отметки и из собственных записей. Устареть она может
 * только в безопасную сторону — другое устройство записало позже, а мы не
 * знаем, — и тогда мы просто запишем лишний раз.
 */
const knownReadMarks = new Map<string, number>();
const lastReadMarkWriteAt = new Map<string, number>();
const pendingReadMarks = new Map<
  string,
  { timer: ReturnType<typeof setTimeout>; latestForeignAt: number | undefined; requestedAt: number }
>();

function readMarkerId(uid: string, context: string): string {
  return `${uid}_${context.replace(/[^a-zA-Z0-9:_-]/g, "")}`;
}

function rememberReadMarks(workspaceId: string, docs: { id: string; data: () => unknown }[]) {
  docs.forEach((d) => {
    const data = d.data() as ReadMarker;
    knownReadMarks.set(`${workspaceId}|${d.id}`, normalizeTimestamp(data.lastReadAt));
  });
}

/** Уже отмечено всё, что видит экран? Только при точном знании — иначе пишем. */
function alreadyRead(key: string, latestForeignAt: number | undefined): boolean {
  if (latestForeignAt === undefined) return false;
  const known = knownReadMarks.get(key);
  return known !== undefined && known >= latestForeignAt;
}

/**
 * «Прочитано до» по мнению ЭТОЙ вкладки — ставится сразу при вызове, ещё до
 * (возможно, отложенной на 30 с) записи в базу: значок непрочитанного в меню
 * гаснет мгновенно, а не через полминуты.
 */
const localReadMarks = new Map<string, number>();

export function localReadMark(workspaceId: string, uid: string, context: string): number | undefined {
  return localReadMarks.get(`${workspaceId}|${readMarkerId(uid, context)}`);
}

async function writeReadMarker(workspaceId: string, uid: string, context: string, at: number = Date.now()) {
  const id = readMarkerId(uid, context);
  const key = `${workspaceId}|${id}`;
  // Время ВЫЗОВА, а не момента записи: отложенная запись иначе пометила бы
  // прочитанными сообщения, пришедшие уже после того, как человек ушёл из чата.
  const lastReadAt = at;
  const previous = knownReadMarks.get(key);
  knownReadMarks.set(key, lastReadAt);
  lastReadMarkWriteAt.set(key, lastReadAt);
  const marker: ReadMarker = { id, uid, context, lastReadAt };
  try {
    await persistReadMarker(workspaceId, marker);
  } catch (error) {
    // Отметка не записалась — «прочитано до» у нас теперь ложное, и следующий
    // вызов решил бы, что писать нечего. Возвращаем прежнее знание.
    if (knownReadMarks.get(key) === lastReadAt) {
      if (previous === undefined) knownReadMarks.delete(key);
      else knownReadMarks.set(key, previous);
    }
    throw error;
  }
  pingInboxChanged();
}

const CHAT_READS_TABLE = "chat_reads";
const CHAT_DM_META_TABLE = "chat_dm_meta";
const DM_META_COLUMNS = "chat_id,peer_a,peer_b,last_text,last_at,last_from_uid,last_from_name";
/** Звонок своим вкладкам: отметка «прочитано» с другого устройства. */
function readsTopic(workspaceId: string, uid: string) {
  return `nova:${workspaceId}:chatreads:${uid}`;
}
const RING_SETTLE_MS = 250;
const POLL_MS = 45_000;

function sbError(error: { code?: string; message?: string }): Error {
  return Object.assign(new Error(error.message || "Supabase"), { code: error.code });
}

/** Supabase (chat_reads) — upsert своей строки и звонок своим вкладкам; нет таблицы — Firestore. */
async function persistReadMarker(workspaceId: string, marker: ReadMarker) {
  if (chatBackendFor(workspaceId) === "supabase") {
    const { error } = await supabaseRows
      .from(CHAT_READS_TABLE)
      .upsert(
        { workspace_id: workspaceId, uid: marker.uid, context: marker.context, last_read_at: marker.lastReadAt },
        { onConflict: "workspace_id,uid,context" }
      );
    if (!error) {
      markSbTablePresent("chat");
      ringTopic(readsTopic(workspaceId, marker.uid));
      return;
    }
    if (!isSbMissingError(error)) throw sbError(error);
    markSbTableMissing("chat");
  }
  await setDoc(paths.readMarker(workspaceId, marker.id), marker, { merge: true });
}

/**
 * Живая выборка Supabase без данных в звонке: первая выборка, затем по
 * звонку (склейка 250 мс), при возврате на вкладку и опросом раз в 45 с на
 * видимой. Нет таблицы — `onMissing`.
 */
function sbLive(topic: string, load: () => Promise<"ok" | "missing" | "error">, onMissing: () => void): () => void {
  let stopped = false;
  let settle: ReturnType<typeof setTimeout> | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;
  const run = async () => {
    if (stopped) return;
    const result = await load();
    if (stopped) return;
    if (result === "missing") {
      stop();
      onMissing();
    }
  };
  const schedule = () => {
    if (stopped || settle) return;
    settle = setTimeout(() => {
      settle = null;
      void run();
    }, RING_SETTLE_MS);
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") schedule();
  };
  const stopRing = listenTopic(topic, schedule);
  document.addEventListener("visibilitychange", onVisible);
  poll = setInterval(() => {
    if (document.visibilityState === "visible") void run();
  }, POLL_MS);
  const stop = () => {
    stopped = true;
    stopRing();
    document.removeEventListener("visibilitychange", onVisible);
    if (settle) clearTimeout(settle);
    if (poll) clearInterval(poll);
  };
  void run();
  return stop;
}

/** context is "workspaceChat" or `private:${chatId}` */
export async function markContextRead(workspaceId: string, uid: string, context: string, opts: MarkReadOptions = {}) {
  if (!db) return;
  const key = `${workspaceId}|${readMarkerId(uid, context)}`;
  const pending = pendingReadMarks.get(key);
  const calledAt = Date.now();
  if (!opts.force) {
    if (opts.latestForeignAt === null) return;
    const latestForeignAt = opts.latestForeignAt;
    if (alreadyRead(key, latestForeignAt)) return;
    // Для значка — сразу; в базу — как решит порог ниже.
    localReadMarks.set(key, Math.max(localReadMarks.get(key) ?? 0, calledAt));
    pingInboxChanged();
    const sinceLastWrite = Date.now() - (lastReadMarkWriteAt.get(key) ?? 0);
    if (sinceLastWrite < READ_MARK_MIN_GAP_MS) {
      if (pending) {
        // Неизвестное перебивает известное: отложенная запись тогда уйдёт без проверки.
        pending.latestForeignAt =
          pending.latestForeignAt === undefined || latestForeignAt === undefined
            ? undefined
            : Math.max(pending.latestForeignAt, latestForeignAt);
        pending.requestedAt = calledAt;
        return;
      }
      const entry = {
        latestForeignAt,
        requestedAt: calledAt,
        timer: setTimeout(() => {
          pendingReadMarks.delete(key);
          if (alreadyRead(key, entry.latestForeignAt)) return;
          writeReadMarker(workspaceId, uid, context, entry.requestedAt).catch((error) =>
            console.error("Не удалось записать отметку «прочитано»:", error)
          );
        }, READ_MARK_MIN_GAP_MS - sinceLastWrite),
      };
      pendingReadMarks.set(key, entry);
      return;
    }
  }
  if (pending) {
    clearTimeout(pending.timer);
    pendingReadMarks.delete(key);
  }
  localReadMarks.set(key, Math.max(localReadMarks.get(key) ?? 0, calledAt));
  await writeReadMarker(workspaceId, uid, context, calledAt);
}

/** Уведомления, которые прямо сейчас отмечаются прочитанными (или только что отмечены). */
const markingNotificationIds = new Set<string>();
const MARKING_MEMORY_MS = 10_000;
/**
 * Когда переписку последний раз добирали запросом за окном колокольчика.
 * Вызов идёт на каждое новое сообщение, а добирать нужно раз на открытие.
 */
const hrefSweptAt = new Map<string, number>();
const HREF_SWEEP_EVERY_MS = 10 * 60_000;

/** Marks the private thread read (existing readMarkers) and matching bell rows (read: true). */
export async function markPrivateConversationRead(
  workspaceId: string,
  uid: string,
  peerUid: string,
  chatId: string,
  opts: MarkReadOptions = {}
) {
  await markContextRead(workspaceId, uid, `private:${chatId}`, opts);
  const href = `/messages/${peerUid}`;
  // Уведомления берём из общей подписки колокольчика — она и так живая, а
  // перечитывать ради пары строк всю историю уведомлений человека незачем.
  // Снимка ещё нет — узкий запрос только по непрочитанным с этой ссылкой.
  const shared = getSharedNotifications(workspaceId, uid);
  let notifs = shared ?? (await fetchMyUnreadNotificationsByHref(workspaceId, uid, href));
  // Окно колокольчика — последние 40: уведомление о сообщении, за которым
  // пришло 40 заказов биржи, в него уже не попадает, и не отметилось бы
  // никогда. Окно полное — добираем узким запросом, раз в 10 минут на переписку.
  const sweepKey = `${workspaceId}:${uid}:${href}`;
  if (shared && shared.length >= NOTIFICATIONS_LIVE_LIMIT && Date.now() - (hrefSweptAt.get(sweepKey) ?? 0) >= HREF_SWEEP_EVERY_MS) {
    hrefSweptAt.set(sweepKey, Date.now());
    try {
      const older = await fetchMyUnreadNotificationsByHref(workspaceId, uid, href);
      const known = new Set(shared.map((n) => n.id));
      notifs = [...shared, ...older.filter((n) => !known.has(n.id))];
    } catch {
      hrefSweptAt.delete(sweepKey);
    }
  }
  // Match by href alone. The old second branch ("from peerUid, not an
  // announcement, no pageId") was meant to catch private-chat
  // notifications, but notifyMentions() never sets pageId for ANY mention
  // — a workspace-chat or row-comment mention from this same person is
  // just as "no pageId" as an actual DM mention, so opening a private chat
  // with someone silently marked read every pending mention from them
  // ANYWHERE in the app, including ones the person never saw. href is
  // already the precise, unambiguous signal (set correctly by every
  // notifyMentions call site — see RowCommentsPanel/PageChatPanel/
  // MessagesPage), so nothing else is needed.
  const related = notifs.filter(
    (n) => !n.read && typeof n.href === "string" && n.href === href && !markingNotificationIds.has(n.id)
  );
  for (const n of related) {
    // Экран вызывает это на каждое новое сообщение, и вызовы идут внахлёст:
    // пока первый ждёт записи, второй видит то же «непрочитано» и писал бы
    // его ещё раз. Помним, что уже отмечаем, — с запасом, пока снимок
    // подписки не догнал запись.
    markingNotificationIds.add(n.id);
    try {
      await markNotificationRead(workspaceId, n.id);
      setTimeout(() => markingNotificationIds.delete(n.id), MARKING_MEMORY_MS);
    } catch (error) {
      markingNotificationIds.delete(n.id);
      throw error;
    }
  }
  pingInboxChanged();
}

export async function fetchReadMarkers(workspaceId: string, uid: string): Promise<Record<string, number>> {
  const q = query(paths.readMarkers(workspaceId), where("uid", "==", uid));
  const snapshot = await getDocs(q);
  rememberReadMarks(workspaceId, snapshot.docs);
  const map: Record<string, number> = {};
  snapshot.docs.forEach((d) => {
    const data = d.data() as ReadMarker;
    map[data.context] = normalizeTimestamp(data.lastReadAt);
  });
  return map;
}


function fsSubscribeMyConversations(workspaceId: string, uid: string, cb: (rows: PrivateChatMeta[]) => void) {
  const q = query(paths.privateChats(workspaceId), where("participants", "array-contains", uid));
  return onSnapshot(q, (snapshot) => {
    cb(
      snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }) as unknown as PrivateChatMeta)
        .map((c) => ({ ...c, lastMessageAt: normalizeTimestamp(c.lastMessageAt) }))
        .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
    );
  });
}

/**
 * Supabase: карточки из chat_dm_meta (мои — где я peer_a или peer_b) плюс
 * карточки Firestore-эпохи (разовое чтение) — переписки до переезда не
 * пропадают из списка; у одной переписки побеждает более свежая.
 */
function sbSubscribeMyConversations(workspaceId: string, uid: string, cb: (rows: PrivateChatMeta[]) => void) {
  let stopped = false;
  let fallback: (() => void) | null = null;
  let sbRows: PrivateChatMeta[] | null = null;
  let legacyRows: PrivateChatMeta[] = [];
  const emit = () => {
    if (stopped || fallback || !sbRows) return;
    const byId = new Map<string, PrivateChatMeta>();
    for (const c of legacyRows) byId.set(c.id, c);
    for (const c of sbRows) {
      const other = byId.get(c.id);
      if (!other || c.lastMessageAt >= other.lastMessageAt) byId.set(c.id, c);
    }
    cb([...byId.values()].sort((a, b) => b.lastMessageAt - a.lastMessageAt));
  };
  const stopLive = sbLive(
    chatTopic(workspaceId),
    async () => {
      const { data, error } = await supabaseRows
        .from(CHAT_DM_META_TABLE)
        .select(DM_META_COLUMNS)
        .eq("workspace_id", workspaceId)
        .or(`peer_a.eq.${uid},peer_b.eq.${uid}`);
      if (error) {
        if (isSbMissingError(error)) {
          markSbTableMissing("chat");
          return "missing";
        }
        console.warn("[chat] карточки переписок не прочитались", error);
        return "error";
      }
      markSbTablePresent("chat");
      sbRows = ((data ?? []) as Array<{ chat_id: string; peer_a: string; peer_b: string; last_text: string | null; last_at: number | string; last_from_uid: string; last_from_name: string | null }>).map(
        (r) => ({
          id: r.chat_id,
          participants: [r.peer_a, r.peer_b] as [string, string],
          lastMessageText: r.last_text ?? "",
          lastMessageAt: Number(r.last_at),
          lastMessageFromUid: r.last_from_uid,
          lastMessageFromName: r.last_from_name ?? "",
        })
      );
      emit();
      return "ok";
    },
    () => {
      fallback = fsSubscribeMyConversations(workspaceId, uid, cb);
    }
  );
  void getDocsResumable(query(paths.privateChats(workspaceId), where("participants", "array-contains", uid)))
    .then((snapshot) => {
      if (stopped) return;
      legacyRows = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }) as unknown as PrivateChatMeta)
        .map((c) => ({ ...c, lastMessageAt: normalizeTimestamp(c.lastMessageAt) }));
      emit();
    })
    .catch(() => undefined);
  return () => {
    stopped = true;
    stopLive();
    fallback?.();
  };
}

export function subscribeMyConversations(
  workspaceId: string,
  uid: string,
  cb: (rows: PrivateChatMeta[]) => void
) {
  if (!db) {
    cb([]);
    return () => {};
  }
  if (chatBackendFor(workspaceId) === "supabase") return sbSubscribeMyConversations(workspaceId, uid, cb);
  return fsSubscribeMyConversations(workspaceId, uid, cb);
}

function fsSubscribeReadMarkers(workspaceId: string, uid: string, cb: (map: Record<string, number>) => void) {
  const q = query(paths.readMarkers(workspaceId), where("uid", "==", uid));
  return onSnapshot(q, (snapshot) => {
    rememberReadMarks(workspaceId, snapshot.docs);
    const map: Record<string, number> = {};
    snapshot.docs.forEach((d) => {
      const data = d.data() as ReadMarker;
      map[data.context] = normalizeTimestamp(data.lastReadAt);
    });
    cb(map);
  });
}

/**
 * Supabase: свои отметки из chat_reads (по звонку своих вкладок и опросу)
 * плюс отметки Firestore-эпохи (разовое чтение) — берётся большее.
 */
function sbSubscribeReadMarkers(workspaceId: string, uid: string, cb: (map: Record<string, number>) => void) {
  let stopped = false;
  let fallback: (() => void) | null = null;
  let sbMap: Record<string, number> | null = null;
  let legacyMap: Record<string, number> = {};
  const emit = () => {
    if (stopped || fallback || !sbMap) return;
    const map: Record<string, number> = { ...legacyMap };
    for (const [context, at] of Object.entries(sbMap)) map[context] = Math.max(map[context] ?? 0, at);
    for (const [context, at] of Object.entries(map)) knownReadMarks.set(`${workspaceId}|${readMarkerId(uid, context)}`, at);
    cb(map);
  };
  const stopLive = sbLive(
    readsTopic(workspaceId, uid),
    async () => {
      const { data, error } = await supabaseRows.from(CHAT_READS_TABLE).select("context,last_read_at").eq("workspace_id", workspaceId).eq("uid", uid);
      if (error) {
        if (isSbMissingError(error)) {
          markSbTableMissing("chat");
          return "missing";
        }
        console.warn("[chat] отметки «прочитано» не прочитались", error);
        return "error";
      }
      markSbTablePresent("chat");
      const next: Record<string, number> = {};
      for (const r of (data ?? []) as Array<{ context: string; last_read_at: number | string }>) next[r.context] = Number(r.last_read_at);
      sbMap = next;
      emit();
      return "ok";
    },
    () => {
      fallback = fsSubscribeReadMarkers(workspaceId, uid, cb);
    }
  );
  void getDocsResumable(query(paths.readMarkers(workspaceId), where("uid", "==", uid)))
    .then((snapshot) => {
      if (stopped) return;
      const next: Record<string, number> = {};
      snapshot.docs.forEach((d) => {
        const data = d.data() as ReadMarker;
        next[data.context] = normalizeTimestamp(data.lastReadAt);
      });
      legacyMap = next;
      emit();
    })
    .catch(() => undefined);
  return () => {
    stopped = true;
    stopLive();
    fallback?.();
  };
}

export function subscribeReadMarkers(
  workspaceId: string,
  uid: string,
  cb: (map: Record<string, number>) => void
) {
  if (!db) {
    cb({});
    return () => {};
  }
  if (chatBackendFor(workspaceId) === "supabase") return sbSubscribeReadMarkers(workspaceId, uid, cb);
  return fsSubscribeReadMarkers(workspaceId, uid, cb);
}

