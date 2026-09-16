import { getDoc, onSnapshot, setDoc, type FirestoreError } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths, withErrorReporting } from "@/firebase/firestore";
import { currentMonthSubPageId } from "@/services/monthTabService";
import { fetchSubPageRows } from "@/services/subPageService";
import { countDeskLoad, deskLoadSignature } from "@/utils/techLoad";
import type { DeskLoad, SubPage, WorkspacePage } from "@/types";

/** Overwrites the desk's month counts. Allowed for anyone who can edit the desk's rows (firestore.rules → deskLoad). */
export async function publishDeskLoad(load: Omit<DeskLoad, "updatedAt">) {
  if (!db) return;
  await setDoc(paths.deskLoad(load.workspaceId, load.pageId), { ...load, updatedAt: Date.now() });
}

/**
 * Recounts one desk straight from its month tab (one-shot reads) and
 * publishes only if the numbers differ from `current`. The Owner's
 * «Технари» screen uses this to catch desks nobody has opened since their
 * counts last changed.
 */
export async function refreshDeskLoadFromRows(
  page: WorkspacePage,
  monthKey: string,
  uid: string,
  current: DeskLoad | undefined
) {
  const subPageId = currentMonthSubPageId(page, monthKey);
  if (!db || !subPageId || !page.responsibleUserId) return;
  const [subSnap, rows] = await Promise.all([
    getDoc(paths.subPage(page.workspaceId, page.id, subPageId)),
    fetchSubPageRows(page.workspaceId, page.id, subPageId),
  ]);
  if (!subSnap.exists()) return;
  const counts = countDeskLoad((subSnap.data() as SubPage).columns ?? [], rows);
  const next = { ...counts, subPageId, monthKey };
  if (current && deskLoadSignature(current) === deskLoadSignature(next)) return;
  await publishDeskLoad({
    pageId: page.id,
    workspaceId: page.workspaceId,
    responsibleUserId: page.responsibleUserId,
    updatedBy: uid,
    ...next,
  });
}

/**
 * Live, but only while «Технари» is open — one listener on a small
 * collection that changes a few times an hour. Polling it would cost far
 * more reads for a screen an ОС keeps open all day.
 */
export function subscribeDeskLoads(
  workspaceId: string,
  onData: (loads: DeskLoad[]) => void,
  onError?: (error: FirestoreError) => void
) {
  if (!db) {
    onData([]);
    return () => {};
  }
  return onSnapshot(
    paths.deskLoads(workspaceId),
    (snapshot) => onData(snapshot.docs.map((d) => ({ ...(d.data() as DeskLoad), pageId: d.id }))),
    withErrorReporting(onError)
  );
}
