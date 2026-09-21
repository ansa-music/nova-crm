import { draftKey } from "@/components/schedule/ScheduleGrid";
import { scheduleHoursOf, scheduleStateOf, type ScheduleDayState, type ScheduleHours, type TechSchedule } from "@/types";

export interface WeekPatternInput {
  /** Кому раскладываем: uid людей. */
  uids: string[];
  monthKey: string;
  schedules: Map<string, TechSchedule>;
  draft: Map<string, ScheduleDayState>;
  hoursDraft: Map<string, ScheduleHours | null>;
  offDows: number[];
  hoursMode: "keep" | "set" | "clear";
  hours: ScheduleHours;
  hoursDows: number[];
}

export function daysInMonth(monthKey: string): string[] {
  const [year, month] = monthKey.split("-").map(Number);
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => String(i + 1));
}

/**
 * Раскладывает шаблон недели («выходные по вторникам и воскресеньям») на весь
 * месяц. Возвращает НОВЫЙ черновик — в базу ничего не идёт, человек сначала
 * смотрит месяц, правит исключения и только потом сохраняет.
 *
 * Два правила, которые легко потерять:
 * - дни «отпросился» шаблон не трогает: это разовое согласование, а не
 *   распорядок недели;
 * - день, совпавший с тем, что уже лежит в базе, из черновика УДАЛЯЕТСЯ —
 *   иначе «разложить на месяц» писало бы весь месяц целиком каждый раз.
 */
export function applyWeekPattern(input: WeekPatternInput): {
  draft: Map<string, ScheduleDayState>;
  hoursDraft: Map<string, ScheduleHours | null>;
} {
  const days = daysInMonth(input.monthKey);
  const [year, month] = input.monthKey.split("-").map(Number);
  const draft = new Map(input.draft);
  const hoursDraft = new Map(input.hoursDraft);

  for (const uid of input.uids) {
    const schedule = input.schedules.get(uid);
    for (const dayKey of days) {
      const dow = new Date(Date.UTC(year, month - 1, Number(dayKey))).getUTCDay();
      const stored = scheduleStateOf(schedule, dayKey);
      const key = draftKey(uid, dayKey);

      if (stored !== "excused") {
        const wanted: ScheduleDayState = input.offDows.includes(dow) ? "off" : "work";
        if (wanted === stored) draft.delete(key);
        else draft.set(key, wanted);
      }

      if (input.hoursMode === "keep") continue;
      const storedHours = scheduleHoursOf(schedule, dayKey);
      if (input.hoursMode === "clear") {
        if (storedHours) hoursDraft.set(key, null);
        else hoursDraft.delete(key);
        continue;
      }
      const willWork = stored !== "excused" && !input.offDows.includes(dow);
      const applies = willWork && (input.hoursDows.length === 0 || input.hoursDows.includes(dow));
      if (!applies) {
        hoursDraft.delete(key);
        continue;
      }
      if (storedHours && storedHours.from === input.hours.from && storedHours.to === input.hours.to) {
        hoursDraft.delete(key);
      } else {
        hoursDraft.set(key, { ...input.hours });
      }
    }
  }

  return { draft, hoursDraft };
}
