import { getDoc, runTransaction } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { addRow, deleteRow, fetchPageIfAccessible, fetchRows } from "@/services/pageService";
import {
  addSubPageRow,
  currentMonthTabName,
  deleteSubPageRow,
  fetchSubPageRows,
  fetchSubPages,
} from "@/services/subPageService";
import { getMyDispatchTechnician } from "@/services/dispatchTechnicianService";
import { isDispatchColumnMapComplete } from "@/types/dailyDispatch";
import type { DailyDispatch, DispatchColumnMap, PageColumn, StatusOption, WorkspacePage } from "@/types";

function requireDb() {
  if (!db) throw new Error("Firebase не настроен");
  return db;
}

export type WriteDispatchResult =
  | { ok: true; rowId: string }
  | { ok: false; reason: "no-mapping" | "not-own" | "no-sheet" | "bad-columns" | "already" };

function cellFor(
  key: keyof DispatchColumnMap,
  entry: DailyDispatch,
  column: PageColumn | undefined,
  responsibleOptions: StatusOption[]
): string | number | null {
  if (key === "checkNo") return entry.checkNo;
  if (key === "character") return entry.character;
  if (key === "amount") {
    if (column?.type === "number" || column?.type === "currency") return entry.amount;
    return entry.amount ? String(entry.amount) : "";
  }
  if (key === "minutes") {
    if (entry.minutes == null) return null;
    if (column?.type === "number" || column?.type === "currency") return entry.minutes;
    return String(entry.minutes);
  }
  const raw = entry.os;
  if (column?.type === "responsible") {
    const hit = responsibleOptions.find((o) => o.label === raw || o.value === raw);
    return hit?.value ?? raw;
  }
  return raw;
}

export async function tryWriteDispatchOrderToSheet(input: {
  workspaceId: string;
  uid: string;
  entry: DailyDispatch;
  ownPage: WorkspacePage;
  pages: WorkspacePage[];
  responsibleOptions: StatusOption[];
}): Promise<WriteDispatchResult> {
  const database = requireDb();
  if (input.entry.sheetRowId) return { ok: false, reason: "already" };
  // The caller's `entry` can be stale — IncomingDispatchBanner refreshes
  // its request list on a 60s poll (Spark listener limits), not a live
  // subscription, so two tabs/devices on the same technician account can
  // both still see sheetRowId as null well after one of them already wrote
  // the row. Re-check against the server before doing any of the (much
  // more expensive) desk/column lookup work below.
  const freshSnap = await getDoc(paths.dailyDispatch(input.workspaceId, input.entry.id));
  if ((freshSnap.data() as DailyDispatch | undefined)?.sheetRowId) return { ok: false, reason: "already" };

  const tech = await getMyDispatchTechnician(input.workspaceId, input.uid);
  if (!tech || !isDispatchColumnMapComplete(tech.columnMap)) {
    return { ok: false, reason: "no-mapping" };
  }
  const map = tech.columnMap;

  let targetId: string;
  if (tech.deskTarget && tech.deskTarget !== "own") targetId = tech.deskTarget;
  else if (input.entry.linkedPageId) targetId = input.entry.linkedPageId;
  else targetId = input.ownPage.id;

  const fromList = input.pages.find((p) => p.id === targetId);
  const target =
    fromList ??
    (targetId === input.ownPage.id
      ? input.ownPage
      : await fetchPageIfAccessible(input.workspaceId, targetId, input.uid));
  if (!target || target.responsibleUserId !== input.uid) {
    return { ok: false, reason: "not-own" };
  }

  const hidden = target.columns.filter((c) => !c.hidden);
  let columns: PageColumn[] = hidden;
  let write: (cells: Record<string, string | number | null>, order: number) => Promise<{ id: string }>;
  let cleanup: (rowId: string) => Promise<void>;
  let order = 0;

  if (target.defaultSubPageId || target.hideMainTab) {
    const subs = await fetchSubPages(input.workspaceId, target.id);
    const month = currentMonthTabName();
    const sub =
      subs.find((s) => s.id === target.defaultSubPageId) ??
      subs.find((s) => s.name === month) ??
      subs[0];
    if (!sub) return { ok: false, reason: "no-sheet" };
    columns = (sub.columns ?? []).filter((c) => !c.hidden);
    if (!columns.length) columns = hidden;
    const rows = await fetchSubPageRows(input.workspaceId, target.id, sub.id);
    order = rows.length;
    write = (cells, ord) => addSubPageRow(input.workspaceId, target.id, sub.id, cells, ord);
    cleanup = (rowId) => deleteSubPageRow(input.workspaceId, target.id, sub.id, rowId);
  } else {
    const rows = await fetchRows(input.workspaceId, target.id);
    order = rows.length;
    write = (cells, ord) => addRow(input.workspaceId, target.id, cells, ord);
    cleanup = (rowId) => deleteRow(input.workspaceId, target.id, rowId);
  }

  const byKey = new Map(columns.map((c) => [c.key, c]));
  for (const key of Object.values(map)) {
    if (!byKey.has(key)) return { ok: false, reason: "bad-columns" };
  }

  const cells: Record<string, string | number | null> = {};
  (Object.keys(map) as (keyof DispatchColumnMap)[]).forEach((field) => {
    cells[map[field]] = cellFor(field, input.entry, byKey.get(map[field]), input.responsibleOptions);
  });

  const row = await write(cells, order);
  // The desk row itself can't be created transactionally (addRow/
  // addSubPageRow go through the normal service layer, including the
  // Supabase mirror), so this can't be a single atomic "check dailyDispatch,
  // then create the row" operation end to end. What CAN be atomic is the
  // final claim: read+check+set sheetRowId inside a transaction. If a
  // concurrent call from another tab/device already claimed it first (both
  // passed the earlier checks and both got this far before either claimed),
  // this one lost the race — clean up the now-orphaned duplicate row it just
  // created instead of leaving two rows on the desk for one accepted order.
  const dispatchRef = paths.dailyDispatch(input.workspaceId, input.entry.id);
  const won = await runTransaction(database, async (tx) => {
    const snap = await tx.get(dispatchRef);
    if ((snap.data() as DailyDispatch | undefined)?.sheetRowId) return false;
    tx.update(dispatchRef, { sheetRowId: row.id });
    return true;
  });
  if (!won) {
    await cleanup(row.id).catch(() => undefined);
    return { ok: false, reason: "already" };
  }
  return { ok: true, rowId: row.id };
}

export async function loadSheetColumnsForMapping(
  workspaceId: string,
  page: WorkspacePage | undefined
): Promise<PageColumn[]> {
  if (!page) return [];
  if (page.defaultSubPageId || page.hideMainTab) {
    const subs = await fetchSubPages(workspaceId, page.id);
    const month = currentMonthTabName();
    const sub =
      subs.find((s) => s.id === page.defaultSubPageId) ??
      subs.find((s) => s.name === month) ??
      subs[0];
    const cols = (sub?.columns ?? []).filter((c) => !c.hidden);
    return cols.length ? cols : page.columns.filter((c) => !c.hidden);
  }
  return page.columns.filter((c) => !c.hidden);
}
