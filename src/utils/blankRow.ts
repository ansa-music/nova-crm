import type { PageRow } from "@/types";
import { hasRowExtras } from "@/utils/rowExtras";

export function isFilledCellValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  return String(value).trim() !== "";
}

/**
 * A row nobody has typed anything into — a free slot, not an order. Counts,
 * footers, kanban and «Технари» skip it, and adding a row fills the first
 * free slot instead of appending one more blank row below it. Files or
 * quick-order extras make a row real even with empty cells.
 */
export function isBlankRow(row: Pick<PageRow, "cells"> & Partial<Pick<PageRow, "attachments" | "extras">>): boolean {
  if (row.attachments && row.attachments.length > 0) return false;
  if (hasRowExtras(row.extras)) return false;
  const cells = row.cells ?? {};
  for (const key in cells) {
    if (isFilledCellValue(cells[key])) return false;
  }
  return true;
}

export function countFilledRows(rows: PageRow[]): number {
  let n = 0;
  for (const row of rows) if (!isBlankRow(row)) n += 1;
  return n;
}
