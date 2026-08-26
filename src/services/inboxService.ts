import { getDocs, onSnapshot, query, setDoc, where } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { normalizeTimestamp } from "@/utils/date";
import type { PrivateChatMeta, ReadMarker } from "@/types";
import { pingInboxChanged } from "@/utils/inboxEvents";
import { fetchMyNotifications, markNotificationRead } from "@/services/notificationService";

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

/** context is "workspaceChat" or `private:${chatId}` */
export async function markContextRead(workspaceId: string, uid: string, context: string) {
  if (!db) return;
  const id = `${uid}_${context.replace(/[^a-zA-Z0-9:_-]/g, "")}`;
  const marker: ReadMarker = { id, uid, context, lastReadAt: Date.now() };
  await setDoc(paths.readMarker(workspaceId, id), marker, { merge: true });
  pingInboxChanged();
}

/** Marks the private thread read (existing readMarkers) and matching bell rows (read: true). */
export async function markPrivateConversationRead(
  workspaceId: string,
  uid: string,
  peerUid: string,
  chatId: string
) {
  await markContextRead(workspaceId, uid, `private:${chatId}`);
  const href = `/messages/${peerUid}`;
  const notifs = await fetchMyNotifications(workspaceId, uid);
  const related = notifs.filter((n) => {
    if (n.read) return false;
    if (typeof n.href === "string" && n.href.startsWith("/messages/") && n.href === href) return true;
    if (n.fromUid === peerUid && !n.relatedAnnouncementId && !n.pageId) return true;
    return false;
  });
  for (const n of related) {
    await markNotificationRead(workspaceId, n.id);
  }
  pingInboxChanged();
}

export async function fetchReadMarkers(workspaceId: string, uid: string): Promise<Record<string, number>> {
  const q = query(paths.readMarkers(workspaceId), where("uid", "==", uid));
  const snapshot = await getDocs(q);
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
    const map: Record<string, number> = {};
    snapshot.docs.forEach((d) => {
      const data = d.data() as ReadMarker;
      map[data.context] = normalizeTimestamp(data.lastReadAt);
    });
    cb(map);
  });
}

