import {
  CollectionReference,
  DocumentData,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
} from "firebase/firestore";
import { withErrorReporting } from "@/firebase/firestore";
import { generateId } from "@/utils/id";
import { normalizeTimestamp } from "@/utils/date";
import type { ChatMessage } from "@/types";

export function subscribeToChat(
  ref: CollectionReference<DocumentData>,
  onData: (messages: ChatMessage[]) => void,
  onError?: (error: import("firebase/firestore").FirestoreError) => void
) {
  const q = query(ref, orderBy("createdAt", "asc"));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as unknown as ChatMessage);
      items.forEach((m) => (m.createdAt = normalizeTimestamp(m.createdAt)));
      onData(items);
    },
    withErrorReporting(onError)
  );
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
  await setDoc(doc(ref, id), message);
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
