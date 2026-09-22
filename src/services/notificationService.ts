import { getDocs, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, where, writeBatch } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
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

/** Fan-out write: one notification doc per targeted user, so each person's own query stays a simple, safe `where(targetUid == me)`. */
export async function sendNotification(input: SendNotificationInput, targetUids: string[]) {
  if (!db) throw new Error("Firebase не настроен");
  if (targetUids.length === 0) return;
  const batch = writeBatch(db);
  // Never notify the sender about their own action — every target-resolution
  // path is expected to already exclude them, but "responsible" (see
  // resolveNotificationTargets below) derives its list from raw page data
  // instead of the caller-filtered member list the other branches use, so
  // an Owner/Admin who is themselves responsible for a desk got notified
  // about their own announcement. Excluding here covers every call site
  // uniformly instead of re-fixing each target-resolution branch.
  const uniqueTargets = Array.from(new Set(targetUids)).filter((uid) => uid !== input.fromUid);
  for (const targetUid of uniqueTargets) {
    const id = generateId("notif");
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
 * прочитано будет ровно то, что подходит.
 */
export async function fetchMyUnreadNotificationsByHref(workspaceId: string, uid: string, href: string): Promise<Notification[]> {
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

export function subscribeMyNotifications(
  workspaceId: string,
  uid: string,
  cb: (rows: Notification[]) => void
) {
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

/** Прочитанные уведомления старше этого срока больше не нужны никому. */
const NOTIFICATION_KEEP_READ_MS = 14 * 24 * 60 * 60 * 1000;
const NOTIFICATION_CLEANUP_EVERY_MS = 24 * 60 * 60 * 1000;
/** За один заход — один batch (лимит 500 операций). Что не влезло, уйдёт завтра. */
const NOTIFICATION_CLEANUP_MAX = 400;
/** Когда эта вкладка уже пробовала чистить — на случай, если localStorage недоступен. */
const cleanupTriedAt = new Map<string, number>();

/**
 * Раз в сутки на человека удаляет его СОБСТВЕННЫЕ прочитанные уведомления
 * старше 14 дней.
 *
 * Удаления идут отдельной квотой (20k в сутки на Spark), а не записями, и
 * сами строки колокольчика никому уже не нужны: копятся они быстро — по
 * одному документу каждому технарю на каждый заказ биржи. Непрочитанные не
 * трогаем никогда: их человек ещё не видел.
 *
 * Правило notifications пускает удалять только свои (`targetUid == я`), и
 * запрос обязан фильтровать именно по targetUid — иначе list-запрос падает
 * целиком. Выборка идёт по составному индексу targetUid + read + createdAt,
 * поэтому читаются ровно те документы, что будут удалены. Пока индекс
 * строится (или кончилась квота), чистка просто не проходит — отметку не
 * ставим и пробуем при следующем открытии приложения.
 */
export async function cleanupOldReadNotifications(workspaceId: string, uid: string): Promise<void> {
  if (!db) return;
  const stampKey = `nova:notif-cleanup:${workspaceId}:${uid}`;
  const now = Date.now();
  const triedAt = cleanupTriedAt.get(stampKey);
  if (triedAt !== undefined && now - triedAt < NOTIFICATION_CLEANUP_EVERY_MS) return;
  cleanupTriedAt.set(stampKey, now);
  try {
    const last = Number(localStorage.getItem(stampKey) ?? 0);
    if (Number.isFinite(last) && now - last < NOTIFICATION_CLEANUP_EVERY_MS) return;
  } catch {
    /* localStorage закрыт (приватный режим) — хватит отметки этой вкладки */
  }
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
      await batch.commit();
    }
    try {
      localStorage.setItem(stampKey, String(now));
    } catch {
      /* без localStorage повторим при следующем открытии вкладки */
    }
  } catch (error) {
    const code = (error as { code?: string } | null)?.code ?? "unknown";
    console.warn("Чистка старых уведомлений не прошла, повторим позже:", code);
  }
}

export async function markNotificationRead(workspaceId: string, id: string) {
  if (!db) return;
  await setDoc(paths.notification(workspaceId, id), { read: true }, { merge: true });
  pingInboxChanged();
}

export async function markAllNotificationsRead(workspaceId: string, notifications: Notification[]) {
  if (!db) return;
  const unread = notifications.filter((n) => !n.read);
  if (unread.length === 0) return;
  const batch = writeBatch(db);
  unread.forEach((n) => batch.set(paths.notification(workspaceId, n.id), { read: true }, { merge: true }));
  await batch.commit();
  pingInboxChanged();
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
