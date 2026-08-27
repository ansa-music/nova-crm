import { updateDoc } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { addRow, fetchPageIfAccessible, fetchRows } from "@/services/pageService";
import { addSubPageRow, currentMonthTabName, fetchSubPageRows, fetchSubPages } from "@/services/subPageService";
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
  requireDb();
  if (input.entry.sheetRowId) return { ok: false, reason: "already" };

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
  } else {
    const rows = await fetchRows(input.workspaceId, target.id);
    order = rows.length;
    write = (cells, ord) => addRow(input.workspaceId, target.id, cells, ord);
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
  await updateDoc(paths.dailyDispatch(input.workspaceId, input.entry.id), { sheetRowId: row.id });
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
