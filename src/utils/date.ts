import { formatDistanceToNow, format } from "date-fns";
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
