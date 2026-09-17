import { getDoc, onSnapshot, query, runTransaction, where, type FirestoreError } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths, withErrorReporting } from "@/firebase/firestore";
import { currentMonthSubPageId } from "@/services/monthTabService";
import { fetchSubPageRows } from "@/services/subPageService";
import { publishOsOrders } from "@/services/osOrdersService";
import { collectOsOrders, countDeskLoad, deskLoadNeedsPublish, mergeOsLastOrderAt } from "@/utils/techLoad";
import type { DeskLoad, DeskLoadArchive, StatusOption, SubPage, WorkspacePage } from "@/types";

/**
 * Overwrites the desk's month counts. Allowed for anyone who can edit the
 * desk's rows (firestore.rules → deskLoad). A transaction, because the
 * stored ОС activity outlives the month tab: ОС whose orders left the tab
 * keep their last order day until it's too old to rate by. The first
 * publish of a new month also archives the finished month
 * (deskLoadHistory) for the month-by-month chart on «Общий дашборд».
 */
export async function publishDeskLoad(load: Omit<DeskLoad, "updatedAt">) {
  if (!db) return;
  const ref = paths.deskLoad(load.workspaceId, load.pageId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const previous = snap.exists() ? (snap.data() as Partial<DeskLoad>) : null;
    const now = Date.now();
    if (previous?.monthKey && previous.monthKey !== load.monthKey) {
      tx.set(paths.deskLoadHistoryDoc(load.workspaceId, `${load.pageId}_${previous.monthKey}`), {
        ...previous,
        pageId: load.pageId,
        workspaceId: load.workspaceId,
        archivedAt: now,
      });
    }
    tx.set(ref, {
      ...load,
      osCounts: load.osCounts ?? {},
      osStatusCounts: load.osStatusCounts ?? {},
      osLastOrderAt: mergeOsLastOrderAt(previous?.osLastOrderAt, load.osLastOrderAt ?? {}, now),
      updatedAt: now,
    });
  });
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
  current: DeskLoad | undefined,
  responsibleOptions: StatusOption[]
) {
  const subPageId = currentMonthSubPageId(page, monthKey);
  if (!db || !subPageId || !page.responsibleUserId) return;
  const [subSnap, rows] = await Promise.all([
    getDoc(paths.subPage(page.workspaceId, page.id, subPageId)),
    fetchSubPageRows(page.workspaceId, page.id, subPageId),
  ]);
  if (!subSnap.exists()) return;
  const columns = (subSnap.data() as SubPage).columns ?? [];
  const counts = countDeskLoad(columns, rows, responsibleOptions, monthKey);
  const next = { ...counts, subPageId, monthKey };
  if (!deskLoadNeedsPublish(current, next)) return;
  const base = { pageId: page.id, workspaceId: page.workspaceId, responsibleUserId: page.responsibleUserId, updatedBy: uid };
  await publishDeskLoad({ ...base, ...next });
  // The ОС order lists go with the counts — same trigger, same desk.
  const osOrders = collectOsOrders(columns, rows, responsibleOptions);
  await Promise.all(
    Object.entries(osOrders).map(([osValue, orders]) =>
      publishOsOrders({ ...base, osValue, monthKey, subPageId, orders }).catch((error) =>
        console.warn(`Не удалось обновить заказы ОС «${osValue}» на столе ${page.id}:`, error)
      )
    )
  );
}

/** Finished months from `fromMonthKey` on — a few docs per desk per month. */
export function subscribeDeskLoadHistory(
  workspaceId: string,
  fromMonthKey: string,
  onData: (docs: DeskLoadArchive[]) => void,
  onError?: (error: FirestoreError) => void
) {
  if (!db) {
    onData([]);
    return () => {};
  }
  return onSnapshot(
    query(paths.deskLoadHistory(workspaceId), where("monthKey", ">=", fromMonthKey)),
    (snapshot) => onData(snapshot.docs.map((d) => d.data() as DeskLoadArchive)),
    withErrorReporting(onError)
  );
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
