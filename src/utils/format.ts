import { parseLooseNumber } from "@/utils/numberInput";

export function formatCurrency(value: number, currency = "KZT"): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value || 0);
}

/**
 * Formats a raw currency-cell string for display. A currency cell can hold
 * text the app deliberately couldn't parse (handleCommitEdit stores it as-is
 * with a "сохранено как текст" warning rather than losing it) — coercing
 * that through bare Number() gives NaN, which formatCurrency then silently
 * renders as "0 ₸", hiding what the user actually typed. Falls back to the
 * raw text when it isn't a recognizable number, matching how the sibling
 * "number" column type already handles this.
 */
export function formatCurrencyCell(raw: string): string {
  if (!raw) return "";
  const n = parseLooseNumber(raw);
  return n === null ? raw : formatCurrency(n);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value || 0);
}

export function parseNumeric(value: string): number {
  const digits = value.replace(/[^\d.-]/g, "");
  return parseFloat(digits) || 0;
}
