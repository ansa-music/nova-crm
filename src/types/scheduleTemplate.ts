import type { ScheduleHours } from "@/types/techSchedule";

/**
 * Постоянная неделя графика: `workspaces/{ws}/scheduleTemplates/week`.
 *
 * Руководство ведёт график как недельную таблицу («Амина: Пн–Пт работа,
 * Сб–Вс вых; Адлет: Пн с 12:45»), а не как 31 клетку на человека. Неделя
 * задаётся ОДИН раз и сама раскладывается в месячный график
 * (`techSchedule/{uid}_{месяц}`) — на остаток текущего месяца и на весь
 * следующий. Месячный график остаётся единственным, что читают «Заказы»,
 * «Технари» и дашборд: неделя — это способ его заполнять, а не второй
 * источник правды.
 *
 * Один документ на весь workspace, а не документ на человека: его читает
 * каждый, кто открыл «График», и 40 чтений вместо одного на Spark — лишнее.
 */
export interface WeekTemplateEntry {
  /** День недели → `"off"`. Ключ — `Date#getUTCDay()` строкой («0» = вс … «6» = сб). Рабочий = нет ключа. */
  days?: Record<string, "off">;
  /** День недели → смена с/до. Бывает только у рабочего дня. */
  hours?: Record<string, ScheduleHours>;
  /**
   * «YYYY-MM»: по какой месяц включительно эта неделя уже разложена в график.
   * Месяцы после него раскладывает автопилот (`useWeekTemplateAutopilot`).
   */
  appliedThrough?: string;
}

export interface WeekTemplate {
  workspaceId: string;
  /** Ключ — id строки графика: uid участника или `ext_…` человека из своего раздела. */
  people: Record<string, WeekTemplateEntry>;
  updatedAt: number;
  updatedBy: string;
}

export const WEEK_TEMPLATE_DOC_ID = "week";

/** Понедельник первым: так неделю читают, а не так, как её нумерует JS. */
export const WEEK_DOWS = [1, 2, 3, 4, 5, 6, 0] as const;

export const WEEK_DOW_SHORT: Record<number, string> = { 1: "Пн", 2: "Вт", 3: "Ср", 4: "Чт", 5: "Пт", 6: "Сб", 0: "Вс" };

/** Клетка недели в том виде, в каком её показывают и правят. */
export interface WeekCell {
  off: boolean;
  hours: ScheduleHours | null;
}

export function weekCellOf(entry: WeekTemplateEntry | null | undefined, dow: number): WeekCell {
  const off = entry?.days?.[String(dow)] === "off";
  const hours = off ? null : entry?.hours?.[String(dow)] ?? null;
  return { off, hours: hours?.from ? hours : null };
}

export function sameScheduleHours(a: ScheduleHours | null | undefined, b: ScheduleHours | null | undefined): boolean {
  if (!a?.from || !b?.from) return !a?.from && !b?.from;
  return a.from === b.from && (a.to || "") === (b.to || "") && (a.label || "") === (b.label || "");
}

/** Неделя без мусора: часы только у рабочих дней, пустые карты не храним. */
export function normalizeWeekEntry(cells: Record<string, WeekCell>): Pick<WeekTemplateEntry, "days" | "hours"> {
  const days: Record<string, "off"> = {};
  const hours: Record<string, ScheduleHours> = {};
  for (const [dow, cell] of Object.entries(cells)) {
    if (cell.off) days[dow] = "off";
    else if (cell.hours?.from) hours[dow] = cleanHours(cell.hours);
  }
  return {
    ...(Object.keys(days).length ? { days } : {}),
    ...(Object.keys(hours).length ? { hours } : {}),
  };
}

/**
 * Часы без `undefined` внутри: `ignoreUndefinedProperties` выключен, и одно
 * `label: undefined` уронило бы запись всей недели.
 */
export function cleanHours(hours: ScheduleHours): ScheduleHours {
  return { from: hours.from, to: hours.to || "", ...(hours.label ? { label: hours.label } : {}) };
}

export function cellsOfEntry(entry: WeekTemplateEntry | null | undefined): Record<string, WeekCell> {
  const cells: Record<string, WeekCell> = {};
  for (const dow of WEEK_DOWS) cells[String(dow)] = weekCellOf(entry, dow);
  return cells;
}

export function sameWeek(a: WeekTemplateEntry | null | undefined, b: WeekTemplateEntry | null | undefined): boolean {
  return WEEK_DOWS.every((dow) => {
    const x = weekCellOf(a, dow);
    const y = weekCellOf(b, dow);
    return x.off === y.off && sameScheduleHours(x.hours, y.hours);
  });
}

/** Задана ли у человека неделя вообще (хоть один выходной или смена). */
export function hasWeek(entry: WeekTemplateEntry | null | undefined): boolean {
  return WEEK_DOWS.some((dow) => {
    const cell = weekCellOf(entry, dow);
    return cell.off || Boolean(cell.hours);
  });
}
