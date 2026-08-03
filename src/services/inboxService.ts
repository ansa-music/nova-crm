import { onSnapshot, query, setDoc, where } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths, withErrorReporting } from "@/firebase/firestore";
import { normalizeTimestamp } from "@/utils/date";
import type { PrivateChatMeta, ReadMarker } from "@/types";

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

export function subscribeToMyConversations(
  workspaceId: string,
  uid: string,
  onData: (conversations: PrivateChatMeta[]) => void,
  onError?: (error: import("firebase/firestore").FirestoreError) => void
) {
  const q = query(paths.privateChats(workspaceId), where("participants", "array-contains", uid));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }) as unknown as PrivateChatMeta)
        .map((c) => ({ ...c, lastMessageAt: normalizeTimestamp(c.lastMessageAt) }))
        .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
      onData(items);
    },
    withErrorReporting(onError)
  );
}

/** context is "workspaceChat" or `private:${chatId}` */
export async function markContextRead(workspaceId: string, uid: string, context: string) {
  if (!db) return;
  const id = `${uid}_${context.replace(/[^a-zA-Z0-9:_-]/g, "")}`;
  const marker: ReadMarker = { id, uid, context, lastReadAt: Date.now() };
  await setDoc(paths.readMarker(workspaceId, id), marker, { merge: true });
}

export function subscribeToReadMarkers(
  workspaceId: string,
  uid: string,
  onData: (markers: Record<string, number>) => void,
  onError?: (error: import("firebase/firestore").FirestoreError) => void
) {
  const q = query(paths.readMarkers(workspaceId), where("uid", "==", uid));
  return onSnapshot(
    q,
    (snapshot) => {
      const map: Record<string, number> = {};
      snapshot.docs.forEach((d) => {
        const data = d.data() as ReadMarker;
        map[data.context] = normalizeTimestamp(data.lastReadAt);
      });
      onData(map);
    },
    withErrorReporting(onError)
  );
}
