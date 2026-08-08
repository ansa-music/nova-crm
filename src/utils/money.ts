// PATH: src/utils/money.ts  (NEW FILE)
/**
 * All money in Nova CRM is stored as an INTEGER number of minor units
 * (tiyn — 1/100 ₸). Never as a float, never as formatted text.
 *
 * Why: percent aggregates (5/8/10/12%) over hundreds of rows accumulate
 * float error fast — 0.1 + 0.2 !== 0.3 compounds into visibly wrong totals,
 * and "my Сумма is off by 3 ₸" is the kind of bug that destroys trust in a
 * finance tool. Integer minor units make every operation exact and every
 * aggregate deterministic regardless of summation order.
 *
 * BACKWARD COMPATIBILITY: existing `currency` cells hold whole tenge as plain
 * numbers. `toMinor()` is the single entry point and treats any incoming
 * number as MAJOR units, so old rows keep reading correctly with no migration.
 */

export const MINOR_UNITS_PER_MAJOR = 100;

/** Major units (₸, possibly fractional) -> integer minor units. Half-up. */
export function toMinor(major: number | string | null | undefined): number {
  if (major === null || major === undefined || major === "") return 0;
  const n = typeof major === "number" ? major : parseAmount(String(major));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * MINOR_UNITS_PER_MAJOR);
}

/** Integer minor units -> major units for display maths only. */
export function toMajor(minor: number): number {
  return minor / MINOR_UNITS_PER_MAJOR;
}

/** Exact summation. Inputs are integers, so this can never drift. */
export function sumMinor(values: number[]): number {
  let total = 0;
  for (const v of values) total += Math.round(v) || 0;
  return total;
}

/**
 * Deterministic percentage of an integer minor amount.
 * Uses integer maths + half-up rounding so the same inputs ALWAYS produce the
 * same output, on every device, in any order.
 */
export function percentOfMinor(minor: number, percent: number): number {
  return Math.round((minor * percent) / 100);
}

/**
 * Parses free-form user input into major units.
 * Accepts "2000", "2 000", "2.000", "2,5", "1 500 ₸", "-300".
 * Returns NaN when there is no number at all, so callers can distinguish
 * "user typed nothing numeric" from "user typed 0".
 */
export function parseAmount(input: string): number {
  const cleaned = input
    .replace(/[\s\u00a0\u202f]/g, "")   // spaces incl. non-breaking/narrow
    .replace(/[₸$€₽]/g, "")
    .replace(/,/g, ".");
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) return Number.NaN;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : Number.NaN;
}

/** Display: 200000 (minor) -> "2 000 ₸". Never used for storage. */
export function formatMoney(minor: number, currency = "KZT"): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    maximumFractionDigits: minor % MINOR_UNITS_PER_MAJOR === 0 ? 0 : 2,
  }).format(toMajor(minor));
}

/** Compact signed display for the finance feed: "− 2 000 ₸" / "+ 50 000 ₸". */
export function formatSigned(minor: number, type: "income" | "expense", currency = "KZT"): string {
  const sign = type === "income" ? "+" : "−";
  return `${sign} ${formatMoney(Math.abs(minor), currency)}`;
}
