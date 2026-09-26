import type { PageRow } from "@/types";
import { isBlankRow } from "@/utils/blankRow";

/**
 * Порядок строк стола, когда сортировки по столбцу нет (просьба Nurba
 * 26.09.2026: «последнее внесённое — снизу; сортировка по времени, когда
 * внесли в таблицу, а не по дате, которую вписали; и чтобы можно было
 * новые сверху или снизу»).
 *
 * - `entry-asc`  — по времени внесения, новые снизу (умолчание);
 * - `entry-desc` — по времени внесения, новые сверху;
 * - `manual`     — как расставили руками (перетаскивание, «вставить строку»).
 */
export type RowOrderMode = "entry-asc" | "entry-desc" | "manual";

export const DEFAULT_ROW_ORDER_MODE: RowOrderMode = "entry-asc";

export const ROW_ORDER_MODE_LABELS: Record<RowOrderMode, string> = {
  "entry-asc": "Новые снизу",
  "entry-desc": "Новые сверху",
  manual: "Вручную",
};

export function isRowOrderMode(value: unknown): value is RowOrderMode {
  return value === "entry-asc" || value === "entry-desc" || value === "manual";
}

/** Когда строку завели. Никогда не updatedAt и не «сейчас». */
export function rowCreatedAtMs(row: PageRow): number {
  const value = row.createdAt as unknown;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object") {
    const ts = value as { toMillis?: () => number; seconds?: number };
    if (typeof ts.toMillis === "function") {
      const n = ts.toMillis();
      if (Number.isFinite(n)) return n;
    }
    if (typeof ts.seconds === "number" && Number.isFinite(ts.seconds)) return ts.seconds * 1000;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (typeof row.order === "number" && Number.isFinite(row.order)) return row.order;
  return 0;
}

export function compareRowsByCreatedAt(a: PageRow, b: PageRow): number {
  const delta = rowCreatedAtMs(a) - rowCreatedAtMs(b);
  if (delta !== 0) return delta;
  return a.id.localeCompare(b.id);
}

/**
 * Когда строку ВНЕСЛИ в таблицу: пустой слот заводят заранее (Enter на
 * последней строке, «Добавить строку»), а заказ в него вписывают позже —
 * тогда это момент первого заполнения (`filledAt`). Дата, которую вписали в
 * столбец-дату, тут ни при чём.
 */
export function rowEnteredAtMs(row: PageRow): number {
  const filled = typeof row.filledAt === "number" && Number.isFinite(row.filledAt) ? row.filledAt : 0;
  return Math.max(rowCreatedAtMs(row), filled);
}

export function compareRowsByEntered(a: PageRow, b: PageRow): number {
  const delta = rowEnteredAtMs(a) - rowEnteredAtMs(b);
  if (delta !== 0) return delta;
  return compareRowsByCreatedAt(a, b);
}

/**
 * Заполненные строки — по времени внесения; пустые слоты — отдельным блоком
 * там, где появятся новые (новые снизу — слоты внизу, новые сверху — слоты
 * наверху): вписанный в слот заказ остаётся на месте, а не прыгает через
 * всю таблицу.
 */
export function sortRowsByEntry<T extends PageRow>(rows: readonly T[], newestFirst: boolean): T[] {
  const filled: T[] = [];
  const blanks: T[] = [];
  for (const row of rows) (isBlankRow(row) ? blanks : filled).push(row);
  filled.sort((a, b) => (newestFirst ? compareRowsByEntered(b, a) : compareRowsByEntered(a, b)));
  blanks.sort(compareRowsByCreatedAt);
  return newestFirst ? [...blanks, ...filled] : [...filled, ...blanks];
}
