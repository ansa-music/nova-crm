import type { PageColumn, PageRow } from "@/types";

export const REPORT_RATES = [5, 8, 10, 12] as const;
export type ReportRate = typeof REPORT_RATES[number];

export interface ReportAggregate {
  rate: ReportRate;
  done: number;
  total: number;
}

function isDone(value: unknown, column?: PageColumn): boolean {
  const raw = String(value ?? "").toLowerCase();
  const label = column?.statusOptions?.find((option) => option.value === raw)?.label.toLowerCase() ?? raw;
  return ["done", "готово", "завершено", "complete", "выполнено"].some((item) => label.includes(item));
}

export function calculateReportAggregates(rows: PageRow[], columns: PageColumn[]): ReportAggregate[] {
  const price = columns.find((column) => column.type === "currency" || column.key === "price");
  const status = columns.find((column) => column.type === "status" || column.key === "status");
  const total = rows.reduce((sum, row) => sum + (Number(row.cells[price?.key ?? "price"]) || 0), 0);
  const done = rows.reduce((sum, row) => isDone(row.cells[status?.key ?? "status"], status)
    ? sum + (Number(row.cells[price?.key ?? "price"]) || 0) : sum, 0);
  return REPORT_RATES.map((rate) => ({ rate, done: done * rate / 100, total: total * rate / 100 }));
}
