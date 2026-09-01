/**
 * Parses what a person typed into a number / currency cell into a canonical
 * numeric string that every aggregate, sort and formatter in the app agrees
 * on. Accepts the forms people actually type on a Russian keyboard:
 *   "1 500"      → "1500"
 *   "1 500,50"   → "1500.5"
 *   "2.000"      → "2000"   (thousands dot, no decimals)
 *   "2.5"        → "2.5"
 *   "12 000 ₸"   → "12000"
 *   "-300"       → "-300"
 *   "1500=1200+300" → left as typed (unparseable), caller decides
 *
 * Returns `null` when the input has no recognisable number at all, so the
 * caller can keep the raw text (and warn) instead of silently storing 0.
 */
export function parseLooseNumber(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  s = s
    .replace(/[\s\u00a0\u202f]/g, "")
    .replace(/(руб|тг|тенге|kzt|rub|usd|eur)\.?/gi, "")
    .replace(/[₸$€₽]/g, "");
  // Reject anything with letters or math operators — that's not a number.
  if (/[^0-9.,+-]/.test(s)) return null;
  if (/[+]/.test(s.slice(1)) || (s.match(/-/g) ?? []).length > 1) return null;
  const negative = s.startsWith("-");
  s = s.replace(/^[+-]/, "").replace(/[.,]$/, "");
  if (!s) return null;

  const dots = (s.match(/\./g) ?? []).length;
  const commas = (s.match(/,/g) ?? []).length;

  let normalized: string;
  if (commas > 0 && dots > 0) {
    // Both present: whichever comes LAST is the decimal separator.
    const lastDot = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");
    const decimalSep = lastDot > lastComma ? "." : ",";
    const thousandsSep = decimalSep === "." ? "," : ".";
    normalized = s.split(thousandsSep).join("").replace(decimalSep, ".");
  } else if (commas === 1) {
    // "2,000" is a thousands group (exactly 3 digits after), "2,5" is decimal.
    const [, frac] = s.split(",");
    normalized = frac.length === 3 ? s.replace(",", "") : s.replace(",", ".");
  } else if (commas > 1) {
    normalized = s.split(",").join("");
  } else if (dots === 1) {
    // "2.000" is a thousands group (exactly 3 digits after), "2.5" is decimal.
    const [, frac] = s.split(".");
    normalized = frac.length === 3 ? s.replace(".", "") : s;
  } else if (dots > 1) {
    normalized = s.split(".").join("");
  } else {
    normalized = s;
  }

  if (!/^\d*(\.\d+)?$/.test(normalized) || normalized === "" || normalized === ".") return null;
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** Canonical storage form for a numeric cell — no thousands separators, dot decimal, no trailing zeros. */
export function normalizeNumericInput(raw: string): string {
  const n = parseLooseNumber(raw);
  if (n === null) return raw.trim();
  // Keep up to 2 decimals for money-like input; avoid "0.30000000000000004".
  const rounded = Math.round(n * 100) / 100;
  return String(rounded);
}
