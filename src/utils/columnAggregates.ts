import type { ColumnType, PageColumn, PageRow, StatusOption } from "@/types";
import { formatCurrency, formatNumber } from "@/utils/format";
import { formatOrderDate } from "@/utils/date";
import { parseLooseNumber } from "@/utils/numberInput";
import { isOptionColumn } from "@/utils/columnOptions";

/**
 * Footer aggregates, Airtable-style: every column can show ONE summary of
 * the currently filtered rows — a sum for money, "filled 12/40" for text,
 * the latest date, how many distinct values, and so on. The choice is
 * per view (page or subpage) and lives in localStorage; nothing is
 * persisted to Firestore because the numbers are always derived.
 */
export type AggregateKind =
  | "none"
  | "sum"
  | "avg"
  | "min"
  | "max"
  | "median"
  | "count"
  | "filled"
  | "empty"
  | "unique"
  | "percentFilled"
  | "earliest"
  | "latest"
  | "done";

export const AGGREGATE_LABELS: Record<AggregateKind, string> = {
  none: "Ничего",
  sum: "Сумма",
  avg: "Среднее",
  min: "Минимум",
  max: "Максимум",
  median: "Медиана",
  count: "Строк",
  filled: "Заполнено",
  empty: "Пусто",
  unique: "Уникальных",
  percentFilled: "% заполнено",
  earliest: "Самая ранняя",
  latest: "Самая поздняя",
  done: "Готово (сумма)",
};

export function aggregateKindsForColumn(type: ColumnType, hasStatusColumn: boolean): AggregateKind[] {
  if (type === "number" || type === "currency") {
    const kinds: AggregateKind[] = ["none", "sum", "avg", "min", "max", "median", "filled", "empty", "unique"];
    if (type === "currency" && hasStatusColumn) kinds.splice(2, 0, "done");
    return kinds;
  }
  if (type === "date") return ["none", "filled", "empty", "earliest", "latest"];
  return ["none", "filled", "empty", "percentFilled", "unique", "count"];
}

export function defaultAggregateFor(type: ColumnType): AggregateKind {
  if (type === "number" || type === "currency") return "sum";
  return "none";
}

function storageKey(viewKey: string) {
  return `nova-crm:column-aggregates:${viewKey}`;
}

export function loadColumnAggregates(viewKey: string): Record<string, AggregateKind> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storageKey(viewKey));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    const out: Record<string, AggregateKind> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v in AGGREGATE_LABELS) out[k] = v as AggregateKind;
    }
    return out;
  } catch {
    return {};
  }
}

export function writeColumnAggregates(viewKey: string, value: Record<string, AggregateKind>) {
  try {
    window.localStorage.setItem(storageKey(viewKey), JSON.stringify(value));
  } catch {
    /* private mode — non-fatal */
  }
}

function cellIsFilled(raw: string | number | null | undefined): boolean {
  return raw !== null && raw !== undefined && String(raw).trim() !== "";
}

function numericValues(rows: PageRow[], key: string): number[] {
  const out: number[] = [];
  for (const row of rows) {
    const raw = row.cells[key];
    if (raw === null || raw === undefined || raw === "") continue;
    const n = typeof raw === "number" ? raw : parseLooseNumber(String(raw));
    if (n !== null && Number.isFinite(n)) out.push(n);
  }
  return out;
}

export interface AggregateResult {
  kind: AggregateKind;
  /** Short display string, already formatted for the column type. */
  text: string;
  /** Longer tooltip. */
  title: string;
}

export function computeAggregate(
  column: PageColumn,
  rows: PageRow[],
  kind: AggregateKind,
  opts: { statusColumn?: PageColumn | null; statusOptions?: StatusOption[]; isDoneLabel?: (label: string) => boolean }
): AggregateResult | null {
  if (kind === "none") return null;
  const key = column.key;
  const isMoney = column.type === "currency";
  const fmt = (n: number) => (isMoney ? formatCurrency(n) : formatNumber(Math.round(n * 100) / 100));
  const total = rows.length;
  const filled = rows.filter((r) => cellIsFilled(r.cells[key])).length;

  switch (kind) {
    case "count":
      return { kind, text: formatNumber(total), title: `Строк в фильтре: ${total}` };
    case "filled":
      return { kind, text: `${filled}/${total}`, title: `Заполнено ${filled} из ${total}` };
    case "empty":
      return { kind, text: formatNumber(total - filled), title: `Пустых ячеек: ${total - filled}` };
    case "percentFilled": {
      const pct = total === 0 ? 0 : Math.round((filled / total) * 100);
      return { kind, text: `${pct}%`, title: `Заполнено ${filled} из ${total} (${pct}%)` };
    }
    case "unique": {
      const set = new Set<string>();
      for (const r of rows) {
        const raw = r.cells[key];
        if (cellIsFilled(raw)) set.add(String(raw).trim().toLowerCase());
      }
      return { kind, text: formatNumber(set.size), title: `Уникальных значений: ${set.size}` };
    }
    case "earliest":
    case "latest": {
      const nums = numericValues(rows, key).filter((n) => n > 0);
      if (nums.length === 0) return { kind, text: "—", title: "Нет дат" };
      const v = kind === "earliest" ? Math.min(...nums) : Math.max(...nums);
      return { kind, text: formatOrderDate(v), title: `${AGGREGATE_LABELS[kind]}: ${formatOrderDate(v)}` };
    }
    case "done": {
      const statusCol = opts.statusColumn;
      if (!statusCol) return null;
      let sum = 0;
      for (const r of rows) {
        const rawStatus = String(r.cells[statusCol.key] ?? "");
        const label = opts.statusOptions?.find((o) => o.value === rawStatus)?.label ?? rawStatus;
        if (opts.isDoneLabel?.(label)) {
          const n = parseLooseNumber(String(r.cells[key] ?? ""));
          if (n !== null) sum += n;
        }
      }
      return { kind, text: fmt(sum), title: `Сумма по строкам со статусом «Готово»: ${fmt(sum)}` };
    }
    default:
      break;
  }

  const nums = numericValues(rows, key);
  if (nums.length === 0) return { kind, text: "—", title: "Нет чисел" };
  let value: number;
  switch (kind) {
    case "sum":
      value = nums.reduce((a, b) => a + b, 0);
      break;
    case "avg":
      value = nums.reduce((a, b) => a + b, 0) / nums.length;
      break;
    case "min":
      value = Math.min(...nums);
      break;
    case "max":
      value = Math.max(...nums);
      break;
    case "median": {
      const sorted = [...nums].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      value = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
      break;
    }
    default:
      return null;
  }
  return { kind, text: fmt(value), title: `${AGGREGATE_LABELS[kind]} (${nums.length} знач.): ${fmt(value)}` };
}

/** Selection footer: sum / average / count of numbers inside a cell range. */
export function summarizeSelection(
  rows: PageRow[],
  columns: PageColumn[]
): { sum: number; avg: number; count: number; cells: number } | null {
  let sum = 0;
  let count = 0;
  let cells = 0;
  for (const row of rows) {
    for (const col of columns) {
      cells += 1;
      if (col.type !== "number" && col.type !== "currency") continue;
      const raw = row.cells[col.key];
      if (raw === null || raw === undefined || raw === "") continue;
      const n = typeof raw === "number" ? raw : parseLooseNumber(String(raw));
      if (n === null) continue;
      sum += n;
      count += 1;
    }
  }
  if (cells <= 1 && count <= 1) return null;
  return { sum, avg: count ? sum / count : 0, count, cells };
}

export function isAggregatableOptionColumn(type: ColumnType): boolean {
  return isOptionColumn(type);
}
