import { USER_TIMEZONE, almatyMidnightMillis, almatyNoonMillis, ymdPartsInTimeZone } from "@/utils/date";

/**
 * Quick date-column filters. Every preset resolves to an inclusive
 * [from, to] pair of millisecond timestamps covering whole Almaty calendar
 * days, so a cell that stores "noon of that day" (the way DateCalendar
 * writes them) compares correctly and nothing shifts around midnight.
 */
export type DatePreset = "today" | "yesterday" | "thisWeek" | "last7" | "thisMonth" | "lastMonth" | "last30" | "thisYear";

export const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  today: "Сегодня",
  yesterday: "Вчера",
  thisWeek: "Эта неделя",
  last7: "Последние 7 дней",
  thisMonth: "Этот месяц",
  lastMonth: "Прошлый месяц",
  last30: "Последние 30 дней",
  thisYear: "Этот год",
};

export const DATE_PRESET_ORDER: DatePreset[] = ["today", "yesterday", "thisWeek", "last7", "thisMonth", "lastMonth", "last30", "thisYear"];

const DAY = 24 * 60 * 60 * 1000;

const dayStart = almatyMidnightMillis;

/** Monday-based weekday index (0 = Monday) for an Almaty day. */
function weekdayIndex(ms: number): number {
  const p = ymdPartsInTimeZone(ms, USER_TIMEZONE);
  const utcNoon = Date.UTC(p.year, p.month, p.day, 12);
  const js = new Date(utcNoon).getUTCDay(); // 0 = Sunday
  return (js + 6) % 7;
}

export function datePresetRange(preset: DatePreset, now: number = Date.now()): { from: number; to: number } {
  const todayStart = dayStart(now);
  const todayEnd = todayStart + DAY - 1;
  switch (preset) {
    case "today":
      return { from: todayStart, to: todayEnd };
    case "yesterday":
      return { from: todayStart - DAY, to: todayStart - 1 };
    case "thisWeek": {
      const monday = todayStart - weekdayIndex(now) * DAY;
      return { from: monday, to: monday + 7 * DAY - 1 };
    }
    case "last7":
      return { from: todayStart - 6 * DAY, to: todayEnd };
    case "last30":
      return { from: todayStart - 29 * DAY, to: todayEnd };
    case "thisMonth": {
      const p = ymdPartsInTimeZone(now, USER_TIMEZONE);
      const from = dayStart(almatyNoonMillis(p.year, p.month, 1));
      const nextMonth = p.month === 11 ? almatyNoonMillis(p.year + 1, 0, 1) : almatyNoonMillis(p.year, p.month + 1, 1);
      return { from, to: dayStart(nextMonth) - 1 };
    }
    case "lastMonth": {
      const p = ymdPartsInTimeZone(now, USER_TIMEZONE);
      const thisMonthStart = dayStart(almatyNoonMillis(p.year, p.month, 1));
      const prev = p.month === 0 ? almatyNoonMillis(p.year - 1, 11, 1) : almatyNoonMillis(p.year, p.month - 1, 1);
      return { from: dayStart(prev), to: thisMonthStart - 1 };
    }
    case "thisYear": {
      const p = ymdPartsInTimeZone(now, USER_TIMEZONE);
      return { from: dayStart(almatyNoonMillis(p.year, 0, 1)), to: dayStart(almatyNoonMillis(p.year + 1, 0, 1)) - 1 };
    }
    default:
      return { from: 0, to: Number.MAX_SAFE_INTEGER };
  }
}

export function isInDatePreset(cellValue: unknown, preset: DatePreset, now: number = Date.now()): boolean {
  const n = typeof cellValue === "number" ? cellValue : Number(String(cellValue ?? ""));
  if (!Number.isFinite(n) || n <= 0) return false;
  const { from, to } = datePresetRange(preset, now);
  return n >= from && n <= to;
}
