import { isDoneStatusLabel } from "@/utils/columnOptions";
import type { PageProgress } from "@/utils/deskProgress";
import type { StatusOption, WorkspaceMember } from "@/types";
import { personLabel } from "@/utils/peopleDesks";

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

export function collectRecentRows(
  desks: PageProgress[],
  statusOptions: StatusOption[],
  members: WorkspaceMember[],
  limit = 12
): RecentRowItem[] {
  const items: RecentRowItem[] = [];
  for (const desk of desks) {
    const statusCol = desk.columns.find((c) => c.type === "status");
    const priceCol = desk.columns.find((c) => c.type === "currency");
    const dateCol = desk.columns.find((c) => c.type === "date");
    const owner = members.find((m) => m.uid === desk.page.responsibleUserId) ?? null;
    for (const row of desk.rows) {
      const rawStatus = statusCol ? String(row.cells[statusCol.key] ?? "") : "";
      const opt = statusOptions.find((o) => o.value === rawStatus);
      const ms = dateCol ? Number(row.cells[dateCol.key]) : NaN;
      items.push({
        id: row.id,
        pageId: desk.page.id,
        pageName: desk.page.name,
        title: titleFromRow(desk, row.cells),
        statusValue: rawStatus,
        statusLabel: opt?.label ?? rawStatus,
        price: Number(row.cells[priceCol?.key ?? ""] ?? 0) || 0,
        dateMs: Number.isFinite(ms) && ms > 0 ? ms : null,
        updatedAt: row.updatedAt || row.createdAt || 0,
        responsibleLabel: personLabel(owner) || "—",
        responsibleUid: desk.page.responsibleUserId ?? null,
      });
    }
  }
  items.sort((a, b) => b.updatedAt - a.updatedAt);
  return items.slice(0, limit);
}

export function matchesRecentStatusFilter(item: RecentRowItem, filter: string | null): boolean {
  if (!filter || filter === "all") return true;
  if (filter === "done") return isDoneStatusLabel(item.statusLabel);
  return item.statusValue === filter;
}
