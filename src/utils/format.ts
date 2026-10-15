import { parseLooseNumber } from "@/utils/numberInput";

/**
 * Валюта КОМПАНИИ (workspace.region.currency, SaaS этап 1), по умолчанию
 * тенге. `let` с живой привязкой, как USER_TIMEZONE в utils/date.ts: меняет
 * только `setAppCurrency` (мост региона в AppLayout).
 */
export const DEFAULT_CURRENCY = "KZT";
export let APP_CURRENCY = DEFAULT_CURRENCY;

export function setAppCurrency(currency: string | null | undefined): boolean {
  const code = (currency ?? "").trim().toUpperCase();
  const next = /^[A-Z]{3}$/.test(code) && isKnownCurrency(code) ? code : DEFAULT_CURRENCY;
  if (next === APP_CURRENCY) return false;
  APP_CURRENCY = next;
  return true;
}

function isKnownCurrency(code: string): boolean {
  try {
    new Intl.NumberFormat("ru-RU", { style: "currency", currency: code }).format(0);
    return true;
  } catch {
    return false;
  }
}

const symbols = new Map<string, string>();

/** Короткий знак валюты компании: «₸», «₽», «$» (у кого знака нет — код). */
export function currencySymbol(currency = APP_CURRENCY): string {
  let s = symbols.get(currency);
  if (s === undefined) {
    try {
      s =
        new Intl.NumberFormat("ru-RU", { style: "currency", currency, currencyDisplay: "narrowSymbol" })
          .formatToParts(0)
          .find((part) => part.type === "currency")?.value ?? currency;
    } catch {
      s = currency;
    }
    symbols.set(currency, s);
  }
  return s;
}

/**
 * Суммы скрыты от того, кто смотрит (просьба Nurba 15.10.2026): Owner включил
 * `workspace.hideAmounts`, а смотрит не руководство (ОС, технарь…). Тогда все
 * денежные форматтеры отдают `HIDDEN_AMOUNT` вместо числа. `let` с живой
 * привязкой, как APP_CURRENCY: меняет только мост `useAmountsHiddenBridge`
 * (AppLayout). Там, где сумму видеть положено и при скрытии (окна выдачи
 * заказа, формы ввода, личная зона), — `formatCurrencyAlways`.
 */
export let AMOUNTS_HIDDEN = false;
export const HIDDEN_AMOUNT = "•••";
const amountsHiddenListeners = new Set<() => void>();
let amountsHiddenNotified = false;

/**
 * Ставится ПРИ ОТРИСОВКЕ каркаса, молча: страницы рисуются после него и сразу
 * видят нужное значение. Будить подписчиков посреди чужой отрисовки React не
 * даёт — это делает `flushAmountsHidden` из эффекта моста.
 */
export function setAmountsHidden(hidden: boolean): void {
  AMOUNTS_HIDDEN = hidden;
}

export function flushAmountsHidden(): void {
  if (amountsHiddenNotified === AMOUNTS_HIDDEN) return;
  amountsHiddenNotified = AMOUNTS_HIDDEN;
  for (const listener of [...amountsHiddenListeners]) listener();
}

export function amountsHiddenSnapshot(): boolean {
  return AMOUNTS_HIDDEN;
}

export function subscribeAmountsHidden(listener: () => void): () => void {
  amountsHiddenListeners.add(listener);
  return () => amountsHiddenListeners.delete(listener);
}

/** Сумма — или «•••», если суммы от смотрящего скрыты. Для своих склеек (`formatNumber` + знак). */
export function maskAmount(text: string): string {
  return AMOUNTS_HIDDEN ? HIDDEN_AMOUNT : text;
}

export function formatCurrency(value: number, currency = APP_CURRENCY): string {
  if (AMOUNTS_HIDDEN) return HIDDEN_AMOUNT;
  return formatCurrencyAlways(value, currency);
}

/** Сумма всегда, даже когда суммы скрыты: окна выдачи заказа, формы ввода, личная зона. */
export function formatCurrencyAlways(value: number, currency = APP_CURRENCY): string {
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
  // Скрыто и текстом: «сохранено как текст» в денежной ячейке — тоже сумма.
  if (AMOUNTS_HIDDEN) return HIDDEN_AMOUNT;
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
