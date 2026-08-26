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

/** "26.08.2026 17:25" — typed by hand, not picked through a native date widget. Local wall-clock time. */
export const MANUAL_DATETIME_FORMAT = "dd.MM.yyyy HH:mm";
export const MANUAL_DATETIME_PLACEHOLDER = "26.08.2026 17:25";

export function formatDateTimeManual(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "";
  return format(new Date(ms), MANUAL_DATETIME_FORMAT);
}

/** Returns null for an empty string ("no date set"), or undefined if the text doesn't parse as a valid date. */
export function parseDateTimeManual(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = parse(trimmed, MANUAL_DATETIME_FORMAT, new Date());
  if (!isValid(parsed)) return undefined;
  return parsed.getTime();
}


/** Display/greeting clock for Nova — Asia/Almaty. */
export const USER_TIMEZONE = "Asia/Almaty";

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

/** Noon on that calendar day in Asia/Almaty (UTC+5, no DST). */
export function almatyNoonMillis(year: number, monthIndex: number, day: number): number {
  const m = String(monthIndex + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return new Date(`${year}-${m}-${d}T12:00:00+05:00`).getTime();
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
