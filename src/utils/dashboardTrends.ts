import { isDoneStatusLabel } from "@/utils/columnOptions";
import { USER_TIMEZONE, almatyMidnightMillis, almatyNoonMillis, ymdPartsInTimeZone } from "@/utils/date";
import { parseLooseNumber } from "@/utils/numberInput";
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

/**
 * Buckets dateMs+value pairs into `days` daily totals ending today (oldest
 * first), zero-filled where nothing happened. Bucketed by Asia/Almaty
 * calendar day (almatyMidnightMillis), not the viewer's own device
 * timezone — this trend shape is shown to every viewer regardless of where
 * they are, and a device-local day boundary would shift which bucket an
 * order near midnight lands in depending on who's looking.
 */
export function dailyTotals(entries: { dateMs: number; value: number }[], days = 14): number[] {
  const today = almatyMidnightMillis(Date.now());
  const start = today - (days - 1) * DAY_MS;
  const buckets = new Array(days).fill(0) as number[];
  for (const { dateMs, value } of entries) {
    const day = almatyMidnightMillis(dateMs);
    if (day < start || day > today) continue;
    const idx = Math.round((day - start) / DAY_MS);
    buckets[idx] += value;
  }
  return buckets;
}

/** Same as dailyTotals, but running-total — for "growth so far" shapes like desk count or cumulative revenue. */
export function cumulativeDailyTotals(entries: { dateMs: number; value: number }[], days = 14): number[] {
  const today = almatyMidnightMillis(Date.now());
  const start = today - (days - 1) * DAY_MS;
  const before = entries.filter((e) => almatyMidnightMillis(e.dateMs) < start).reduce((sum, e) => sum + e.value, 0);
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
      entries.push({ dateMs: ms, value: parseLooseNumber(String(row.cells[priceCol?.key ?? ""] ?? "")) ?? 0 });
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
      entries.push({ dateMs: ms, value: parseLooseNumber(String(row.cells[priceCol?.key ?? ""] ?? "")) ?? 0 });
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

/** "Готово · август" — current month in Asia/Almaty, nominative. */
export function countMonthCaption(kind: string, now = Date.now()): string {
  const name = new Date(now).toLocaleDateString("ru-RU", { month: "long", timeZone: USER_TIMEZONE });
  return `${kind} · ${name}`;
}

/** "Выручка · август" — current month in Asia/Almaty, nominative. */
export function revenueMonthCaption(now: number = Date.now()): string {
  const name = new Date(now).toLocaleDateString("ru-RU", { month: "long", timeZone: USER_TIMEZONE });
  return `Выручка · ${name}`;
}

function almatyMonthStart(year: number, monthIndex: number): number {
  return almatyNoonMillis(year, monthIndex, 1) - 12 * 60 * 60 * 1000;
}

/**
 * Revenue for the CURRENT Almaty month, using the same "order received" date
 * column and the same month boundaries revenueMonthDelta compares against —
 * so the tile's value, its «Выручка · <месяц>» caption and its delta all
 * describe the same period. The tile used to show the sum of every loaded
 * row (PageProgress.grandTotal has no date filter at all), i.e. an all-time
 * figure under a monthly label and next to a monthly delta.
 */
/**
 * «Готово» money for the CURRENT Almaty month, same order-date basis and
 * month boundaries as revenueMonthTotal, and the same workspace-wide status
 * resolution as doneTrend/progressForPage.
 *
 * This exists because `monthlyGoal` is explicitly a per-MONTH target ("На
 * месяц", "Готово и цель на месяц") while PageProgress.doneTotal is the
 * lifetime sum of every loaded row: a desk that hit 150k in August and 20k
 * in September showed 85% of a 200k September goal instead of 10%, and once
 * two good months had accumulated it sat pinned at 100% forever (the
 * Math.min(100, …) hid the overflow rather than fixing it). Desks that keep
 * each month in its own subpage tab were accidentally right, which is
 * exactly why the two kinds of desk disagreed.
 *
 * Falls back to the desk's own doneTotal when it has no date column at all —
 * there is no month to filter by, and showing 0% for such a desk would be
 * worse than the old behaviour.
 */
export function doneMonthTotal(
  // Only the three fields it actually reads, so callers with a single desk
  // in hand don't have to fabricate the rest of PageProgress.
  desks: Pick<PageProgress, "columns" | "rows" | "doneTotal">[],
  statusOptions: StatusOption[],
  now: number = Date.now()
): number {
  const { year, month } = ymdPartsInTimeZone(now, USER_TIMEZONE);
  const thisStart = almatyMonthStart(year, month);
  const nextStart = month === 11 ? almatyMonthStart(year + 1, 0) : almatyMonthStart(year, month + 1);
  let total = 0;
  for (const desk of desks) {
    const dateCol = desk.columns.find((c) => c.type === "date");
    const statusCol = desk.columns.find((c) => c.type === "status");
    if (!dateCol || !statusCol) {
      total += desk.doneTotal;
      continue;
    }
    const priceCol = desk.columns.find((c) => c.type === "currency");
    for (const row of desk.rows) {
      const ms = Number(row.cells[dateCol.key]);
      if (!Number.isFinite(ms) || ms < thisStart || ms >= nextStart) continue;
      const rawStatus = String(row.cells[statusCol.key] ?? "");
      const label = statusOptions.find((o) => o.value === rawStatus)?.label ?? rawStatus;
      if (!isDoneStatusLabel(label)) continue;
      total += parseLooseNumber(String(row.cells[priceCol?.key ?? ""] ?? "")) ?? 0;
    }
  }
  return total;
}

export function revenueMonthTotal(desks: PageProgress[], now: number = Date.now()): number {
  const { year, month } = ymdPartsInTimeZone(now, USER_TIMEZONE);
  const thisStart = almatyMonthStart(year, month);
  const nextStart = month === 11 ? almatyMonthStart(year + 1, 0) : almatyMonthStart(year, month + 1);
  let total = 0;
  for (const { dateMs, value } of orderEntries(desks)) {
    if (dateMs >= thisStart && dateMs < nextStart) total += value;
  }
  return total;
}

/**
 * Month-over-month % from the same order-received date column, using
 * Asia/Almaty month boundaries — was `now.getFullYear()`/`getMonth()`, the
 * VIEWER's own device timezone, so this delta and the "Выручка · <месяц>"
 * label right above it (and KpiStatsRow's own `thisMonth` highlight,
 * already Almaty-based) could each name a different month for the same
 * viewer near a month boundary.
 * "+18.5% к июлю" — still computed from already-loaded rows, no new writes.
 */
export function revenueMonthDelta(desks: PageProgress[], now: number = Date.now()): { text: string; tone: "up" | "down" | "flat" } {
  const { year, month } = ymdPartsInTimeZone(now, USER_TIMEZONE);
  const thisStart = almatyMonthStart(year, month);
  const nextStart = month === 11 ? almatyMonthStart(year + 1, 0) : almatyMonthStart(year, month + 1);
  const prevStart = month === 0 ? almatyMonthStart(year - 1, 11) : almatyMonthStart(year, month - 1);
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
