import { formatDate } from "@/utils/date";
import { isDoneStatusLabel } from "@/utils/columnOptions";
import type { PageColumn, PageRow, StatusOption, SubPage, WorkspacePage } from "@/types";

export interface PageProgress {
  page: WorkspacePage;
  doneTotal: number;
  grandTotal: number;
  percent: number;
  rowCount: number;
  openCount: number;
  columns: PageColumn[];
  rows: PageRow[];
}

export function progressForPage(
  page: WorkspacePage,
  subPagesByPage: Record<string, SubPage[]>,
  rowsBySubPage: Record<string, PageRow[]>,
  rowsByPage: Record<string, PageRow[]>,
  statusOptions: StatusOption[]
): PageProgress {
  const defaultSubPage = page.defaultSubPageId
    ? subPagesByPage[page.id]?.find((s) => s.id === page.defaultSubPageId)
    : undefined;
  const columns = defaultSubPage ? defaultSubPage.columns : page.columns;
  const rows = defaultSubPage ? rowsBySubPage[defaultSubPage.id] ?? [] : rowsByPage[page.id] ?? [];

  const priceCol = columns.find((c) => c.type === "currency");
  const statusCol = columns.find((c) => c.type === "status");
  let grandTotal = 0;
  let doneTotal = 0;
  let openCount = 0;
  for (const row of rows) {
    const raw = Number(row.cells[priceCol?.key ?? "price"] ?? 0) || 0;
    grandTotal += raw;
    if (statusCol) {
      const rawStatus = String(row.cells[statusCol.key] ?? "");
      const options = statusCol.statusOptions?.length ? statusCol.statusOptions : statusOptions;
      const label = options.find((o) => o.value === rawStatus)?.label ?? rawStatus;
      if (isDoneStatusLabel(label)) doneTotal += raw;
      else openCount += 1;
    }
  }
  const percent = grandTotal > 0 ? Math.round((doneTotal / grandTotal) * 100) : 0;
  return { page, doneTotal, grandTotal, percent, rowCount: rows.length, openCount, columns, rows };
}

export function statusDistributionFromDesks(desks: PageProgress[], statusOptions: StatusOption[]) {
  const counts = new Map<string, number>();
  const byValue = new Map<string, StatusOption>();
  for (const opt of statusOptions) byValue.set(opt.value, opt);
  for (const desk of desks) {
    const statusCol = desk.columns.find((c) => c.type === "status");
    if (!statusCol) continue;
    for (const opt of statusCol.statusOptions ?? []) byValue.set(opt.value, opt);
    for (const row of desk.rows) {
      const raw = String(row.cells[statusCol.key] ?? "");
      if (!raw) continue;
      counts.set(raw, (counts.get(raw) ?? 0) + 1);
    }
  }
  return [...byValue.values()].map((opt) => ({
    name: opt.label,
    value: counts.get(opt.value) ?? 0,
    color: opt.color,
  }));
}

/** Buckets currency totals by order-received date columns — never a deadline. */
export function ordersByDateFromDesks(desks: PageProgress[]) {
  const buckets = new Map<string, { label: string; value: number }>();
  for (const desk of desks) {
    const dateCol = desk.columns.find((c) => c.type === "date");
    const priceCol = desk.columns.find((c) => c.type === "currency");
    if (!dateCol) continue;
    for (const row of desk.rows) {
      const ms = Number(row.cells[dateCol.key]);
      if (!Number.isFinite(ms) || ms <= 0) continue;
      const sortKey = formatDate(ms, "yyyy-MM");
      const label = formatDate(ms, "LLL yyyy");
      const amount = Number(row.cells[priceCol?.key ?? ""] ?? 0) || 0;
      const prev = buckets.get(sortKey);
      buckets.set(sortKey, { label, value: (prev?.value ?? 0) + amount });
    }
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v);
}
