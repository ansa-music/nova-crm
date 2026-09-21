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

export interface TechSchedule {
  id: string;
  workspaceId: string;
  uid: string;
  /** «YYYY-MM» по Алматы. */
  monthKey: string;
  /** Что поставил Тимлид/Owner. Отсутствие дня = рабочий. */
  days: Record<string, Exclude<ScheduleDayState, "work">>;
  /** Дни, в которые технарь сам нажал «Вышел на смену». Перебивает `days`. */
  selfWork: Record<string, boolean>;
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

/** Может ли технарь сегодня брать заказы по графику. */
export function isOnDuty(schedule: TechSchedule | null | undefined, dayKey: string): boolean {
  return scheduleStateOf(schedule, dayKey) === "work";
}
