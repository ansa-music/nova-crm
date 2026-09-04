import { isDoneStatusLabel } from "@/utils/columnOptions";
import type { PageProgress } from "@/utils/deskProgress";
import type { StatusOption, WorkspaceMember } from "@/types";
import { ymdInTimeZone } from "@/utils/date";
import { personLabel } from "@/utils/peopleDesks";
import { isResponsibleForPage } from "@/utils/permissions";
import { parseLooseNumber } from "@/utils/numberInput";

export interface RecentRowItem {
  id: string;
  pageId: string;
  pageName: string;
  title: string;
  statusValue: string;
  statusLabel: string;
  price: number;
  dateMs: number | null;
  updatedAt: number;
  responsibleLabel: string;
  responsibleUid: string | null;
}

function titleFromRow(desk: PageProgress, cells: Record<string, string | number | null>): string {
  const textCol = desk.columns.find((c) => c.type === "text");
  const raw = textCol ? cells[textCol.key] : null;
  const title = String(raw ?? "").trim();
  return title || "Без названия";
}

function toRecentRowItem(
  desk: PageProgress,
  row: PageProgress["rows"][number],
  statusOptions: StatusOption[],
  members: WorkspaceMember[]
): RecentRowItem {
  const statusCol = desk.columns.find((c) => c.type === "status");
  const priceCol = desk.columns.find((c) => c.type === "currency");
  const dateCol = desk.columns.find((c) => c.type === "date");
  const owner = members.find((m) => m.uid === desk.page.responsibleUserId) ?? null;
  const rawStatus = statusCol ? String(row.cells[statusCol.key] ?? "") : "";
  const opt = statusOptions.find((o) => o.value === rawStatus);
  const ms = dateCol ? Number(row.cells[dateCol.key]) : NaN;
  return {
    id: row.id,
    pageId: desk.page.id,
    pageName: desk.page.name,
    title: titleFromRow(desk, row.cells),
    statusValue: rawStatus,
    statusLabel: opt?.label ?? rawStatus,
    price: parseLooseNumber(String(row.cells[priceCol?.key ?? ""] ?? "")) ?? 0,
    dateMs: Number.isFinite(ms) && ms > 0 ? ms : null,
    updatedAt: row.updatedAt || row.createdAt || 0,
    responsibleLabel: personLabel(owner) || "—",
    responsibleUid: desk.page.responsibleUserId ?? null,
  };
}

export function collectRecentRows(
  desks: PageProgress[],
  statusOptions: StatusOption[],
  members: WorkspaceMember[],
  limit = 12
): RecentRowItem[] {
  const items: RecentRowItem[] = [];
  for (const desk of desks) {
    for (const row of desk.rows) {
      items.push(toRecentRowItem(desk, row, statusOptions, members));
    }
  }
  items.sort((a, b) => b.updatedAt - a.updatedAt);
  return items.slice(0, limit);
}

/**
 * Order-received date (column type date) is today in Asia/Almaty — never a deadline.
 * Own desks only. Uses ymdInTimeZone (Almaty calendar day), not device-local isSameLocalDay.
 */
export function collectTodayOrderRows(
  desks: PageProgress[],
  statusOptions: StatusOption[],
  members: WorkspaceMember[],
  responsibleUid: string,
  nowMs = Date.now()
): RecentRowItem[] {
  if (!responsibleUid) return [];
  const today = ymdInTimeZone(nowMs);
  const items: RecentRowItem[] = [];
  for (const desk of desks) {
    if (!isResponsibleForPage(desk.page, responsibleUid)) continue;
    for (const row of desk.rows) {
      const item = toRecentRowItem(desk, row, statusOptions, members);
      if (item.dateMs != null && ymdInTimeZone(item.dateMs) === today) items.push(item);
    }
  }
  items.sort((a, b) => (a.dateMs ?? 0) - (b.dateMs ?? 0) || b.updatedAt - a.updatedAt);
  return items;
}


export function matchesRecentStatusFilter(item: RecentRowItem, filter: string | null): boolean {
  if (!filter || filter === "all") return true;
  if (filter === "done") return isDoneStatusLabel(item.statusLabel);
  return item.statusValue === filter;
}
