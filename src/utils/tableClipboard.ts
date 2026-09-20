import type { ColumnType } from "@/types";

export interface TableClipboardColumn {
  label: string;
  type: ColumnType;
}

export type TableClipboardKind = "range" | "row" | "column";

export interface TableClipboardPayload {
  /** Ровно тот текст, что ушёл в системный буфер — по нему узнаём свою копию. */
  text: string;
  matrix: string[][];
  /** Подписи и типы столбцов источника, по одному на столбец матрицы. */
  columns: TableClipboardColumn[];
  kind: TableClipboardKind;
  /** Откуда копировали — «тот же стол» и «другой стол» ведут себя по-разному. */
  source: { pageId: string; subPageId: string | null; name: string };
  at: number;
}

let payload: TableClipboardPayload | null = null;

/**
 * Буфер таблицы живёт на модуле, а не в `useRef` внутри `DataTable`: при
 * переходе на другой стол компонент размонтируется, а «скопировать столбец
 * и вставить в другом столе» — ровно то, ради чего буфер и нужен.
 */
export function setTableClipboard(next: Omit<TableClipboardPayload, "at">) {
  payload = { ...next, at: Date.now() };
}

export function peekTableClipboard(): TableClipboardPayload | null {
  return payload;
}

function normalizeText(text: string) {
  return text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n+$/, "");
}

/**
 * Своя копия или чужая. Системный буфер — истина: раньше Ctrl+V смотрел во
 * внутренний буфер ПЕРВЫМ, и после «скопировал ячейку в таблице → скопировал
 * блок в Excel → вставил» приезжала старая ячейка из таблицы, а копия из
 * Excel молча терялась. `null` вместо текста значит «системный буфер прочитать
 * не дали» (Safari, отказ в разрешении) — вот тогда верим своему.
 */
export function readTableClipboard(systemText: string | null): TableClipboardPayload | null {
  if (!payload) return null;
  if (systemText == null) return payload;
  return normalizeText(systemText) === normalizeText(payload.text) ? payload : null;
}
