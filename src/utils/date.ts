import { formatDistanceToNow, format, isValid, parse } from "date-fns";
import { ru } from "date-fns/locale";

/**
 * Normalizes a timestamp value to a plain millisecond number. Handles both
 * the normal case (already a number) and a Firestore Timestamp object
 * (has .toMillis()/.seconds) slipping through from a document that was
 * written with serverTimestamp() — defensive fallback so a stray malformed
 * value can never crash date rendering and take down the whole app.
 */
export function normalizeTimestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object") {
    const maybeTimestamp = value as { toMillis?: () => number; seconds?: number };
    if (typeof maybeTimestamp.toMillis === "function") return maybeTimestamp.toMillis();
    if (typeof maybeTimestamp.seconds === "number") return maybeTimestamp.seconds * 1000;
  }
  return Date.now();
}

function toMillis(value: unknown): number {
  return normalizeTimestamp(value);
}

export function timeAgo(timestamp: number): string {
  return formatDistanceToNow(new Date(toMillis(timestamp)), { addSuffix: true, locale: ru });
}

export function formatDate(timestamp: number, pattern = "d MMM yyyy, HH:mm"): string {
  return format(new Date(toMillis(timestamp)), pattern, { locale: ru });
}

/** Live remaining time until a Grok limit reset, e.g. "через 2ч 15м". */
export function formatResetCountdown(at: number, now: number = Date.now()): string {
  const diff = at - now;
  if (diff <= 0) return "сейчас";
  const totalMin = Math.floor(diff / 60_000);
  if (totalMin < 1) return "скоро";
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours <= 0) return `через ${mins}м`;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const restHours = hours % 24;
    return restHours === 0 ? `через ${days}д` : `через ${days}д ${restHours}ч`;
  }
  if (mins === 0) return `через ${hours}ч`;
  return `через ${hours}ч ${mins}м`;
}

/** "26.08 17:25" — day, month, time. Year is inferred (this year, or next if that moment already passed). Local wall-clock. */
export const MANUAL_DATETIME_FORMAT = "dd.MM HH:mm";
export const MANUAL_DATETIME_PLACEHOLDER = "26.08 17:25";
const MANUAL_DATETIME_FORMAT_LEGACY = "dd.MM.yyyy HH:mm";

export function formatDateTimeManual(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "";
  return format(new Date(ms), MANUAL_DATETIME_FORMAT);
}

/**
 * Feed this the input's raw value on every keystroke and set the field to
 * the result — strips everything but digits, then re-inserts the dot, space,
 * and colon as you type (26→26.→26.08→26.08 1→26.08 17:25). Eight digits,
 * no year. Pasting the old 12-digit "26.08.2026 17:25" drops the year.
 */
export function autoFormatManualDateTimeInput(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.length > 8) {
    digits = digits.slice(0, 4) + digits.slice(8, 12);
  }
  digits = digits.slice(0, 8);
  let out = digits.slice(0, 2);
  if (digits.length > 2) out += "." + digits.slice(2, 4);
  if (digits.length > 4) out += " " + digits.slice(4, 6);
  if (digits.length > 6) out += ":" + digits.slice(6, 8);
  return out;
}

function applyInferredYear(parsed: Date, now: number): Date {
  const n = new Date(now);
  let d = new Date(n.getFullYear(), parsed.getMonth(), parsed.getDate(), parsed.getHours(), parsed.getMinutes(), 0, 0);
  if (d.getTime() < now - 12 * 60 * 60 * 1000) {
    d = new Date(n.getFullYear() + 1, parsed.getMonth(), parsed.getDate(), parsed.getHours(), parsed.getMinutes(), 0, 0);
  }
  return d;
}

/** Same calendar day on the device's local clock — not UTC, matches how the manual field is typed/read. */
export function isSameLocalDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

/** Returns null for an empty string ("no date set"), or undefined if the text doesn't parse as a valid date. */
export function parseDateTimeManual(value: string, now: number = Date.now()): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const legacy = parse(trimmed, MANUAL_DATETIME_FORMAT_LEGACY, new Date(now));
  if (isValid(legacy) && format(legacy, MANUAL_DATETIME_FORMAT_LEGACY) === trimmed) {
    return legacy.getTime();
  }
  const parsed = parse(trimmed, MANUAL_DATETIME_FORMAT, new Date(now));
  if (!isValid(parsed) || format(parsed, MANUAL_DATETIME_FORMAT) !== trimmed) return undefined;
  return applyInferredYear(parsed, now).getTime();
}


/**
 * Часовой пояс КОМПАНИИ (workspace.region.timeZone, SaaS этап 1). По
 * умолчанию — Asia/Almaty, как было зашито. Это `let`: ES-модули отдают живую
 * привязку, поэтому `timeZone = USER_TIMEZONE` в параметрах и
 * `timeZone: USER_TIMEZONE` внутри функций видят смену сразу. Меняет его ТОЛЬКО
 * `setUserTimeZone` (мост региона в AppLayout). Форматтеры на уровне модуля
 * строить через `zonedDateFormat`, а не `new Intl.DateTimeFormat` с поясом —
 * те запомнили бы пояс на момент загрузки.
 */
export const DEFAULT_TIMEZONE = "Asia/Almaty";
export let USER_TIMEZONE = DEFAULT_TIMEZONE;

/** Поменять пояс компании. Неизвестный браузеру пояс — умолчание. */
export function setUserTimeZone(timeZone: string | null | undefined): boolean {
  const next = timeZone && isKnownTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE;
  if (next === USER_TIMEZONE) return false;
  USER_TIMEZONE = next;
  return true;
}

export function isKnownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

const zonedFormats = new Map<string, Intl.DateTimeFormat>();

/** Форматтер в поясе компании; кэш по (язык, настройки, пояс). */
export function zonedDateFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${USER_TIMEZONE}|${locale}|${JSON.stringify(options)}`;
  let f = zonedFormats.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...options, timeZone: USER_TIMEZONE });
    zonedFormats.set(key, f);
  }
  return f;
}

/**
 * Смещение пояса от UTC в минутах в момент `ms` (для Москвы +180). Алматы —
 * всегда +300: так было зашито (`+05:00`), и так же считают старые браузеры,
 * у которых в базе поясов ещё Алматы +6 (до марта 2024).
 */
export function timeZoneOffsetMinutes(ms: number, timeZone = USER_TIMEZONE): number {
  if (timeZone === DEFAULT_TIMEZONE) return 300;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return Math.round((wall - Math.floor(ms / 1000) * 1000) / 60_000);
}

export function hourInTimeZone(ms: number, timeZone = USER_TIMEZONE): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  const raw = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  return raw === 24 ? 0 : raw;
}

/** YYYY-MM-DD in the given zone, for calendar-day compares. */
export function ymdInTimeZone(ms: number, timeZone = USER_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

/** Order-received date in Asia/Almaty (calendar day, not a deadline). */
export function formatOrderDate(timestamp: number): string {
  const ms = toMillis(timestamp);
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: USER_TIMEZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(ms));
}

export function ymdPartsInTimeZone(ms: number, timeZone = USER_TIMEZONE): { year: number; month: number; day: number } {
  const ymd = ymdInTimeZone(ms, timeZone);
  const [year, month, day] = ymd.split("-").map(Number);
  return { year, month: month - 1, day };
}

/**
 * Noon on that calendar day in the company zone (исторически — Алматы, UTC+5;
 * имя оставлено, вызовов десятки). Для Алматы результат ровно прежний.
 */
export function almatyNoonMillis(year: number, monthIndex: number, day: number): number {
  const m = String(monthIndex + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  const iso = `${year}-${m}-${d}T12:00:00`;
  // Строкой, как было: кривой месяц/день даёт NaN, а не сдвиг в соседний месяц.
  if (USER_TIMEZONE === DEFAULT_TIMEZONE) return new Date(`${iso}+05:00`).getTime();
  const utcNoon = new Date(`${iso}Z`).getTime();
  if (!Number.isFinite(utcNoon)) return NaN;
  const guess = utcNoon - timeZoneOffsetMinutes(utcNoon) * 60_000;
  // Второй проход — на случай перехода на летнее время между guess и полднем.
  return utcNoon - timeZoneOffsetMinutes(guess) * 60_000;
}

/**
 * Midnight (00:00) on `ms`'s calendar day in the company zone (Asia/Almaty) — the shared day
 * boundary for anything bucketing timestamps by Almaty calendar day (daily
 * trend sparklines, "this week"/"this month" filters). Use this instead of
 * `new Date(ms).setHours(0,0,0,0)`, which reads the VIEWER's own device
 * timezone — fine for a manual-entry field the person is looking at on
 * their own clock (see isSameLocalDay above), wrong for anything meant to
 * look the same to every viewer regardless of where they are.
 */
export function almatyMidnightMillis(ms: number): number {
  const p = ymdPartsInTimeZone(ms, USER_TIMEZONE);
  return almatyNoonMillis(p.year, p.month, p.day) - 12 * 60 * 60 * 1000;
}


/** Soft greeting glow: cold cyan in the morning, warmer toward evening. Asia/Almaty hour. */
export function greetingGlowShadow(hour: number): string {
  const t = Math.min(1, Math.max(0, (hour - 6) / 14));
  const hue = 189 + (32 - 189) * t;
  const light = 72 - 12 * t;
  const alpha = 0.36 + 0.08 * t;
  return `0 0 22px hsl(${hue} 100% ${light}% / ${alpha})`;
}

export function greetingByHour(hour: number): string {
  if (hour >= 5 && hour < 12) return "Доброе утро";
  if (hour >= 12 && hour < 17) return "Добрый день";
  return "Добрый вечер";
}

/** Absolute write time in Asia/Almaty — used on chat bubbles and inbox previews. */
export function formatMessageWrittenAt(timestamp: number, opts: { compact?: boolean } = {}): string {
  const ms = toMillis(timestamp);
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const sameDay = ymdInTimeZone(ms) === ymdInTimeZone(Date.now());
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: USER_TIMEZONE,
    day: sameDay && opts.compact ? undefined : "numeric",
    month: sameDay && opts.compact ? undefined : "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}
