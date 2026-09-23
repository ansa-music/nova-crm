import {
  sameScheduleHours,
  scheduleStateOf,
  type ScheduleDayState,
  type ScheduleHours,
  type TechSchedule,
} from "@/types";
import type { ScheduleDraftChange } from "@/services/techScheduleService";

/**
 * Правка многих дней одного человека разом — окно «Месяц человека».
 * Отдельно от страницы, чтобы проверить юнитами: здесь решается, какие дни
 * реально пишутся (нетронутые не пишутся) и как вернуть всё назад одним
 * «Отменить».
 */
export type ScheduleBulkAction = "work" | "off" | "excused" | "hours" | "came" | "clear-hours";

export interface ScheduleDaySnapshot {
  /** Что стоит в `days` (без учёта «пришёл»). */
  raw: ScheduleDayState;
  came: boolean;
  /** Часы как лежат в документе — даже под выходным, чтобы «Отменить» вернул их точно. */
  hours: ScheduleHours | null;
}

export function scheduleDaySnapshot(schedule: TechSchedule | null | undefined, dayKey: string): ScheduleDaySnapshot {
  const hours = schedule?.hours?.[dayKey];
  return {
    raw: schedule?.days?.[dayKey] ?? "work",
    came: Boolean(schedule?.selfWork?.[dayKey]),
    hours: hours?.from ? hours : null,
  };
}

export interface ScheduleBulkPlan {
  change: Omit<ScheduleDraftChange, "uid">;
  /** Дни, которые реально меняются. */
  touched: string[];
  /** Обратная правка: вернуть тронутые дни как были. */
  undo: Omit<ScheduleDraftChange, "uid">;
}

function put<T>(target: Record<string, T> | undefined, key: string, value: T): Record<string, T> {
  const next = target ?? {};
  next[key] = value;
  return next;
}

export function planScheduleBulk(
  schedule: TechSchedule | null | undefined,
  dayKeys: string[],
  action: ScheduleBulkAction,
  shift?: ScheduleHours | null
): ScheduleBulkPlan {
  const change: Omit<ScheduleDraftChange, "uid"> = {};
  const undo: Omit<ScheduleDraftChange, "uid"> = {};
  const touched: string[] = [];
  for (const dayKey of dayKeys) {
    const before = scheduleDaySnapshot(schedule, dayKey);
    const shown = scheduleStateOf(schedule, dayKey);
    let did = false;
    if (action === "work") {
      // «Рабочий» = обычный день целиком: без выходного, без «пришёл», без часов.
      if (before.raw !== "work" || before.came) {
        change.days = put(change.days, dayKey, "work");
        did = true;
      }
      if (before.hours) {
        change.hours = put(change.hours, dayKey, null);
        did = true;
      }
    } else if (action === "off" || action === "excused") {
      if (before.raw !== action || before.came || before.hours) {
        change.days = put(change.days, dayKey, action);
        did = true;
      }
    } else if (action === "hours") {
      if (!shift?.from) continue;
      if (shown !== "work") change.days = put(change.days, dayKey, "work");
      if (shown !== "work" || !sameScheduleHours(before.hours, shift)) {
        change.hours = put(change.hours, dayKey, shift);
        did = true;
      }
    } else if (action === "came") {
      if (before.raw !== "work" && !before.came) {
        change.came = put(change.came, dayKey, true);
        did = true;
      }
    } else if (action === "clear-hours") {
      if (before.hours) {
        change.hours = put(change.hours, dayKey, null);
        did = true;
      }
    }
    if (!did) continue;
    touched.push(dayKey);
    undo.days = put(undo.days, dayKey, before.raw);
    undo.came = put(undo.came, dayKey, before.came);
    undo.hours = put(undo.hours, dayKey, before.hours);
  }
  return { change, touched, undo };
}

/** Итоги месяца человека — плашки над календарём. */
export function scheduleMonthStats(schedule: TechSchedule | null | undefined, dayKeys: string[]) {
  let work = 0;
  let off = 0;
  let excused = 0;
  let shifts = 0;
  let came = 0;
  for (const dayKey of dayKeys) {
    const state = scheduleStateOf(schedule, dayKey);
    if (state === "off") off += 1;
    else if (state === "excused") excused += 1;
    else {
      work += 1;
      if (schedule?.hours?.[dayKey]?.from) shifts += 1;
      if (schedule?.selfWork?.[dayKey] && schedule?.days?.[dayKey]) came += 1;
    }
  }
  return { work, off, excused, shifts, came };
}
