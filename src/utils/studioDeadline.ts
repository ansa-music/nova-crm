import { USER_TIMEZONE, almatyNoonMillis } from "@/utils/date";
import { isDoneStatusLabel } from "@/utils/columnOptions";
import type { PageColumn, StatusOption } from "@/types";

/**
 * Подсветка дедлайна на столе «NOVA Studio» (06.10.2026). Только вид: ничего
 * не пишет, новых подписок нет — считается по строкам, которые стол уже
 * держит. Вне студии не вызывается вовсе (флаг считает DynamicTablePage).
 *
 * - `overdue` — день дедлайна раньше сегодняшнего по часам компании, а заказ
 *   не «Готово» и не «Отмена» → красный;
 * - `soon` — сдать сегодня или завтра → янтарь.
 */
export type DeadlineTone = "overdue" | "soon";

/** Тот же признак «столбец — срок», что у заезда заказа (`findQuickOrderColumns`). */
export const DEADLINE_LABEL_RE = /дедлайн|сдач|срок|deadline/;

/**
 * Столбец дедлайна: найденный `findQuickOrderColumns().deadline`, если это
 * дата, иначе первый столбец-дата с названием срока. Текстовый «Срок» не
 * подсвечиваем — в нём не дата.
 */
export function findDeadlineColumn(columns: readonly PageColumn[], preferred?: PageColumn | null): PageColumn | null {
  if (preferred && preferred.type === "date") return preferred;
  return columns.find((c) => c.type === "date" && DEADLINE_LABEL_RE.test(c.label.trim().toLowerCase())) ?? null;
}

// Один форматтер на пояс компании: дедлайн считается у каждой строки на
// каждом рендере таблицы, а `new Intl.DateTimeFormat` на строку — дорого.
let ymdZone = "";
let ymdFormat: Intl.DateTimeFormat | null = null;
function ymd(ms: number): string {
  if (!ymdFormat || ymdZone !== USER_TIMEZONE) {
    ymdZone = USER_TIMEZONE;
    ymdFormat = new Intl.DateTimeFormat("en-CA", { timeZone: USER_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });
  }
  return ymdFormat.format(new Date(ms));
}

/** «Сегодня» и «завтра» по часам компании (YYYY-MM-DD) — раз на рендер таблицы. */
export interface DeadlineClock {
  today: string;
  tomorrow: string;
}

export function deadlineClock(now: number = Date.now()): DeadlineClock {
  const today = ymd(now);
  const [y, m, d] = today.split("-").map(Number);
  // Полдень сегодня + сутки — всегда завтрашний день, и при переходе на летнее время.
  const tomorrow = ymd(almatyNoonMillis(y, m - 1, d) + 24 * 60 * 60 * 1000);
  return { today, tomorrow };
}

/** Значение ячейки-даты (мс строкой или числом) → мс; пусто и мусор — null. */
export function deadlineMillis(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const ms = typeof raw === "number" ? raw : Number(String(raw).trim());
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

/** Заказ закрыт: «Готово» (по названию, как касса) или «Отмена». */
export function isClosedStatus(value: unknown, options: readonly StatusOption[]): boolean {
  const raw = value === null || value === undefined ? "" : String(value);
  if (!raw) return false;
  const label = options.find((o) => o.value === raw)?.label ?? raw;
  if (isDoneStatusLabel(label)) return true;
  const l = label.trim().toLowerCase();
  return raw === "cancelled" || l.includes("отмен") || l.includes("cancel");
}

export function deadlineToneOf(raw: unknown, clock: DeadlineClock, closed: boolean): DeadlineTone | null {
  if (closed) return null;
  const ms = deadlineMillis(raw);
  if (ms === null) return null;
  const day = ymd(ms);
  if (day < clock.today) return "overdue";
  if (day === clock.today || day === clock.tomorrow) return "soon";
  return null;
}

/** Подсказка к подсвеченному дедлайну (ячейка таблицы знает только тон). */
export function deadlineToneTitle(tone: DeadlineTone): string {
  return tone === "overdue" ? "Дедлайн прошёл, а заказ не сдан" : "Сдать сегодня или завтра";
}

/** «сегодня» / «завтра» для карточки на телефоне; иначе null. */
export function deadlineDayWord(raw: unknown, clock: DeadlineClock): "сегодня" | "завтра" | null {
  const ms = deadlineMillis(raw);
  if (ms === null) return null;
  const day = ymd(ms);
  return day === clock.today ? "сегодня" : day === clock.tomorrow ? "завтра" : null;
}
