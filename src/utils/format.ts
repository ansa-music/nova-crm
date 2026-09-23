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

/**
 * Русское склонение по числу: pluralRu(3, ["строка", "строки", "строк"]) →
 * «строки». Нужен нижней полосе стола («16 строк · 3 группы»): Intl.PluralRules
 * даёт те же категории, но требует таблицу форм в каждом месте вызова.
 */
export function pluralRu(n: number, forms: readonly [string, string, string]): string {
  const abs = Math.abs(Math.trunc(n));
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}

/** «16 строк» — число и склонённое слово одной строкой. */
export function formatCount(n: number, forms: readonly [string, string, string]): string {
  return `${formatNumber(n)} ${pluralRu(n, forms)}`;
}
