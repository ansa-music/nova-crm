import {
  formatScheduleHours,
  sameScheduleHours,
  type ScheduleDayState,
  type ScheduleHours,
  type TechSchedule,
  type WeekCell,
  type WeekTemplateEntry,
} from "@/types";

export function daysOfMonthKey(monthKey: string): string[] {
  const [year, month] = monthKey.split("-").map(Number);
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => String(i + 1));
}

export function weekdayOfDay(monthKey: string, dayKey: string): number {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, Number(dayKey))).getUTCDay();
}

export interface MonthLayChanges {
  /** День → состояние (`"work"` = снять пометку) — формат `saveScheduleDraft`. */
  days: Record<string, ScheduleDayState>;
  /** День → часы (`null` = снять). */
  hours: Record<string, ScheduleHours | null>;
}

/**
 * Раскладывает неделю человека на месяц — с дня `fromDay` включительно.
 *
 * Главное правило: неделя переписывает только те дни, которые и так шли по
 * ПРОШЛОЙ неделе. Выходной, поставленный руками на один вторник (отпуск,
 * договорились), — это исключение, и смена недели его не стирает. «Прошлая
 * неделя» для месяца, который ещё ни разу не раскладывали, — «все дни
 * рабочие»: ровно так этот месяц и выглядел до недели, поэтому руками
 * поставленные в нём выходные тоже переживают первую раскладку.
 *
 * Разовые согласования — «отпросился» и «пришёл в рабочий день» — не
 * трогаются никогда: это не распорядок недели.
 *
 * Прошлые дни не трогаем вовсе (`fromDay`): график за них — уже история.
 */
export function layWeekOnMonth(input: {
  monthKey: string;
  fromDay: number;
  schedule: TechSchedule | null | undefined;
  /** Неделя, по которой месяц уже разложен; `null` — месяц ещё не раскладывали. */
  previous: WeekTemplateEntry | null | undefined;
  next: WeekTemplateEntry | null | undefined;
}): MonthLayChanges {
  const out: MonthLayChanges = { days: {}, hours: {} };
  const { schedule } = input;
  for (const dayKey of daysOfMonthKey(input.monthKey)) {
    if (Number(dayKey) < input.fromDay) continue;
    const stored = schedule?.days?.[dayKey];
    if (stored === "excused" || schedule?.selfWork?.[dayKey]) continue;

    const dow = String(weekdayOfDay(input.monthKey, dayKey));
    const storedState: ScheduleDayState = stored === "off" ? "off" : "work";
    const oldOff = input.previous?.days?.[dow] === "off";
    const newOff = input.next?.days?.[dow] === "off";
    // День поставлен руками вопреки прошлой неделе — это исключение, не трогаем.
    if (storedState !== (oldOff ? "off" : "work")) continue;
    const storedHours = schedule?.hours?.[dayKey] ?? null;
    // Часы, поставленные на рабочий день руками («договорились на полдня»), —
    // тоже исключение, и ВЕСЬ день целиком: проверять это надо ДО решения о
    // выходном, иначе новая неделя с выходным в этот день молча превращала
    // согласованные полдня в выходной и стирала часы.
    if (storedState === "work" && !sameScheduleHours(storedHours, input.previous?.hours?.[dow] ?? null)) continue;

    const newState: ScheduleDayState = newOff ? "off" : "work";
    if (newState !== storedState) out.days[dayKey] = newState;
    // Выходному часы не положены — их снимет само сохранение выходного.
    if (newState !== "work") continue;

    // Сюда доходят только дни, шедшие по прошлой неделе и по состоянию, и по
    // часам. Выходной, ставший рабочим, получает часы недели, а забытые под
    // выходным старые часы снимаются — иначе они молча всплыли бы.
    const newHours = input.next?.hours?.[dow] ?? null;
    if (!sameScheduleHours(storedHours, newHours)) out.hours[dayKey] = newHours;
  }
  return out;
}

export function isEmptyLay(changes: MonthLayChanges): boolean {
  return Object.keys(changes.days).length === 0 && Object.keys(changes.hours).length === 0;
}

// ---------------------------------------------------------------------------
// Вставка недельной таблицы (Google Sheets / Excel)
// ---------------------------------------------------------------------------

export type ParsedWeekCell =
  | { kind: "empty" }
  | { kind: "work" }
  | { kind: "off" }
  | { kind: "hours"; hours: ScheduleHours }
  | { kind: "unknown"; text: string };

const OFF_WORDS = new Set(["вых", "выходной", "выходные", "в", "off", "x", "х", "-", "—"]);
const WORK_WORDS = new Set(["работа", "раб", "р", "рабочий", "работает", "+", "весь день", "полный"]);

function normText(value: string): string {
  return value.toLowerCase().replace(/ё/g, "е").replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function readTime(hour: string, minute: string | undefined): string | null {
  const h = Number(hour);
  const m = minute === undefined ? 0 : Number(minute);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 24 || m < 0 || m > 59) return null;
  if (h === 24 && m > 0) return null;
  return `${pad2(h)}:${pad2(m)}`;
}

/** «12:00» → «12», «12:30» → «12:30» — как пишут в таблице. */
function compactTime(time: string): string {
  const [h, m] = time.split(":");
  return m === "00" ? String(Number(h)) : `${Number(h)}:${m}`;
}

const TIME_RE = /(\d{1,2})(?:[:.](\d{2}))?/g;

/**
 * Один отрезок: «с 12:45», «12:30 до 15:00», «с 11 до 18», «10-12», «15:30».
 * Грамматика СТРОГАЯ: кроме времени допускаются только «с/от» в начале и
 * «-/до/по» между. Любое другое слово — не наш формат: «работа до 15»
 * читалось бы как «с 15:00» (ровно наоборот), «8 часов» — как «с 08:00».
 * Одиночное число без двоеточия и без «с» («12», «1», «0») — тоже не время:
 * так в таблицах пишут и часы работы, и отметки 1/0.
 */
function parseRange(part: string): { from: string; to: string } | null {
  const times: string[] = [];
  let colon = false;
  const shape = part
    .replace(TIME_RE, (_m, h: string, min: string | undefined) => {
      const time = readTime(h, min);
      if (!time) return " ? ";
      times.push(time);
      if (min !== undefined) colon = true;
      return " T ";
    })
    .replace(/-/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
  if (/^(?:(?:с|c|от) )?T$/.test(shape)) {
    if (!colon && !/^(с|c|от) /.test(shape)) return null;
    return { from: times[0], to: "" };
  }
  if (/^(?:(?:с|c|от) )?T (?:-|до|по) T$/.test(shape)) {
    if (times[1] <= times[0]) return null;
    return { from: times[0], to: times[1] };
  }
  return null;
}

/**
 * Клетка недельной таблицы: «работа», «вых», «с 12:45», «12:30 до 15:00»,
 * «с 11 до 18», «10-12,15-19», «15:30». Что не узнали — `unknown`, и такую
 * клетку не пишем, а показываем человеку: молча неверно — хуже, чем «не понял».
 */
export function parseWeekCell(raw: string): ParsedWeekCell {
  // Перенос строки внутри клетки («10-12↵15-19») — это второй отрезок; его
  // надо превратить в разделитель ДО того, как normText склеит пробелы.
  const text = normText(raw.replace(/^"|"$/g, "").replace(/\s*\n\s*/g, ", "));
  if (!text) return { kind: "empty" };
  if (OFF_WORDS.has(text)) return { kind: "off" };
  if (WORK_WORDS.has(text)) return { kind: "work" };
  const unknown = { kind: "unknown" as const, text: raw.trim() };

  const parts = text.split(/[,;/]| и /).map((p) => p.trim()).filter(Boolean);
  const ranges: Array<{ from: string; to: string }> = [];
  for (const part of parts) {
    const range = parseRange(part);
    if (!range) return unknown;
    ranges.push(range);
  }
  if (ranges.length === 0) return unknown;
  if (ranges.length === 1) return { kind: "hours", hours: { from: ranges[0].from, to: ranges[0].to } };
  // Несколько отрезков: у каждого нужен конец, и они не должны налезать друг
  // на друга. Храним начало самого раннего и конец самого позднего, а
  // показываем как в таблице — по порядку.
  if (ranges.some((r) => !r.to)) return unknown;
  ranges.sort((a, b) => a.from.localeCompare(b.from));
  for (let i = 1; i < ranges.length; i += 1) if (ranges[i].from < ranges[i - 1].to) return unknown;
  const label = ranges.map((r) => `${compactTime(r.from)}–${compactTime(r.to)}`).join(", ");
  return { kind: "hours", hours: { from: ranges[0].from, to: ranges[ranges.length - 1].to, label } };
}

const DAY_WORDS: Record<string, number> = {
  пн: 1, пон: 1, понед: 1, понедельник: 1, mon: 1, monday: 1,
  вт: 2, вто: 2, втор: 2, вторник: 2, tue: 2, tuesday: 2,
  ср: 3, сре: 3, сред: 3, среда: 3, wed: 3, wednesday: 3,
  чт: 4, чет: 4, четв: 4, четверг: 4, thu: 4, thursday: 4,
  пт: 5, пят: 5, пятн: 5, пятница: 5, fri: 5, friday: 5,
  сб: 6, суб: 6, субб: 6, суббота: 6, sat: 6, saturday: 6,
  вс: 0, вос: 0, воск: 0, воскр: 0, воскресенье: 0, sun: 0, sunday: 0,
};

/**
 * День недели из заголовка — ЦЕЛЫМ словом: префиксы ловили «Всего» как «Вс» и
 * «Среднее» как «Ср», и итоговая колонка затирала настоящее воскресенье. У
 * заголовка из двух строк («Понедельник / 22.09») смотрим только первую.
 */
function headerDow(cell: string): number | null {
  const first = normText(cell.split("\n")[0]).replace(/\.$/, "");
  return Object.prototype.hasOwnProperty.call(DAY_WORDS, first) ? DAY_WORDS[first] : null;
}

/**
 * TSV с кавычками — ровно так Google Sheets и Excel кладут таблицу в буфер:
 * клетка с переносом строки приходит в кавычках, `""` внутри — это `"`.
 * Резать текст по `\n` до кавычек нельзя: «10-12↵15-19» становилась двумя
 * строками таблицы, и вся неделя человека съезжала.
 */
export function splitTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let atStart = true;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else if (ch !== "\r") {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && atStart) {
      quoted = true;
      atStart = false;
    } else if (ch === "\t") {
      row.push(cell);
      cell = "";
      atStart = true;
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      atStart = true;
    } else if (ch !== "\r") {
      cell += ch;
      atStart = false;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim()));
}

export interface PastedWeekRow {
  name: string;
  cells: Record<string, ParsedWeekCell>;
}

export interface PastedWeekTable {
  rows: PastedWeekRow[];
  /** Нашлась ли строка с днями недели. Без неё колонки после имени читаем как Пн…Вс по порядку. */
  headerFound: boolean;
}

const hasLetter = (value: string) => /\p{L}/u.test(value);
const isValue = (value: string) => {
  const kind = parseWeekCell(value).kind;
  return kind === "off" || kind === "work" || kind === "hours";
};
const SUMMARY_NAME = /люди на смене|на смене|итого|всего|сумма|количество/i;
const NAME_HEADER = /^(имя|фио|сотрудник|сотрудники|кто|ник|человек|name|технарь|технари|ос|оператор)/;
const NOT_NAME_HEADER = /^(№|#|n|номер|роль|должность|раздел|отдел|группа|смена|стаж|телефон)/;

/**
 * Таблица, скопированная из Google Sheets: строки — люди, колонки — дни
 * недели. Строки-заголовки разделов («Понедельник…» посреди таблицы) и итоги
 * («люди на смене 19 20 19…») пропускаются сами.
 *
 * Заголовок — строка, где есть хоть один день недели и нет ни одной
 * клетки-значения («вых», «с 12:45»): так распознаётся и блок из одних
 * «Сб | Вс». Колонку имени берём по подписи («Имя», «ФИО»), иначе — ближайшую
 * к дням колонку с буквами: слева бывают «№» и название раздела.
 */
export function parseWeekTable(text: string): PastedWeekTable {
  const grid = splitTsv(text).filter((cells) => cells.some(Boolean));
  let columns: Array<{ index: number; dow: number }> | null = null;
  let nameColumn: number | null = null;
  let skipColumns = new Set<number>();
  let headerFound = false;
  const rows: PastedWeekRow[] = [];

  for (const cells of grid) {
    const dows = cells.map(headerDow);
    const isHeader = dows.some((d) => d !== null) && cells.every((c, i) => !c || dows[i] !== null || !isValue(c));
    if (isHeader) {
      const seen = new Set<number>();
      columns = [];
      dows.forEach((dow, index) => {
        // Повтор дня (вторая неделя, «Всего» уже отсечено) — берём ПЕРВУЮ колонку.
        if (dow === null || seen.has(dow)) return;
        seen.add(dow);
        columns!.push({ index, dow });
      });
      const firstDay = Math.min(...columns.map((c) => c.index));
      const labels = cells.slice(0, firstDay).map(normText);
      const named = labels.findIndex((l) => NAME_HEADER.test(l));
      nameColumn = named >= 0 ? named : null;
      skipColumns = new Set(labels.flatMap((l, i) => (NOT_NAME_HEADER.test(l) ? [i] : [])));
      headerFound = true;
      continue;
    }

    let layout = columns;
    let name = "";
    if (layout) {
      const firstDay = Math.min(...layout.map((c) => c.index));
      if (nameColumn !== null) {
        name = cells[nameColumn] ?? "";
      } else {
        for (let i = firstDay - 1; i >= 0; i -= 1) {
          if (!skipColumns.has(i) && hasLetter(cells[i] ?? "")) {
            name = cells[i];
            break;
          }
        }
      }
    } else {
      // Без заголовка: имя — последняя клетка с буквами перед первым
      // значением, дни — семь клеток сразу за именем, Пн…Вс по порядку.
      const firstValue = cells.findIndex(isValue);
      const limit = firstValue < 0 ? cells.length : firstValue;
      let nameIndex = -1;
      for (let i = limit - 1; i >= 0; i -= 1) {
        if (hasLetter(cells[i])) {
          nameIndex = i;
          break;
        }
      }
      if (nameIndex < 0) continue;
      name = cells[nameIndex];
      layout = [1, 2, 3, 4, 5, 6, 0].map((dow, i) => ({ index: nameIndex + 1 + i, dow }));
    }

    name = name.split("\n")[0].trim();
    if (!name || !hasLetter(name) || SUMMARY_NAME.test(name)) continue;
    const parsed: Record<string, ParsedWeekCell> = {};
    let meaningful = 0;
    for (const { index, dow } of layout) {
      const cell = parseWeekCell(cells[index] ?? "");
      parsed[String(dow)] = cell;
      if (cell.kind !== "empty") meaningful += 1;
    }
    if (meaningful === 0) continue;
    rows.push({ name, cells: parsed });
  }
  return { rows, headerFound };
}

/** Клетка после вставки: пустая и нераспознанная — оставляем как было. */
export function applyParsedCell(current: WeekCell, parsed: ParsedWeekCell): WeekCell {
  switch (parsed.kind) {
    case "off":
      return { off: true, hours: null };
    case "work":
      return { off: false, hours: null };
    case "hours":
      return { off: false, hours: parsed.hours };
    default:
      return current;
  }
}

function nameTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export interface NameCandidate {
  id: string;
  names: string[];
}

/**
 * Насколько имя из таблицы похоже на имя человека, 0…3. Сравнение ПО СЛОВАМ:
 * по сырому началу строки «Алия» совпадала с «Али», «Дина» — с «Динарой».
 *  3 — все слова совпали;
 *  2 — первое слово совпало, а следующие — начала слов кандидата («Али А» ↔
 *      «Али Ахметов»);
 *  1 — совпало только первое слово («Амина» ↔ «Амина Касымова»);
 *  0 — иначе, в том числе если следующее слово ПРОТИВОРЕЧИТ («Альбина С» и
 *      «Альбина Иванова» — разные люди).
 */
function nameScore(pasted: string[], key: string[]): number {
  if (pasted.length === 0 || key.length === 0 || pasted[0] !== key[0]) return 0;
  if (pasted.length === key.length && pasted.every((t, i) => t === key[i])) return 3;
  const shared = Math.min(pasted.length, key.length);
  for (let i = 1; i < shared; i += 1) if (!key[i].startsWith(pasted[i])) return 0;
  return pasted.length > 1 && pasted.length <= key.length ? 2 : 1;
}

/**
 * Имена из таблицы → строки графика. Проходами от сильного совпадения к
 * слабому по ВСЕМ строкам сразу: иначе слабое совпадение сверху таблицы
 * забирало человека у точного совпадения ниже. На каждом проходе кандидат
 * должен быть ЕДИНСТВЕННЫМ и для строки, и для человека — спорное не
 * угадываем, пусть человек выберет сам, чем неделя уедет не тому.
 */
export function matchPastedNames(names: string[], candidates: NameCandidate[]): Array<string | null> {
  const pasted = names.map(nameTokens);
  const keys = candidates.map((c) => ({ id: c.id, keys: c.names.map(nameTokens).filter((k) => k.length > 0) }));
  const result: Array<string | null> = names.map(() => null);
  const claimed = new Set<string>();
  for (const level of [3, 2, 1]) {
    const wants = new Map<number, string>();
    const wantedBy = new Map<string, number[]>();
    pasted.forEach((tokens, row) => {
      if (result[row] || tokens.length === 0) return;
      const hits = keys.filter(
        (c) => !claimed.has(c.id) && Math.max(0, ...c.keys.map((k) => nameScore(tokens, k))) === level
      );
      if (hits.length !== 1) return;
      wants.set(row, hits[0].id);
      wantedBy.set(hits[0].id, [...(wantedBy.get(hits[0].id) ?? []), row]);
    });
    for (const [row, id] of wants) {
      if ((wantedBy.get(id) ?? []).length !== 1) continue;
      result[row] = id;
      claimed.add(id);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Быстрая правка недели: смены текстом, частые смены, поиск, память имён
// ---------------------------------------------------------------------------

/**
 * Смена, набранная текстом: «12:30-15», «с 12:45», «10-12, 15-19» — тем же
 * строгим разбором, что и вставка из таблицы. Два поля `type=time` на смену
 * — это восемь касаний и колёсико на телефоне; так пишут и в Google Sheets.
 * Не смена (пусто, «вых», непонятное) — null.
 */
export function parseShiftText(text: string): ScheduleHours | null {
  const parsed = parseWeekCell(text);
  return parsed.kind === "hours" ? parsed.hours : null;
}

function hoursKey(hours: ScheduleHours): string {
  return `${hours.from}|${hours.to || ""}|${hours.label || ""}`;
}

/**
 * Смены, которые в команде ставят чаще всего, — готовые кнопки: неполные
 * смены у всех одни и те же («12:30–15:00», «с 12:45»), и набирать их каждый
 * раз заново незачем. Сначала самые частые, при равенстве — по началу.
 */
export function frequentShifts(list: Array<ScheduleHours | null | undefined>, limit = 6): ScheduleHours[] {
  const counts = new Map<string, { hours: ScheduleHours; count: number }>();
  for (const hours of list) {
    if (!hours?.from) continue;
    const key = hoursKey(hours);
    const found = counts.get(key);
    if (found) found.count += 1;
    else counts.set(key, { hours: { from: hours.from, to: hours.to || "", ...(hours.label ? { label: hours.label } : {}) }, count: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.hours.from.localeCompare(b.hours.from) || (a.hours.to || "").localeCompare(b.hours.to || ""))
    .slice(0, limit)
    .map((entry) => entry.hours);
}

/**
 * Подходит ли человек под поиск: каждое слово запроса — начало какого-то
 * слова в имени, нике или подписи. «али» находит «Али Ахметов», «ахм» — его
 * же; «ли» — нет (иначе на «а» подсвечивалась бы вся команда).
 */
export function matchesPersonQuery(query: string, names: Array<string | null | undefined>): boolean {
  const wanted = nameTokens(query);
  if (wanted.length === 0) return true;
  const tokens = names.flatMap((name) => (name ? nameTokens(name) : []));
  return wanted.every((w) => tokens.some((t) => t.startsWith(w)));
}

/** Ключ имени из таблицы для памяти «это имя — этот человек»: регистр, «ё» и знаки не важны. */
export function pastedNameKey(name: string): string {
  return nameTokens(name).join(" ");
}

/**
 * Кому отдать строку вставки: сначала то, что человек уже выбирал руками для
 * этого имени в прошлый раз (таблицу вставляют каждую неделю, и одни и те же
 * «Дина Р.» / «Адлет (ОС)» не должны требовать выбора снова), потом
 * автоматическое совпадение. Один человек — одной строке: запомненный выбор
 * сильнее автоматики, и автоматике достаются только свободные.
 */
export function resolvePastedTargets(
  names: string[],
  auto: Array<string | null>,
  remembered: Record<string, string>,
  candidateIds: ReadonlySet<string>
): Array<string | null> {
  const fromMemory = names.map((name) => {
    const id = remembered[pastedNameKey(name)];
    return id && candidateIds.has(id) ? id : null;
  });
  const seen = new Map<string, number>();
  fromMemory.forEach((id) => id && seen.set(id, (seen.get(id) ?? 0) + 1));
  const memoryIds = new Set([...seen].filter(([, n]) => n === 1).map(([id]) => id));
  return names.map((_, i) => {
    const mem = fromMemory[i];
    if (mem && memoryIds.has(mem)) return mem;
    const guess = auto[i];
    return guess && !memoryIds.has(guess) ? guess : null;
  });
}

function sameWeekCell(a: WeekCell, b: WeekCell): boolean {
  return a.off === b.off && sameScheduleHours(a.hours, b.hours);
}

/**
 * Какие дни вставка поменяет у человека: день недели → было/станет. Пустые и
 * непонятные клетки день не меняют (`applyParsedCell`), поэтому и здесь их нет.
 */
export function pastedWeekChanges(
  current: Record<string, WeekCell>,
  parsed: Record<string, ParsedWeekCell>
): Record<string, { before: WeekCell; after: WeekCell }> {
  const out: Record<string, { before: WeekCell; after: WeekCell }> = {};
  for (const [dow, cell] of Object.entries(parsed)) {
    const before = current[dow] ?? { off: false, hours: null };
    const after = applyParsedCell(before, cell);
    if (!sameWeekCell(before, after)) out[dow] = { before, after };
  }
  return out;
}

/** «вых» / «работа» / «12:30–15:00» — клетка недели одной строкой. */
export function weekCellText(cell: WeekCell | null | undefined): string {
  if (!cell) return "работа";
  if (cell.off) return "вых";
  return cell.hours ? formatScheduleHours(cell.hours) : "работа";
}
