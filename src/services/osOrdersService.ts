import { onSnapshot, query, setDoc, where, type FirestoreError } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths, withErrorReporting } from "@/firebase/firestore";
import type { OsOrders } from "@/types";

export function osOrdersId(pageId: string, osValue: string) {
  return `${pageId}_${osValue}`;
}

/** Overwrites one ОС's order list for a desk. Allowed for whoever may edit the desk's rows (firestore.rules → osOrders). */
export async function publishOsOrders(input: Omit<OsOrders, "updatedAt">) {
  if (!db) return;
  await setDoc(paths.osOrders(input.workspaceId, osOrdersId(input.pageId, input.osValue)), {
    ...input,
    updatedAt: Date.now(),
  });
}

/**
 * The signed-in ОС's own order lists across every desk — live while
 * «Технари» is open. The rule lets an ОС read only docs whose osValue is
 * their nick, so the query filters on exactly that field.
 */
export function subscribeMyOsOrders(
  workspaceId: string,
  osValue: string,
  onData: (docs: OsOrders[]) => void,
  onError?: (error: FirestoreError) => void
) {
  if (!db) {
    onData([]);
    return () => {};
  }
  return onSnapshot(
    query(paths.osOrdersAll(workspaceId), where("osValue", "==", osValue)),
    (snapshot) => onData(snapshot.docs.map((d) => d.data() as OsOrders)),
    withErrorReporting(onError)
  );
}
