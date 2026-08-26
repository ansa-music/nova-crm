import { isDoneStatusLabel } from "@/utils/columnOptions";
import type { PageProgress } from "@/utils/deskProgress";
import type { StatusOption, WorkspacePage } from "@/types";

const DAY_MS = 86_400_000;
const MONTHS_DATIVE = [
  "январю",
  "февралю",
  "марту",
  "апрелю",
  "маю",
  "июню",
  "июлю",
  "августу",
  "сентябрю",
  "октябрю",
  "ноябрю",
  "декабрю",
];

function localMidnight(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Buckets dateMs+value pairs into `days` daily totals ending today (oldest
 * first), zero-filled where nothing happened.
 */
export function dailyTotals(entries: { dateMs: number; value: number }[], days = 14): number[] {
  const today = localMidnight(Date.now());
  const start = today - (days - 1) * DAY_MS;
  const buckets = new Array(days).fill(0) as number[];
  for (const { dateMs, value } of entries) {
    const day = localMidnight(dateMs);
    if (day < start || day > today) continue;
    const idx = Math.round((day - start) / DAY_MS);
    buckets[idx] += value;
  }
  return buckets;
}

/** Same as dailyTotals, but running-total — for "growth so far" shapes like desk count or cumulative revenue. */
export function cumulativeDailyTotals(entries: { dateMs: number; value: number }[], days = 14): number[] {
  const today = localMidnight(Date.now());
  const start = today - (days - 1) * DAY_MS;
  const before = entries.filter((e) => localMidnight(e.dateMs) < start).reduce((sum, e) => sum + e.value, 0);
  let running = before;
  return dailyTotals(entries, days).map((v) => (running += v));
}

/** Desks created per day, last `days` days, as a growth curve. */
export function deskCountTrend(pages: WorkspacePage[], days = 14): number[] {
  return cumulativeDailyTotals(
    pages.map((p) => ({ dateMs: p.createdAt, value: 1 })),
    days
  );
}

function orderEntries(desks: PageProgress[]): { dateMs: number; value: number }[] {
  const entries: { dateMs: number; value: number }[] = [];
  for (const desk of desks) {
    const dateCol = desk.columns.find((c) => c.type === "date");
    const priceCol = desk.columns.find((c) => c.type === "currency");
    if (!dateCol) continue;
    for (const row of desk.rows) {
      const ms = Number(row.cells[dateCol.key]);
      if (!Number.isFinite(ms) || ms <= 0) continue;
      entries.push({ dateMs: ms, value: Number(row.cells[priceCol?.key ?? ""] ?? 0) || 0 });
    }
  }
  return entries;
}

/** Revenue trend shape — same "order received" date column ordersByDateFromDesks already uses, bucketed daily. */
export function revenueTrend(desks: PageProgress[], days = 14): number[] {
  return cumulativeDailyTotals(orderEntries(desks), days);
}

/**
 * "Готово" trend shape (currency, cumulative). Resolves status labels only
 * from the workspace-wide `statusOptions` — never a column's own stale
 * statusOptions field — matching getColumnOptions()/progressForPage().
 */
export function doneTrend(desks: PageProgress[], statusOptions: StatusOption[], days = 14): number[] {
  const entries: { dateMs: number; value: number }[] = [];
  for (const desk of desks) {
    const dateCol = desk.columns.find((c) => c.type === "date");
    const statusCol = desk.columns.find((c) => c.type === "status");
    const priceCol = desk.columns.find((c) => c.type === "currency");
    if (!dateCol || !statusCol) continue;
    for (const row of desk.rows) {
      const ms = Number(row.cells[dateCol.key]);
      if (!Number.isFinite(ms) || ms <= 0) continue;
      const rawStatus = String(row.cells[statusCol.key] ?? "");
      const label = statusOptions.find((o) => o.value === rawStatus)?.label ?? rawStatus;
      if (!isDoneStatusLabel(label)) continue;
      entries.push({ dateMs: ms, value: Number(row.cells[priceCol?.key ?? ""] ?? 0) || 0 });
    }
  }
  return cumulativeDailyTotals(entries, days);
}

/** Open (not-done) rows logged per day — a daily activity shape, not a running balance. */
export function openCountTrend(desks: PageProgress[], statusOptions: StatusOption[], days = 14): number[] {
  const entries: { dateMs: number; value: number }[] = [];
  for (const desk of desks) {
    const dateCol = desk.columns.find((c) => c.type === "date");
    const statusCol = desk.columns.find((c) => c.type === "status");
    if (!dateCol || !statusCol) continue;
    for (const row of desk.rows) {
      const ms = Number(row.cells[dateCol.key]);
      if (!Number.isFinite(ms) || ms <= 0) continue;
      const rawStatus = String(row.cells[statusCol.key] ?? "");
      const label = statusOptions.find((o) => o.value === rawStatus)?.label ?? rawStatus;
      if (isDoneStatusLabel(label)) continue;
      entries.push({ dateMs: ms, value: 1 });
    }
  }
  return dailyTotals(entries, days);
}

/** "+2 за неделю" / "−3 за неделю" footer text, comparing the last 7 days of a trend against the 7 before it. */
export function weekDelta(trend: number[]): { text: string; tone: "up" | "down" | "flat" } {
  if (trend.length < 8) return { text: "", tone: "flat" };
  const change = trend[trend.length - 1] - trend[trend.length - 8];
  if (Math.round(change) === 0) return { text: "без изменений за неделю", tone: "flat" };
  const sign = change > 0 ? "+" : "−";
  return { text: `${sign}${Math.abs(Math.round(change))} за неделю`, tone: change > 0 ? "up" : "down" };
}

/** "Выручка · август" — current month, nominative, from local clock. */
export function revenueMonthCaption(now = new Date()): string {
  const name = now.toLocaleDateString("ru-RU", { month: "long" });
  return `Выручка · ${name}`;
}

/**
 * Month-over-month % from the same order-received date column.
 * "+18.5% к июлю" — still computed from already-loaded rows, no new writes.
 */
export function revenueMonthDelta(desks: PageProgress[], now = new Date()): { text: string; tone: "up" | "down" | "flat" } {
  const year = now.getFullYear();
  const month = now.getMonth();
  const thisStart = new Date(year, month, 1).getTime();
  const nextStart = new Date(year, month + 1, 1).getTime();
  const prevStart = new Date(year, month - 1, 1).getTime();
  let current = 0;
  let previous = 0;
  for (const { dateMs, value } of orderEntries(desks)) {
    if (dateMs >= thisStart && dateMs < nextStart) current += value;
    else if (dateMs >= prevStart && dateMs < thisStart) previous += value;
  }
  const prevName = MONTHS_DATIVE[(month + 11) % 12];
  if (previous === 0) {
    if (current === 0) return { text: "", tone: "flat" };
    return { text: `к ${prevName} нет базы`, tone: "flat" };
  }
  const pct = ((current - previous) / previous) * 100;
  if (Math.abs(pct) < 0.05) return { text: `без изменений к ${prevName}`, tone: "flat" };
  const sign = pct > 0 ? "+" : "−";
  return { text: `${sign}${Math.abs(pct).toFixed(1)}% к ${prevName}`, tone: pct > 0 ? "up" : "down" };
}
