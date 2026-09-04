import { ymdInTimeZone } from "@/utils/date";
import { isDoneStatusLabel } from "@/utils/columnOptions";
import { parseLooseNumber } from "@/utils/numberInput";
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
    const raw = parseLooseNumber(String(row.cells[priceCol?.key ?? "price"] ?? "")) ?? 0;
    grandTotal += raw;
    if (statusCol) {
      const rawStatus = String(row.cells[statusCol.key] ?? "");
      // Status is fully workspace-wide (see getColumnOptions in
      // columnOptions.ts) — never prefer a column's own stale statusOptions,
      // or the dashboard's "Готово" total can silently disagree with what
      // the table itself shows for the same row.
      const label = statusOptions.find((o) => o.value === rawStatus)?.label ?? rawStatus;
      if (isDoneStatusLabel(label)) doneTotal += raw;
      else openCount += 1;
    }
  }
  const percent = grandTotal > 0 ? Math.round((doneTotal / grandTotal) * 100) : 0;
  return { page, doneTotal, grandTotal, percent, rowCount: rows.length, openCount, columns, rows };
}


/** Row counts for the current Asia/Almaty month, by order-received date. Pieces, not money. */
export function monthOrderCounts(
  desks: PageProgress[],
  statusOptions: StatusOption[],
  now = Date.now()
): { open: number; done: number; total: number } {
  const monthKey = ymdInTimeZone(now).slice(0, 7);
  let open = 0;
  let done = 0;
  let total = 0;
  for (const desk of desks) {
    const dateCol = desk.columns.find((c) => c.type === "date");
    const statusCol = desk.columns.find((c) => c.type === "status");
    if (!dateCol) continue;
    for (const row of desk.rows) {
      const ms = Number(row.cells[dateCol.key]);
      if (!Number.isFinite(ms) || ms <= 0) continue;
      if (ymdInTimeZone(ms).slice(0, 7) !== monthKey) continue;
      total += 1;
      if (!statusCol) {
        open += 1;
        continue;
      }
      const rawStatus = String(row.cells[statusCol.key] ?? "");
      const label = statusOptions.find((o) => o.value === rawStatus)?.label ?? rawStatus;
      if (isDoneStatusLabel(label)) done += 1;
      else open += 1;
    }
  }
  return { open, done, total };
}



/** Pieces across every loaded row. No date filter. Status via isDoneStatusLabel. */
export function nowOrderCounts(
  desks: PageProgress[],
  statusOptions: StatusOption[]
): { open: number; done: number } {
  let open = 0;
  let done = 0;
  for (const desk of desks) {
    const statusCol = desk.columns.find((c) => c.type === "status");
    for (const row of desk.rows) {
      if (!statusCol) {
        open += 1;
        continue;
      }
      const rawStatus = String(row.cells[statusCol.key] ?? "");
      const label = statusOptions.find((o) => o.value === rawStatus)?.label ?? rawStatus;
      if (isDoneStatusLabel(label)) done += 1;
      else open += 1;
    }
  }
  return { open, done };
}

export type MonthOrderCount = {
  key: string;
  label: string;
  open: number;
  done: number;
  total: number;
};

function monthLabelAlmaty(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  const ms = Date.UTC(year, month - 1, 15);
  return new Date(ms).toLocaleDateString("ru-RU", { month: "long", year: "numeric", timeZone: "Asia/Almaty" });
}

/** Pieces per Asia/Almaty month, by order-received date. Months stay separate. */
export function monthOrderCountsByMonth(
  desks: PageProgress[],
  statusOptions: StatusOption[]
): MonthOrderCount[] {
  const buckets = new Map<string, { open: number; done: number; total: number }>();
  for (const desk of desks) {
    const dateCol = desk.columns.find((c) => c.type === "date");
    const statusCol = desk.columns.find((c) => c.type === "status");
    if (!dateCol) continue;
    for (const row of desk.rows) {
      const ms = Number(row.cells[dateCol.key]);
      if (!Number.isFinite(ms) || ms <= 0) continue;
      const key = ymdInTimeZone(ms).slice(0, 7);
      const bucket = buckets.get(key) ?? { open: 0, done: 0, total: 0 };
      bucket.total += 1;
      if (!statusCol) {
        bucket.open += 1;
      } else {
        const rawStatus = String(row.cells[statusCol.key] ?? "");
        const label = statusOptions.find((o) => o.value === rawStatus)?.label ?? rawStatus;
        if (isDoneStatusLabel(label)) bucket.done += 1;
        else bucket.open += 1;
      }
      buckets.set(key, bucket);
    }
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, n]) => ({ key, label: monthLabelAlmaty(key), ...n }));
}

export function statusDistributionFromDesks(desks: PageProgress[], statusOptions: StatusOption[]) {
  const counts = new Map<string, number>();
  const byValue = new Map<string, StatusOption>();
  for (const opt of statusOptions) byValue.set(opt.value, opt);
  for (const desk of desks) {
    const statusCol = desk.columns.find((c) => c.type === "status");
    if (!statusCol) continue;
    // Never re-merge a column's own stale statusOptions over the
    // workspace-wide list — same reasoning as progressForPage above.
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
      // Asia/Almaty, like every other order-date bucketing in this file
      // (monthOrderCountsByMonth right above) — formatDate() has no
      // timeZone option and reads the VIEWER's own device clock, so an
      // order near midnight Almaty time could land in a different
      // month here than in the "По месяцам, штуки" card right below it.
      const sortKey = ymdInTimeZone(ms).slice(0, 7);
      const label = monthLabelAlmaty(sortKey);
      const amount = parseLooseNumber(String(row.cells[priceCol?.key ?? ""] ?? "")) ?? 0;
      const prev = buckets.get(sortKey);
      buckets.set(sortKey, { label, value: (prev?.value ?? 0) + amount });
    }
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v);
}
