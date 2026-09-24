import { USER_TIMEZONE, ymdInTimeZone } from "@/utils/date";
import { OS_ISSUED_AT_KEY } from "@/utils/reservedCellKeys";
import type { PageRow } from "@/types";

/**
 * Даты заказа на столе ОС (просьба Nurba 24.09.2026): когда ОС ПОЛУЧИЛ заказ,
 * когда ВЫДАЛ его технарю и когда сделан апсейл.
 *
 * - получен — `max(createdAt, filledAt)` строки: слот могли завести заранее,
 *   заказ — момент, когда в слот впервые что-то вписали (как «Столы ОС»);
 * - выдан — ячейка `osIssuedAt` строки-источника (ставит `pushOrderToTech`
 *   при заведении копии у технаря); у заказов, выданных до этого, — дата
 *   заведения самой копии;
 * - апсейл — ячейки `{апсейл}__at` / `{апсейл}__was` (ставит
 *   `useOsTotalsKeeper`, когда видит, что апсейл поменяли).
 *
 * Всё время — по Алматы, как остальные даты заказов.
 */

/** Ячейка «когда сделан апсейл» (мс строкой). */
export function upsellAtKeyOf(colKey: string): string {
  return `${colKey}__at`;
}

/**
 * Значение апсейла, при котором поставлена дата. По нему вторая вкладка того
 * же ОС (или Owner, открывший стол) не переставляет дату второй раз.
 */
export function upsellWasKeyOf(colKey: string): string {
  return `${colKey}__was`;
}

/** Мс из ячейки (строка или число); пусто и мусор — null. */
export function cellMillis(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Когда ОС получил заказ. */
export function osReceivedAt(row: Pick<PageRow, "createdAt" | "filledAt">): number | null {
  const at = Math.max(row.createdAt ?? 0, row.filledAt ?? 0);
  return at > 0 ? at : null;
}

/** Когда заказ отдан нынешнему технарю (запасной — дата заведения копии). */
export function osIssuedAt(row: Pick<PageRow, "cells">, mirrorCreatedAt?: number | null): number | null {
  return cellMillis(row.cells[OS_ISSUED_AT_KEY]) ?? (mirrorCreatedAt && mirrorCreatedAt > 0 ? mirrorCreatedAt : null);
}

/** Когда сделан апсейл этой строки. */
export function upsellMadeAt(row: Pick<PageRow, "cells">, upsellKey: string): number | null {
  return cellMillis(row.cells[upsellAtKeyOf(upsellKey)]);
}

const dayMonthFmt = new Intl.DateTimeFormat("ru-RU", { timeZone: USER_TIMEZONE, day: "2-digit", month: "2-digit" });
const clockFmt = new Intl.DateTimeFormat("ru-RU", { timeZone: USER_TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: false });
const fullFmt = new Intl.DateTimeFormat("ru-RU", {
  timeZone: USER_TIMEZONE,
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** «24.09» */
export function formatDayMonth(ms: number): string {
  return dayMonthFmt.format(new Date(ms));
}

/** «14:05» */
export function formatClock(ms: number): string {
  return clockFmt.format(new Date(ms));
}

/** «24.09 14:05» — всегда с датой: стол ОС листают по месяцу, и «14:05» без дня путает. */
export function formatShortMoment(ms: number): string {
  return `${formatDayMonth(ms)} ${formatClock(ms)}`;
}

/** «24 сентября 2026 г., 14:05» — для подсказки. */
export function formatFullMoment(ms: number): string {
  return fullFmt.format(new Date(ms));
}

/** Сколько прошло между получением и выдачей: «12 мин», «3 ч 5 мин», «2 дн». */
export function formatWaited(fromMs: number, toMs: number): string {
  const min = Math.max(0, Math.round((toMs - fromMs) / 60_000));
  if (min < 60) return `${min} мин`;
  const hours = Math.floor(min / 60);
  if (hours < 24) {
    const rest = min % 60;
    return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
  }
  return `${Math.floor(hours / 24)} дн`;
}

/** Тот же ли календарный день по Алматы. */
export function sameAlmatyDay(a: number, b: number): boolean {
  return ymdInTimeZone(a) === ymdInTimeZone(b);
}

// ---------------------------------------------------------------------
// Дата апсейла: когда её ставить.
// ---------------------------------------------------------------------

function norm(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

/**
 * Решение для одной строки: поставить дату апсейла, снять её или ничего.
 *
 * `baseline` — значение апсейла, которое вкладка видела у строки первым
 * (с сервера); `undefined` — строку видим впервые. Дату ставим ТОЛЬКО когда
 * апсейл на наших глазах сменился: у старых строк она неизвестна, и
 * проставить им всем «сейчас» значило бы соврать. Новая строка (заведена
 * после открытия стола) считается пришедшей с пустым апсейлом.
 */
export function planUpsellStamp(input: {
  row: Pick<PageRow, "cells">;
  upsellKey: string;
  baseline: string | undefined;
  now: number;
}): Record<string, string | null> | null {
  const { row, upsellKey } = input;
  const value = norm(row.cells[upsellKey]);
  const was = norm(row.cells[upsellWasKeyOf(upsellKey)]);
  const at = norm(row.cells[upsellAtKeyOf(upsellKey)]);
  if (!value) {
    // Апсейл стёрли — дата ему больше не нужна.
    return was || at ? { [upsellAtKeyOf(upsellKey)]: null, [upsellWasKeyOf(upsellKey)]: null } : null;
  }
  // Дата уже стоит ровно под это значение (её поставила другая вкладка).
  if (was === value && at) return null;
  if (input.baseline === undefined || input.baseline === value) return null;
  return { [upsellAtKeyOf(upsellKey)]: String(input.now), [upsellWasKeyOf(upsellKey)]: value };
}
