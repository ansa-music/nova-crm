import {
  CollectionReference,
  DocumentData,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { withErrorReporting } from "@/firebase/firestore";
import { generateId } from "@/utils/id";
import { normalizeTimestamp } from "@/utils/date";
import type { ChatMessage } from "@/types";

/**
 * Messages are ordered by `serverOrderAt` (a Firestore serverTimestamp()),
 * NOT by `createdAt` — different people's devices can have clocks that are
 * minutes off from each other, and ordering by a client-set number made
 * messages appear scrambled/out of sequence for other participants. The
 * server timestamp is authoritative and always consistent regardless of
 * whose device sent what. `createdAt` stays a plain client number used only
 * for display (kept for date-fns formatting safety — never render a raw
 * Firestore Timestamp object directly, that's what caused the earlier
 * "Invalid time value" crash).
 */
export function subscribeToChat(
  ref: CollectionReference<DocumentData>,
  onData: (messages: ChatMessage[]) => void,
  onError?: (error: import("firebase/firestore").FirestoreError) => void
) {
  // No orderBy() in the query itself: Firestore's orderBy silently excludes
  // any document missing that field, which would have made every message
  // sent before this fix (no serverOrderAt yet) vanish from the list.
  // Sorting client-side instead, preferring the server-authoritative
  // timestamp and falling back to the client one for older messages.
  return onSnapshot(
    ref,
    (snapshot) => {
      const items = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as unknown as ChatMessage & { serverOrderAt?: unknown });
      items.forEach((m) => (m.createdAt = normalizeTimestamp(m.createdAt)));
      items.sort((a, b) => orderKey(a) - orderKey(b));
      onData(items);
    },
    withErrorReporting(onError)
  );
}

function orderKey(m: ChatMessage & { serverOrderAt?: unknown }): number {
  return m.serverOrderAt ? normalizeTimestamp(m.serverOrderAt) : m.createdAt;
}

export interface SendMessageInput {
  authorUid: string;
  authorName: string;
  authorPhotoURL?: string | null;
  text: string;
  replyTo?: ChatMessage | null;
}

export async function sendChatMessage(ref: CollectionReference<DocumentData>, input: SendMessageInput) {
  const id = generateId("msg");
  const message: ChatMessage = {
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
  await setDoc(doc(ref, id), { ...message, serverOrderAt: serverTimestamp() });
  return message;
}

export async function editChatMessage(ref: CollectionReference<DocumentData>, messageId: string, text: string) {
  await setDoc(doc(ref, messageId), { text, editedAt: Date.now() }, { merge: true });
}

/** Soft-delete: keeps the doc (so replies referencing it still resolve) but clears the text and marks it deleted. */
export async function deleteChatMessage(ref: CollectionReference<DocumentData>, messageId: string) {
  await setDoc(doc(ref, messageId), { text: "", deleted: true, editedAt: Date.now() }, { merge: true });
}

export async function hardDeleteChatMessage(ref: CollectionReference<DocumentData>, messageId: string) {
  await deleteDoc(doc(ref, messageId));
}
