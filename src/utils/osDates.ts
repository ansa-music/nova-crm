import { almatyNoonMillis, ymdInTimeZone, ymdPartsInTimeZone, zonedDateFormat } from "@/utils/date";
import { OS_ISSUED_AT_KEY, OS_ISSUED_ON_KEY, OS_RECEIVED_ON_KEY } from "@/utils/reservedCellKeys";
import type { PageRow } from "@/types";

/**
 * Даты заказа на столе ОС: когда ОС ПОЛУЧИЛ заказ, когда ВЫДАЛ его технарю и
 * когда сделан апсейл. ТОЛЬКО ДАТА, без времени (просьба Nurba 24.09.2026).
 *
 * Дату ставит сам ОС (вторая просьба того же дня: «чтобы дату заполняли
 * сами, но рекомендовано — по кнопке»): ячейки `osReceivedOn`, `osIssuedOn`,
 * `{апсейл}__on` — полдень дня по Алматы, мс строкой. Пока ОС её не
 * поставил, в ячейке пунктиром стоит РЕКОМЕНДУЕМАЯ дата — одно нажатие
 * записывает её. Рекомендация берётся из автоматики:
 *
 * - получен — `max(createdAt, filledAt)` строки: слот могли завести заранее,
 *   заказ — момент, когда в слот впервые что-то вписали (как «Столы ОС»);
 * - выдан — ячейка `osIssuedAt` (ставит `pushOrderToTech` при заведении копии
 *   у технаря); у заказов, выданных до этого, — дата заведения самой копии;
 * - апсейл — ячейки `{апсейл}__at` / `{апсейл}__was` (ставит
 *   `useOsTotalsKeeper`, когда видит, что апсейл поменяли).
 *
 * Все дни — по Алматы, как остальные даты заказов.
 */

/** Ячейка «когда сделан апсейл» (мс строкой). */
export function upsellAtKeyOf(colKey: string): string {
  return `${colKey}__at`;
}

/** Дата апсейла, которую поставил ОС (полдень по Алматы). */
export function upsellOnKeyOf(colKey: string): string {
  return `${colKey}__on`;
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

/** Когда сделан апсейл этой строки (автоматика — рекомендация). */
export function upsellMadeAt(row: Pick<PageRow, "cells">, upsellKey: string): number | null {
  return cellMillis(row.cells[upsellAtKeyOf(upsellKey)]);
}

/** Полдень того же дня по Алматы — так хранятся даты, которые ставит человек. */
export function almatyDay(ms: number): number {
  const p = ymdPartsInTimeZone(ms);
  return almatyNoonMillis(p.year, p.month, p.day);
}

/** «YYYY-MM-DD» по Алматы — для `<input type="date">`. */
export function dateInputValue(ms: number | null): string {
  return ms ? ymdInTimeZone(ms) : "";
}

/** Из `<input type="date">` — полдень этого дня по Алматы (или null). */
export function parseDateInput(raw: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const ms = almatyNoonMillis(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(ms) ? ms : null;
}

export type OsDateKind = "received" | "issued" | "upsell";

/** Одна дата заказа: поставленная ОС и рекомендуемая (для кнопки). */
export interface OsDateSlot {
  kind: OsDateKind;
  /** Ячейка, куда пишется дата. */
  key: string;
  /** Поставил ОС (полдень дня); null — ещё не ставил. */
  value: number | null;
  /** Рекомендуемая (полдень дня) — по кнопке; null — рекомендовать нечего. */
  suggested: number | null;
}

export const OS_DATE_TITLES: Record<OsDateKind, string> = {
  received: "Дата получения заказа",
  issued: "Дата выдачи технарю",
  upsell: "Дата апсейла",
};

/**
 * Три даты строки стола ОС. `mirrorCreatedAt` — когда завели копию у
 * технаря (запасная рекомендация для «выдан» у заказов, выданных раньше).
 */
export function osDateSlots(
  row: Pick<PageRow, "cells" | "createdAt" | "filledAt">,
  opts: { upsellKey: string; mirrorCreatedAt?: number | null }
): Record<OsDateKind, OsDateSlot> {
  const day = (ms: number | null) => (ms ? almatyDay(ms) : null);
  const upsellKey = upsellOnKeyOf(opts.upsellKey);
  return {
    received: { kind: "received", key: OS_RECEIVED_ON_KEY, value: cellMillis(row.cells[OS_RECEIVED_ON_KEY]), suggested: day(osReceivedAt(row)) },
    issued: {
      kind: "issued",
      key: OS_ISSUED_ON_KEY,
      value: cellMillis(row.cells[OS_ISSUED_ON_KEY]),
      suggested: day(osIssuedAt(row, opts.mirrorCreatedAt)),
    },
    upsell: { kind: "upsell", key: upsellKey, value: cellMillis(row.cells[upsellKey]), suggested: day(upsellMadeAt(row, opts.upsellKey)) },
  };
}

/** Что показать: поставленная ОС, иначе рекомендуемая. */
export function slotShown(slot: OsDateSlot): number | null {
  return slot.value ?? slot.suggested;
}

/** «24.09» */
export function formatDayMonth(ms: number): string {
  return zonedDateFormat("ru-RU", { day: "2-digit", month: "2-digit" }).format(new Date(ms));
}

/** «24 сентября 2026 г.» — только дата. */
export function formatFullDate(ms: number): string {
  return zonedDateFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(new Date(ms));
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
    // Апсейл стёрли — даты ему больше не нужны (и поставленная ОС тоже).
    const on = norm(row.cells[upsellOnKeyOf(upsellKey)]);
    return was || at || on
      ? { [upsellAtKeyOf(upsellKey)]: null, [upsellWasKeyOf(upsellKey)]: null, [upsellOnKeyOf(upsellKey)]: null }
      : null;
  }
  // Дата уже стоит ровно под это значение (её поставила другая вкладка).
  if (was === value && at) return null;
  if (input.baseline === undefined || input.baseline === value) return null;
  return { [upsellAtKeyOf(upsellKey)]: String(input.now), [upsellWasKeyOf(upsellKey)]: value };
}
