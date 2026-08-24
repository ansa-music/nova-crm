import type { ColumnType } from "@/types";

/** Floor so Disk / status / date chips are not crushed when a saved width is tiny. */
export function minColumnWidth(type: ColumnType): number {
  switch (type) {
    case "url":
      return 148;
    case "status":
    case "responsible":
    case "custom":
      return 132;
    case "date":
      return 128;
    case "currency":
    case "number":
      return 96;
    default:
      return 88;
  }
}

export function clampColumnWidth(type: ColumnType, width: number): number {
  return Math.max(minColumnWidth(type), Math.round(width));
}
