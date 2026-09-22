import { getDocs, onSnapshot, query, setDoc, where } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { normalizeTimestamp } from "@/utils/date";
import type { PrivateChatMeta, ReadMarker } from "@/types";
import { pingInboxChanged } from "@/utils/inboxEvents";
import { fetchMyUnreadNotificationsByHref, markNotificationRead } from "@/services/notificationService";
import { getSharedNotifications } from "@/hooks/useNotifications";

export async function upsertPrivateChatMeta(
  workspaceId: string,
  chatId: string,
  participants: [string, string],
  lastMessageText: string,
  lastMessageFromUid: string,
  lastMessageFromName: string
) {
  if (!db) return;
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
    await setDoc(paths.readMarker(workspaceId, id), marker, { merge: true });
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
  const notifs = getSharedNotifications(workspaceId, uid) ?? (await fetchMyUnreadNotificationsByHref(workspaceId, uid, href));
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


export function subscribeMyConversations(
  workspaceId: string,
  uid: string,
  cb: (rows: PrivateChatMeta[]) => void
) {
  if (!db) {
    cb([]);
    return () => {};
  }
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

export function subscribeReadMarkers(
  workspaceId: string,
  uid: string,
  cb: (map: Record<string, number>) => void
) {
  if (!db) {
    cb({});
    return () => {};
  }
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

