import { almatyNoonMillis, ymdInTimeZone } from "@/utils/date";

/**
 * Периоды столов: целый месяц или две половины (просьба Nurba 26.09.2026:
 * «месяцы теперь будут разделены на 2 — с 1-го по 15-е, потом до конца; дай
 * Owner'у выбрать разделение»).
 *
 * Ключ периода — строка, которой всюду раньше был ключ месяца `YYYY-MM`:
 *  • целый месяц — `2026-09` (как было; прошлые месяцы не меняются);
 *  • половины — `2026-10-1` (1..splitDay) и `2026-10-2` (splitDay+1..конец).
 * Лексический порядок верный: `2026-09 < 2026-10-1 < 2026-10-2 < 2026-11`,
 * поэтому стражи SQL (`new.month_key < old.month_key`) и выборки `>= from`
 * работают с ним без правок. Id вкладки — `month-${ключ}`.
 *
 * Половины действуют для месяцев M: `from !== "" && M >= from && (until === ""
 * || M < until)`. Выключение половин = `until` (со следующего месяца), а не
 * стирание `from`: текущий месяц дорабатывается половинами, иначе ключ
 * `2026-10` < `2026-10-2`, и стражи счётчиков молча отбрасывали бы записи до
 * следующего месяца. График смен (`techSchedule`) сюда не смотрит — он всегда
 * по календарным месяцам.
 *
 * Модуль чистый (только `utils/date`), чтобы его можно было гонять в
 * esbuild-риге без Firebase.
 */

export interface PeriodSettings {
  /** Последний день первой половины (10..20). */
  splitDay: number;
  /** С какого месяца («YYYY-MM») действуют половины; "" — выключены. */
  from: string;
  /** С какого месяца («YYYY-MM») половины снова выключены; "" — без конца. */
  until: string;
  /** Переносить незавершённые заказы в новый период автоматически. */
  autoCarry: boolean;
}

export const PERIOD_SPLIT_MIN = 10;
export const PERIOD_SPLIT_MAX = 20;
export const PERIOD_SPLIT_DEFAULT = 15;

export const DEFAULT_PERIODS: PeriodSettings = { splitDay: PERIOD_SPLIT_DEFAULT, from: "", until: "", autoCarry: false };

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])(-[12])?$/;
const TAB_RE = /^month-(\d{4}-(?:0[1-9]|1[0-2])(?:-[12])?)$/;

const MONTHS_NOM = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/** Все ключи явно: merge иначе оставил бы старое значение. */
export function sanitizePeriods(raw: unknown): PeriodSettings {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const splitRaw = Number(source.splitDay);
  const splitDay = Number.isFinite(splitRaw)
    ? Math.max(PERIOD_SPLIT_MIN, Math.min(PERIOD_SPLIT_MAX, Math.trunc(splitRaw)))
    : PERIOD_SPLIT_DEFAULT;
  let from = typeof source.from === "string" && MONTH_RE.test(source.from) ? source.from : "";
  let until = typeof source.until === "string" && MONTH_RE.test(source.until) ? source.until : "";
  // Конец раньше начала (или равен) — половин не было вовсе.
  if (from && until && until <= from) {
    from = "";
    until = "";
  }
  if (!from) until = "";
  return { splitDay, from, until, autoCarry: source.autoCarry === true };
}

export function periodsOf(workspace: { periods?: unknown } | null | undefined): PeriodSettings {
  return sanitizePeriods(workspace?.periods);
}

export function isPeriodKey(value: string): boolean {
  return PERIOD_RE.test(value);
}

export function isHalfKey(value: string): boolean {
  return PERIOD_RE.test(value) && value.length === 9;
}

/** «2026-10-2» → «2026-10». */
export function monthOfPeriod(key: string): string {
  return key.slice(0, 7);
}

/** Идут ли у этого календарного месяца («YYYY-MM») половины. */
export function isHalfMonth(monthKey: string, settings: PeriodSettings): boolean {
  return settings.from !== "" && monthKey >= settings.from && (settings.until === "" || monthKey < settings.until);
}

function nextMonthOf(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
}

function previousMonthOf(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
}

/** Ключ периода, в который попадает момент `ms` (день по Алматы). */
export function periodKeyFor(ms: number, settings: PeriodSettings = DEFAULT_PERIODS): string {
  const ymd = ymdInTimeZone(ms);
  const month = ymd.slice(0, 7);
  if (!isHalfMonth(month, settings)) return month;
  const day = Number(ymd.slice(8, 10));
  return day <= settings.splitDay ? `${month}-1` : `${month}-2`;
}

export function currentPeriodKey(settings: PeriodSettings = DEFAULT_PERIODS, now: number = Date.now()): string {
  return periodKeyFor(now, settings);
}

export interface PeriodRange {
  key: string;
  year: number;
  /** 0-based. */
  monthIndex: number;
  dayFrom: number;
  /** Настоящий последний день (у второй половины — последний день месяца). */
  dayTo: number;
  startMs: number;
  /** Исключительно: полночь по Алматы дня, следующего за dayTo. */
  endMs: number;
  days: number[];
}

const HALF_DAY_MS = 12 * 60 * 60 * 1000;

/** Границы периода по Алматы. Ключ обязан быть валидным (`isPeriodKey`). */
export function periodRange(key: string, settings: PeriodSettings = DEFAULT_PERIODS): PeriodRange {
  if (!PERIOD_RE.test(key)) throw new Error(`Некорректный ключ периода: ${key}`);
  const year = Number(key.slice(0, 4));
  const monthIndex = Number(key.slice(5, 7)) - 1;
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const half = key.length === 9 ? Number(key.slice(8)) : 0;
  const split = Math.min(settings.splitDay, daysInMonth - 1);
  const dayFrom = half === 2 ? split + 1 : 1;
  const dayTo = half === 1 ? split : daysInMonth;
  const days: number[] = [];
  for (let d = dayFrom; d <= dayTo; d++) days.push(d);
  return {
    key,
    year,
    monthIndex,
    dayFrom,
    dayTo,
    startMs: almatyNoonMillis(year, monthIndex, dayFrom) - HALF_DAY_MS,
    endMs: almatyNoonMillis(year, monthIndex, dayTo) + HALF_DAY_MS,
    days,
  };
}

/** «DD» дня `ymd` внутри периода, иначе null — корзины `dayCounts` счётчиков. */
export function dayInPeriod(ymd: string, key: string, settings: PeriodSettings = DEFAULT_PERIODS): string | null {
  if (ymd.slice(0, 7) !== monthOfPeriod(key)) return null;
  const day = Number(ymd.slice(8, 10));
  if (!Number.isFinite(day)) return null;
  if (key.length === 9) {
    const { dayFrom, dayTo } = periodRange(key, settings);
    if (day < dayFrom || day > dayTo) return null;
  }
  return ymd.slice(8, 10);
}

export function nextPeriodKey(key: string, settings: PeriodSettings = DEFAULT_PERIODS): string {
  const month = monthOfPeriod(key);
  if (key.endsWith("-1")) return `${month}-2`;
  const next = nextMonthOf(month);
  return isHalfMonth(next, settings) ? `${next}-1` : next;
}

export function previousPeriodKey(key: string, settings: PeriodSettings = DEFAULT_PERIODS): string {
  const month = monthOfPeriod(key);
  if (key.endsWith("-2")) return `${month}-1`;
  const prev = previousMonthOf(month);
  return isHalfMonth(prev, settings) ? `${prev}-2` : prev;
}

/** `count` ключей, заканчивая `key`, от старого к новому. */
export function recentPeriodKeys(key: string, count: number, settings: PeriodSettings = DEFAULT_PERIODS): string[] {
  const keys = [key];
  while (keys.length < count) keys.unshift(previousPeriodKey(keys[0], settings));
  return keys;
}

/** «Октябрь 2026» / «1–15 октября 2026» / «16–31 октября 2026». */
export function periodLabel(key: string, settings: PeriodSettings = DEFAULT_PERIODS): string {
  if (!PERIOD_RE.test(key)) return key;
  const range = periodRange(key, settings);
  if (key.length === 7) return `${MONTHS_NOM[range.monthIndex]} ${range.year}`;
  return `${range.dayFrom}–${range.dayTo} ${MONTHS_GEN[range.monthIndex]} ${range.year}`;
}

/** «Октябрь» / «1–15 окт» / «16–31 окт» — подпись сегмента в шапке стола. */
export function periodShortLabel(key: string, settings: PeriodSettings = DEFAULT_PERIODS): string {
  if (!PERIOD_RE.test(key)) return key;
  const range = periodRange(key, settings);
  if (key.length === 7) return MONTHS_NOM[range.monthIndex];
  return `${range.dayFrom}–${range.dayTo} ${MONTHS_SHORT[range.monthIndex]}`;
}

/** «месяц» / «период» — для подписей вроде «за этот период». */
export function periodNoun(key: string): "месяц" | "период" {
  return key.length === 9 ? "период" : "месяц";
}

/** Id вкладки периода — та же форма, что у месячных `month-YYYY-MM`. */
export function periodTabId(key: string): string {
  return `month-${key}`;
}

/** Ключ периода из id вкладки, иначе null. */
export function periodOfTabId(tabId: string | null | undefined): string | null {
  const match = TAB_RE.exec(tabId ?? "");
  return match ? match[1] : null;
}
