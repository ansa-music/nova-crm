// PATH: src/utils/tableAggregates.ts  (NEW FILE)
import { percentOfMinor, sumMinor, toMinor } from "@/utils/money";
import type { PageColumn, PageRow } from "@/types";

/**
 * Derived table totals. NOTHING here is persisted — totals are always computed
 * from the rows, so they can never drift out of sync with the data (a stored
 * total that disagrees with its rows is unfixable without a migration).
 *
 * Scoping: every function takes the rows of ONE page or ONE subpage. Callers
 * must never merge rows across subpages, which is what keeps each month's
 * numbers independent.
 */

export const AGGREGATE_PERCENTS = [5, 8, 10, 12] as const;
export type AggregatePercent = (typeof AGGREGATE_PERCENTS)[number];

/** Status values that count as "Готово". Tolerant of legacy label variants. */
const DONE_VALUES = new Set(["done", "готово", "complete", "completed", "выполнено", "закрыто"]);

export function isDoneRow(row: PageRow, statusKey: string): boolean {
  const raw = row.cells[statusKey];
  if (raw === null || raw === undefined) return false;
  return DONE_VALUES.has(String(raw).trim().toLowerCase());
}

/** First currency column on the page, or the conventional `price` key. */
export function findPriceColumn(columns: PageColumn[]): PageColumn | null {
  return (
    columns.find((c) => c.type === "currency") ??
    columns.find((c) => c.key === "price") ??
    null
  );
}

export function findStatusColumn(columns: PageColumn[]): PageColumn | null {
  return columns.find((c) => c.type === "status") ?? columns.find((c) => c.key === "status") ?? null;
}

export interface TableTotals {
  /** Sum of Цена across rows whose Статус = Готово. Integer minor units. */
  doneMinor: number;
  /** Sum of Цена across ALL rows. Integer minor units. */
  totalMinor: number;
  /** totalMinor - doneMinor. */
  remainingMinor: number;
  doneCount: number;
  totalCount: number;
}

export function computeTableTotals(rows: PageRow[], columns: PageColumn[]): TableTotals {
  const priceColumn = findPriceColumn(columns);
  const statusColumn = findStatusColumn(columns);

  if (!priceColumn) {
    return { doneMinor: 0, totalMinor: 0, remainingMinor: 0, doneCount: 0, totalCount: rows.length };
  }

  const priceKey = priceColumn.key;
  const statusKey = statusColumn?.key ?? "status";

  const allMinor: number[] = [];
  const doneMinorValues: number[] = [];

  rows.forEach((row) => {
    const minor = toMinor(row.cells[priceKey] as number | string | null);
    allMinor.push(minor);
    if (statusColumn && isDoneRow(row, statusKey)) doneMinorValues.push(minor);
  });

  const totalMinor = sumMinor(allMinor);
  const doneMinor = sumMinor(doneMinorValues);

  return {
    doneMinor,
    totalMinor,
    remainingMinor: totalMinor - doneMinor,
    doneCount: doneMinorValues.length,
    totalCount: rows.length,
  };
}

export interface PercentAggregate {
  percent: AggregatePercent;
  doneMinor: number;
  totalMinor: number;
  remainingMinor: number;
}

/**
 * The 5/8/10/12% panel. Each rate is applied to the page's own totals, so two
 * different subpages (e.g. Август vs Сентябрь) can never contaminate each
 * other's numbers.
 */
export function computePercentAggregates(totals: TableTotals): PercentAggregate[] {
  return AGGREGATE_PERCENTS.map((percent) => {
    const doneMinor = percentOfMinor(totals.doneMinor, percent);
    const totalMinor = percentOfMinor(totals.totalMinor, percent);
    return { percent, doneMinor, totalMinor, remainingMinor: totalMinor - doneMinor };
  });
}
