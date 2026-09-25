import { formatScheduleHours, type ScheduleHours } from "@/types";

/**
 * Строка графика. `uid` — это id документа `techSchedule`, поэтому для своих
 * людей из настраиваемого раздела сюда приходит их синтетический id: сетке
 * всё равно, чей это график, лишь бы ключ был один на человека.
 */
export interface ScheduleRow {
  uid: string;
  label: string;
  /** Участник workspace — ради аватарки; у своих людей его нет. */
  member?: { uid: string; name?: string; nickname?: string; photoURL?: string | null } | null;
  /** Бейдж справа от имени: «Owner», «Тимлид» и т.п. */
  note?: string | null;
}

export const WEEKDAY_LETTERS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

/** «в субботу» — к «каждую …». */
export const WEEKDAY_EVERY: Record<string, string> = {
  "0": "каждое воскресенье",
  "1": "каждый понедельник",
  "2": "каждый вторник",
  "3": "каждую среду",
  "4": "каждый четверг",
  "5": "каждую пятницу",
  "6": "каждую субботу",
};

/**
 * Инициалы аватарки берутся по первым буквам слов, а своих людей пишут как
 * «Асхат (монтаж)» — скобка попадала в кружок. Оставляем только буквы.
 */
export function initialsName(label: string): string {
  return label.replace(/[^\p{L}\p{N}\s]+/gu, " ").replace(/\s+/g, " ").trim() || label;
}

export function daysOfMonth(monthKey: string): string[] {
  const [year, month] = monthKey.split("-").map(Number);
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => String(i + 1));
}

export function weekdayOf(monthKey: string, dayKey: string): number {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, Number(dayKey))).getUTCDay();
}

/** Суббота и воскресенье — только подсветка колонки, выходным днём сами по себе не считаются. */
export function isWeekend(monthKey: string, dayKey: string): boolean {
  const dow = weekdayOf(monthKey, dayKey);
  return dow === 0 || dow === 6;
}

/** «чт, 17 сент.» — день месяца в заголовке палитры и подсказках. */
export function dayLabel(monthKey: string, dayKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, Number(dayKey)))
  );
}

/**
 * Что стоит в клетке. Один набор видов на сетку месяца, неделю, «День»,
 * палитру и легенду: цвет вида везде один и тот же — по нему график и читают.
 */
export type CellKind = "work" | "off" | "excused" | "hours" | "came";

export const CELL_KIND_LABEL: Record<CellKind, string> = {
  work: "Рабочий",
  off: "Выходной",
  excused: "Отпросился",
  hours: "Смена с/до",
  came: "Пришёл в выходной",
};

/** Буква клетки и клавиша: на русской раскладке В, Р, О, П — те же физические клавиши. */
export const CELL_KIND_LETTER: Record<Exclude<CellKind, "hours">, string> = {
  work: "Р",
  off: "В",
  excused: "О",
  came: "П",
};

/** Цвет клетки по виду (фон, рамка, текст). */
export const CELL_KIND_LOOK: Record<CellKind, string> = {
  work: "border-transparent bg-foreground/[0.045] text-muted-foreground",
  off: "border-destructive/45 bg-destructive/[0.16] text-destructive",
  excused: "border-warning/45 bg-warning/[0.16] text-warning",
  hours: "border-primary/45 bg-primary/[0.14] text-primary",
  came: "border-success/45 bg-success/[0.16] text-success",
};

/** Рабочий день в субботу/воскресенье — чуть темнее, чтобы неделя читалась. */
export const WEEKEND_WORK_LOOK = "bg-foreground/[0.085]";

/** Час начала смены в клетку месяца: «12», «9», «12:30». */
export function shiftStart(hours: ScheduleHours): string {
  const [h, m] = hours.from.split(":");
  const hour = String(Number(h));
  return m && m !== "00" ? `${hour}:${m}` : hour;
}

export function shiftText(hours: ScheduleHours): string {
  return formatScheduleHours(hours);
}
