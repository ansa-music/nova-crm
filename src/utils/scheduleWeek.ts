/**
 * Неделя графика по НАСТОЯЩИМ датам (вкладка «Неделя»): понедельник недели,
 * её семь дней с ключами месяца и дня — теми же, по которым лежит
 * `techSchedule/{uid}_{monthKey}`, — и подписи для шапки.
 *
 * Всё считается по строке «YYYY-MM-DD» в UTC: день графика — календарная дата
 * компании, а часовой пояс уже учёл тот, кто дал «сегодня» (`ymdInTimeZone`).
 * Неделя может лежать в двух месяцах сразу (28 сентября – 4 октября) — тогда у
 * её дней разные `monthKey`, и читать и писать надо оба месяца.
 */
export interface WeekDate {
  /** «2026-10-13» — он же id столбца сетки. */
  ymd: string;
  /** «2026-10». */
  monthKey: string;
  /** День месяца без ведущего нуля — ключ дня в документе графика. */
  dayKey: string;
  /** День недели, `getUTCDay()`: 0 = вс … 6 = сб. */
  dow: number;
}

function parseYmd(ymd: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  // «2026-02-31» Date молча превращает в март — такую строку датой не считаем.
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

function toYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isYmd(value: string | null | undefined): value is string {
  return typeof value === "string" && parseYmd(value) !== null;
}

export function addDays(ymd: string, days: number): string {
  const date = parseYmd(ymd);
  if (!date) return ymd;
  date.setUTCDate(date.getUTCDate() + days);
  return toYmd(date);
}

/** Понедельник недели, в которую попадает дата. */
export function mondayOf(ymd: string): string {
  const date = parseYmd(ymd);
  if (!date) return ymd;
  return addDays(ymd, -((date.getUTCDay() + 6) % 7));
}

/** Дата как клетка графика: месяц, день и день недели. */
export function dateRef(ymd: string): WeekDate {
  const date = parseYmd(ymd);
  return {
    ymd,
    monthKey: ymd.slice(0, 7),
    dayKey: String(Number(ymd.slice(8, 10))),
    dow: date ? date.getUTCDay() : 0,
  };
}

/** Семь дней недели, понедельник первым. */
export function weekDates(mondayYmd: string): WeekDate[] {
  return Array.from({ length: 7 }, (_, i) => dateRef(addDays(mondayYmd, i)));
}

/** «2026-10» + «7» → «2026-10-07». */
export function ymdOf(monthKey: string, dayKey: string): string {
  return `${monthKey}-${String(Number(dayKey)).padStart(2, "0")}`;
}

/** Понедельник недели, в которую попадает 1-е число месяца. */
export function firstWeekOfMonth(monthKey: string): string {
  return mondayOf(`${monthKey}-01`);
}

/**
 * Месяц, к которому относится неделя: если в ней сегодня — месяц сегодняшнего
 * дня (по нему страница считает «сегодня на смене» и свою плашку), иначе
 * месяц её четверга — большинство дней недели лежит в нём.
 */
export function anchorMonthOf(mondayYmd: string, todayYmd: string): string {
  const last = addDays(mondayYmd, 6);
  if (todayYmd >= mondayYmd && todayYmd <= last) return todayYmd.slice(0, 7);
  return addDays(mondayYmd, 3).slice(0, 7);
}

const DAY = new Intl.DateTimeFormat("ru-RU", { day: "numeric", timeZone: "UTC" });
const DAY_MONTH = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
const DAY_MONTH_SHORT = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" });

/** «13–19 октября», а на стыке месяцев — «28 сент. – 4 окт.»; чужой год дописывается. */
export function weekRangeLabel(mondayYmd: string, todayYmd?: string): string {
  const first = parseYmd(mondayYmd);
  const last = parseYmd(addDays(mondayYmd, 6));
  if (!first || !last) return mondayYmd;
  const year = todayYmd && last.getUTCFullYear() !== Number(todayYmd.slice(0, 4)) ? ` ${last.getUTCFullYear()}` : "";
  if (first.getUTCMonth() === last.getUTCMonth()) return `${DAY.format(first)}–${DAY_MONTH.format(last)}${year}`;
  return `${DAY_MONTH_SHORT.format(first)} – ${DAY_MONTH_SHORT.format(last)}${year}`;
}

/** «13 окт.» — дата под днём недели в шапке столбца. */
export function dayMonthShort(ymd: string): string {
  const date = parseYmd(ymd);
  return date ? DAY_MONTH_SHORT.format(date) : ymd;
}

/** Где неделя относительно сегодняшней: «эта неделя», «следующая», «прошлая» или пусто. */
export function weekNearLabel(mondayYmd: string, todayYmd: string): string {
  const current = mondayOf(todayYmd);
  if (mondayYmd === current) return "эта неделя";
  if (mondayYmd === addDays(current, 7)) return "следующая неделя";
  if (mondayYmd === addDays(current, -7)) return "прошлая неделя";
  return "";
}
