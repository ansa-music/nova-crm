export interface CellAddress {
  rowId: string;
  colKey: string;
}

export interface SelectionBounds {
  rowStart: number;
  rowEnd: number;
  colStart: number;
  colEnd: number;
}

export type SortDirection = "asc" | "desc" | null;

export interface SortState {
  colKey: string | null;
  direction: SortDirection;
}

export interface ClipboardPayload {
  matrix: string[][];
}
