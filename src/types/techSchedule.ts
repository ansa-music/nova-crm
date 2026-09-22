/**
 * График технаря на месяц: `workspaces/{ws}/techSchedule/{uid}_{monthKey}`.
 *
 * Выходные и «отпросился» ставит Тимлид/Owner — это и есть график. Сам
 * технарь может только ОДНО: сказать «вышел на смену» в день, который ему
 * поставили нерабочим. Поэтому два раздельных поля, а не одно: правила
 * пускают Тимлида в `days`, а технаря — строго в `selfWork`, и технарь
 * физически не может поставить себе выходной или стереть чужую отметку.
 *
 * День — номер без ведущего нуля («1».．.«31»), месяц — в id документа.
 */
export type ScheduleDayState = "work" | "off" | "excused";

export const SCHEDULE_DAY_LABELS: Record<ScheduleDayState, string> = {
  work: "Рабочий",
  off: "Выходной",
  excused: "Отпросился",
};

/** Гибридная смена: человек в этот день работает не весь день, а с/до. */
export interface ScheduleHours {
  /** «HH:MM» по Алматы — как в `<input type="time">`. */
  from: string;
  /** «HH:MM» или пусто — «с 12:45» без конца смены (так пишут в недельной таблице). */
  to: string;
  /**
   * Как показать, если одной пары с/до мало: «10–12, 15–19» из вставленной
   * таблицы. `from`/`to` тогда — начало первого и конец последнего отрезка.
   */
  label?: string;
}

export interface TechSchedule {
  id: string;
  workspaceId: string;
  uid: string;
  /** «YYYY-MM» по Алматы. */
  monthKey: string;
  /** Что поставил Тимлид/Owner. Отсутствие дня = рабочий. */
  days: Record<string, Exclude<ScheduleDayState, "work">>;
  /** Дни с отметкой «пришёл в рабочий день». Перебивает `days`. */
  selfWork: Record<string, boolean>;
  /** Гибридные смены: день → «с 12:00 до 15:00». День при этом рабочий. */
  hours?: Record<string, ScheduleHours>;
  updatedAt: number;
  updatedBy: string;
}

export function techScheduleId(uid: string, monthKey: string) {
  return `${uid}_${monthKey}`;
}

/** Номер дня как ключ графика — «7», а не «07»: так же его пишет и UI. */
export function scheduleDayKey(ymd: string): string {
  return String(Number(ymd.slice(8, 10)));
}

/**
 * Итоговое состояние дня. «Вышел на смену» перебивает и выходной, и
 * «отпросился»: человек сам сказал, что работает, и запрещать ему работать
 * из-за прошлой отметки — ровно то, чего просили не делать.
 */
export function scheduleStateOf(
  schedule: TechSchedule | null | undefined,
  dayKey: string
): ScheduleDayState {
  if (!schedule) return "work";
  if (schedule.selfWork?.[dayKey]) return "work";
  return schedule.days?.[dayKey] ?? "work";
}

/**
 * Часы гибридной смены. День с часами остаётся РАБОЧИМ: человек работает,
 * просто не весь день, и отклики на заказы ему закрывать не за что.
 */
export function scheduleHoursOf(
  schedule: TechSchedule | null | undefined,
  dayKey: string
): ScheduleHours | null {
  const hours = schedule?.hours?.[dayKey];
  return hours?.from ? hours : null;
}

export function formatScheduleHours(hours: ScheduleHours): string {
  if (hours.label) return hours.label;
  return hours.to ? `${hours.from}–${hours.to}` : `с ${hours.from}`;
}

/** Может ли технарь сегодня брать заказы по графику. */
export function isOnDuty(schedule: TechSchedule | null | undefined, dayKey: string): boolean {
  return scheduleStateOf(schedule, dayKey) === "work";
}
