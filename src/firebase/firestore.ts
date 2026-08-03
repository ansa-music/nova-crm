import {
  collection,
  collectionGroup,
  doc,
  type CollectionReference,
  type DocumentReference,
  type Query,
  onSnapshot,
  type DocumentData,
  type FirestoreError,
} from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { toast } from "@/components/ui/sonner";

function requireDb() {
  if (!db) throw new Error("Firebase не настроен: заполните .env.local");
  return db;
}

let permissionHintShown = false;

/**
 * Firestore denies every request by default until firestore.rules is actually
 * deployed to the project (`firebase deploy --only firestore:rules`). That is
 * the single most common "why doesn't anything load" cause for a fresh clone
 * of this project, so surface it once, clearly, instead of a silent failure.
 */
function reportFirestoreError(error: FirestoreError) {
  if (error.code === "permission-denied" && !permissionHintShown) {
    permissionHintShown = true;
    toast.error("Firestore отклонил запрос (permission-denied)", {
      description:
        "Похоже, firestore.rules ещё не задеплоены в проект. Выполните: firebase deploy --only firestore:rules,storage — подробности в README.",
      duration: 10000,
    });
  }
}

export function withErrorReporting(onError?: (error: FirestoreError) => void) {
  return (error: FirestoreError) => {
    reportFirestoreError(error);
    onError?.(error);
  };
}

export const paths = {
  users: () => collection(requireDb(), "users"),
  user: (uid: string) => doc(requireDb(), "users", uid),

  workspaces: () => collection(requireDb(), "workspaces"),
  workspace: (workspaceId: string) => doc(requireDb(), "workspaces", workspaceId),

  members: (workspaceId: string) =>
    collection(requireDb(), "workspaces", workspaceId, "members"),
  member: (workspaceId: string, uid: string) =>
    doc(requireDb(), "workspaces", workspaceId, "members", uid),
  memberGroup: () => collectionGroup(requireDb(), "members"),

  joinRequests: (workspaceId: string) =>
    collection(requireDb(), "workspaces", workspaceId, "joinRequests"),
  joinRequest: (workspaceId: string, uid: string) =>
    doc(requireDb(), "workspaces", workspaceId, "joinRequests", uid),

  pages: (workspaceId: string) => collection(requireDb(), "workspaces", workspaceId, "pages"),
  page: (workspaceId: string, pageId: string) =>
    doc(requireDb(), "workspaces", workspaceId, "pages", pageId),

  rows: (workspaceId: string, pageId: string) =>
    collection(requireDb(), "workspaces", workspaceId, "pages", pageId, "rows"),
  row: (workspaceId: string, pageId: string, rowId: string) =>
    doc(requireDb(), "workspaces", workspaceId, "pages", pageId, "rows", rowId),

  history: (workspaceId: string) => collection(requireDb(), "workspaces", workspaceId, "history"),
  historyEntry: (workspaceId: string, entryId: string) =>
    doc(requireDb(), "workspaces", workspaceId, "history", entryId),
};

/** Generic helper to subscribe to any query/collection with typed converter output. */
export function subscribe<T>(
  ref: Query<DocumentData> | CollectionReference<DocumentData>,
  onData: (items: T[]) => void,
  onError?: (error: FirestoreError) => void
) {
  return onSnapshot(
    ref,
    (snapshot) => {
      const items = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
      onData(items);
    },
    withErrorReporting(onError)
  );
}

export function subscribeToDoc<T>(
  ref: DocumentReference<DocumentData>,
  onData: (item: T | null) => void,
  onError?: (error: FirestoreError) => void
) {
  return onSnapshot(
    ref,
    (snapshot) => {
      onData(snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as T) : null);
    },
    withErrorReporting(onError)
  );
}
