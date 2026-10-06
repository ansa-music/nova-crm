import { normalizeNumericInput, parseLooseNumber } from "@/utils/numberInput";
import { normalizeRowExtras, type RowExtras } from "@/utils/rowExtras";
import { isOptionColumn } from "@/utils/columnOptions";
import { almatyNoonMillis, formatOrderDate } from "@/utils/date";
import { findDeadlineColumn } from "@/utils/studioDeadline";
import type { PageColumn, PageRow, StatusOption } from "@/types";

export type QuickOrderInput = {
  client: string;
  number: string;
  os: string;
  check: string;
  persons: string;
  minutes: string;
  /** Free-form wishes for the client card. */
  note: string;
  /** Ссылка на клиента — в столбец типа «ссылка», если он есть («Заказы»). */
  link?: string;
  /** Дедлайн сдачи (мс) — в столбец-дату, если он есть («Заказы»). */
  deadline?: number | null;
};

function normLabel(label: string) {
  return label.trim().toLowerCase();
}

function firstMatch(columns: PageColumn[], re: RegExp): PageColumn | undefined {
  return columns.find((c) => re.test(normLabel(c.label)));
}

/**
 * Видимые столбцы впереди, скрытые следом: подбор идёт по видимым, но
 * скрытый столбец не съедает значение — слот, который видимые не заняли,
 * достаётся скрытому. Иначе спрятанная «Цена» теряла бы сумму заказа.
 */
export function mergeColumnPicks(visible: PageColumn[], all: PageColumn[]): PageColumn[] {
  if (visible.length === 0) return all;
  const seen = new Set(visible.map((c) => c.key));
  return [...visible, ...all.filter((c) => !seen.has(c.key))];
}

export function findQuickOrderColumns(visible: PageColumn[]) {
  const client = firstMatch(visible, /клиент|назван|имя/) ?? visible.find((c) => c.type === "text");
  const number = firstMatch(visible, /номер|тел|phone/);
  // Название, потом тип — как у client/receipt/link рядом. Без фоллбэка на
  // тип переименованный столбец («Менеджер», «Ответственный») не находился, и
  // ник ОС не писался вообще, хотя ЧИТАЕТ его `osColumnsOf` по типу: заказ не
  // попадал в «Мои заказы» ОС, а через 30 дней у него тихо пропадало право
  // оценивать технаря.
  const os = firstMatch(visible, /^ос$|\bos\b/) ?? visible.find((c) => c.type === "responsible");
  const receipt = visible.find((c) => c.type === "currency") ?? firstMatch(visible, /цена|сумм|чек/);
  const persons = firstMatch(visible, /перс|персонаж/);
  const minutes = firstMatch(visible, /мин/);
  const link = visible.find((c) => c.type === "url") ?? firstMatch(visible, /ссылк|сайт|link|url/);
  const date = visible.find((c) => c.type === "date");
  // Дедлайн — ТОЛЬКО в столбец, названный как срок. Раньше он шёл в первый
  // же столбец-дату, а её `orderDayInMonth` читает как дату ПОЛУЧЕНИЯ заказа:
  // заказ от 3-го с дедлайном 20-го вставал на 20-е в «Заказы по дням» и в
  // суммах дашборда, а дедлайн из следующего месяца не матчил monthKey и
  // молча откатывался на createdAt — часть заказов датировалась одним, часть
  // другим. Нет столбца «Дедлайн» — дедлайн остаётся только в карточке заказа.
  const deadline = firstMatch(visible, /дедлайн|сдач|срок|deadline/);
  return { client, number, os, receipt, persons, minutes, link, date, deadline };
}

/**
 * Same loose parser the table cells use, so the quick-order form accepts
 * exactly what a person actually types. The old comma→dot + Number() version
 * handled "1500,5" and nothing else: "12 000" and "12 000 ₸" came back null,
 * and since the Save button is enabled only when the чек parses, typing a
 * perfectly normal amount with a thousands space left the form refusing to
 * submit with nothing explaining why. Worse, "2.000" (thousands dot) parsed
 * as 2 — a silently 1000x wrong amount written straight into the desk.
 */
export function parseOptionalNumber(raw: string): number | null {
  return parseLooseNumber(raw);
}

export function buildQuickOrderRow(
  allColumns: PageColumn[],
  visible: PageColumn[],
  input: QuickOrderInput
): {
  cells: Record<string, string | number | null>;
  extras?: PageRow["extras"];
  nameKey: string | null;
} {
  const cols = findQuickOrderColumns(visible);
  const cells: Record<string, string | number | null> = {};
  for (const c of allColumns) cells[c.key] = "";

  const client = input.client.trim();
  const number = input.number.trim();
  const os = input.os.trim();
  const check = parseOptionalNumber(input.check);
  if (cols.client) cells[cols.client.key] = client;
  if (cols.number && number) cells[cols.number.key] = number;
  if (cols.os && os) cells[cols.os.key] = os;
  if (cols.receipt && check != null) cells[cols.receipt.key] = check;
  const link = (input.link ?? "").trim();
  if (cols.link && link) cells[cols.link.key] = link;
  if (cols.deadline && input.deadline != null) cells[cols.deadline.key] = input.deadline;

  const persons = parseOptionalNumber(input.persons);
  const minutes = parseOptionalNumber(input.minutes);
  if (cols.persons && persons != null) cells[cols.persons.key] = persons;
  if (cols.minutes && minutes != null) cells[cols.minutes.key] = minutes;

  // Дедлайн уходит и в визитку: столбца «Дедлайн» может не быть, а срок
  // должен быть виден там, где технарь открывает карточку клиента.
  const extras = normalizeRowExtras({ persons, minutes, note: input.note, link, deadline: input.deadline ?? null });

  return {
    cells,
    extras: extras ?? undefined,
    nameKey: cols.client?.key ?? null,
  };
}

// ---------------------------------------------------------------------
// NOVA Studio (`site.profile === "studio"`, 06.10.2026): тип работы, тема и
// своя форма заказа на столе. Вызывается ТОЛЬКО под флагом студии — у
// остальных компаний ни одна функция ниже не зовётся.
// ---------------------------------------------------------------------

/** Подпись темы в первой строке пожеланий — её же ищет разбор при заезде в стол. */
const STUDIO_TOPIC_PREFIX = "Тема:";

/** Первая строка пожеланий заказа студии: «[Курсовая] Тема: …» (любая часть может отсутствовать). */
const STUDIO_NOTE_HEAD_RE = /^\s*(?:\[([^\]\n]+)\])?[ \t]*(?:Тема:[ \t]*([^\n]*?))?[ \t]*$/;

/**
 * У заказа «Рандома» нет полей «Тип работы» и «Тема» (набор полей держит база,
 * `order_write`, — без SQL его не расширить), поэтому в студии они едут
 * ПЕРВОЙ строкой пожеланий: «[Курсовая] Тема: Инфляция в Казахстане», ниже —
 * то, что написал выдающий. Пустые части не пишутся; без обеих — пожелания
 * как есть, байт в байт. Заезд в стол (`studioOrderDeskCells`) разбирает
 * строку обратно по столбцам.
 */
export function packStudioOrderNote(workType: string, topic: string, note: string): string {
  // Скобки и переносы внутри частей сломали бы разбор первой строки.
  const type = workType.replace(/[[\]\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  const theme = topic.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  const head = [type ? `[${type}]` : "", theme ? `${STUDIO_TOPIC_PREFIX} ${theme}` : ""].filter(Boolean).join(" ");
  if (!head) return note;
  const rest = note.trim();
  return rest ? `${head}\n${rest}` : head;
}

/**
 * Обратно: тип, тема и остаток пожеланий. Первая строка узнаётся только
 * ровно в формате `packStudioOrderNote`; иначе вся строка — обычные пожелания.
 */
export function parseStudioOrderNote(note: string | null | undefined): { workType: string; topic: string; rest: string } {
  const text = note ?? "";
  const nl = text.indexOf("\n");
  const first = nl < 0 ? text : text.slice(0, nl);
  const match = STUDIO_NOTE_HEAD_RE.exec(first);
  if (!match || (match[1] === undefined && match[2] === undefined)) return { workType: "", topic: "", rest: text.trim() };
  return {
    workType: (match[1] ?? "").trim(),
    topic: (match[2] ?? "").trim(),
    rest: nl < 0 ? "" : text.slice(nl + 1).trim(),
  };
}

/** «YYYY-MM-DD» из `<input type=date>` → полдень этого дня по часам компании (как ячейка-дата); иначе null. */
export function dateInputMillis(raw: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const year = Number(m[1]);
  // Год < 2000 — человек ещё печатает (браузер шлёт change на каждую цифру).
  if (year < 2000) return null;
  const ms = almatyNoonMillis(year, Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(ms) ? ms : null;
}

const STUDIO_NUMERIC_TYPES = new Set<string>(["number", "currency"]);

/** Значение варианта по подписи (без учёта регистра) или по самому значению; null — такого нет. */
function optionValueByLabel(options: StatusOption[], label: string): string | null {
  const want = normLabel(label);
  if (!want) return null;
  return (options.find((o) => normLabel(o.label) === want) ?? options.find((o) => o.value === label.trim()))?.value ?? null;
}

/**
 * Что писать в столбец «выбора» (тип работы, оплата): у столбца-списка — значение
 * его варианта (подписи без пары нет — null, ячейку не трогаем: голый id
 * варианта в ячейке рисовался бы «—»), у обычного текстового — саму подпись.
 */
function choiceCellValue(column: PageColumn, label: string, optionsOf: (column: PageColumn) => StatusOption[]): string | null {
  const text = label.trim();
  if (!text) return null;
  return isOptionColumn(column.type) ? optionValueByLabel(optionsOf(column), text) : text;
}

/**
 * Заезд заказа «Рандома» в стол студии (`takeOrderToDesk` под сохранённым
 * флагом): первая строка пожеланий — в «Тип работы» (значение варианта) и
 * «Тему», телефон — в «Телефон / Telegram» по ключу шаблона, сегодня — в
 * «Дату заказа» (ключ шаблона, иначе первый столбец-дата, кроме дедлайна).
 * Что положить некуда (стол не по шаблону, подписи типа нет в списке),
 * остаётся в пожеланиях визитки — ничего не теряется.
 *
 * `columns` — столбцы таблицы, куда пишем, в порядке таблицы. Возвращает
 * ячейки поверх `buildQuickOrderRow`, ключи, которые надо опустошить (телефон
 * переехал из «Номера» в «Контакт»), остаток пожеланий, ключ даты заказа и
 * `deadlineInColumn` — срок лёг в столбец срока стола (`studioDeadlineColumn`),
 * и визитке его повторять не нужно (`extrasWithoutDeadline`).
 */
export function studioOrderDeskCells(input: {
  columns: PageColumn[];
  note: string;
  phone: string;
  /** Дедлайн заказа (мс) — тот же, что уходит в `buildQuickOrderRow`. */
  deadline: number | null;
  optionsOf: (column: PageColumn) => StatusOption[];
  now: number;
}): { cells: Record<string, string>; clear: string[]; note: string; dateKey: string | null; deadlineInColumn: boolean } {
  const { columns, optionsOf } = input;
  const pick = mergeColumnPicks(
    columns.filter((c) => !c.hidden),
    columns
  );
  const quick = findQuickOrderColumns(pick);
  const deadlineCol = studioDeadlineColumn(columns);
  const cells: Record<string, string> = {};
  const clear: string[] = [];
  const parsed = parseStudioOrderNote(input.note);

  let typeLeft = parsed.workType;
  if (parsed.workType) {
    const col = pick.find((c) => c.key === "workType") ?? firstMatch(pick, /тип\s*работ|вид\s*работ/);
    const value = col ? choiceCellValue(col, parsed.workType, optionsOf) : null;
    if (col && value) {
      cells[col.key] = value;
      typeLeft = "";
    }
  }
  let topicLeft = parsed.topic;
  if (parsed.topic) {
    const col = pick.find((c) => c.key === "topic") ?? firstMatch(pick, /^тем[аы](?![а-яё])/);
    if (col && !isOptionColumn(col.type)) {
      cells[col.key] = parsed.topic;
      topicLeft = "";
    }
  }

  // Телефон — по ключу шаблона: подпись «Телефон / Telegram» Owner мог
  // переименовать, и подбор `/номер|тел/` её бы уже не нашёл.
  const phone = input.phone.trim();
  const contact = pick.find((c) => c.key === "contact" && !isOptionColumn(c.type));
  if (contact && phone) {
    cells[contact.key] = phone;
    if (quick.number && quick.number.key !== contact.key) clear.push(quick.number.key);
  }

  const dateCol =
    columns.find((c) => c.key === "orderDate" && c.type === "date") ??
    columns.find((c) => c.type === "date" && c.key !== quick.deadline?.key && c.key !== deadlineCol?.key);
  if (dateCol) cells[dateCol.key] = String(input.now);

  return {
    cells,
    clear,
    note: parsed.workType || parsed.topic ? packStudioOrderNote(typeLeft, topicLeft, parsed.rest) : input.note,
    dateKey: dateCol?.key ?? null,
    // `buildQuickOrderRow` пишет срок в `quick.deadline` — считается, только
    // если это и есть столбец срока стола (его видно и он подсвечивается).
    deadlineInColumn: input.deadline != null && deadlineCol != null && quick.deadline?.key === deadlineCol.key,
  };
}

/**
 * Столбец срока стола студии — тот же, что подсвечивает таблица
 * (`findDeadlineColumn` по видимым столбцам, как в DataTable). Есть он —
 * срок строки живёт ТОЛЬКО в нём: визитка поле «Дедлайн сдачи» не
 * показывает, заезд заказа и форма «+ Заказ» срок в визитку не пишут. Нет —
 * срок, как раньше, в визитке.
 */
export function studioDeadlineColumn(columns: readonly PageColumn[]): PageColumn | null {
  const visible = columns.filter((c) => !c.hidden);
  return findDeadlineColumn(visible, findQuickOrderColumns(visible).deadline);
}

/** Визитка без срока (он уже в столбце срока); пустая — undefined, как у `buildQuickOrderRow`. */
export function extrasWithoutDeadline(extras: PageRow["extras"] | undefined): PageRow["extras"] | undefined {
  if (extras?.deadline == null) return extras;
  return normalizeRowExtras({ ...extras, deadline: null }) ?? undefined;
}

/** Поля формы «+ Заказ» стола студии (`StudioOrderDialog`). Тип и оплата — ПОДПИСИ вариантов. */
export type StudioOrderForm = {
  client: string;
  contact: string;
  workType: string;
  topic: string;
  subject: string;
  /** «YYYY-MM-DD» из поля даты; пусто — без дедлайна. */
  deadline: string;
  amount: string;
  prepaid: string;
  payBank: string;
  note: string;
};

export type StudioOrderField = keyof StudioOrderForm | "orderDate" | "status";

export type StudioOrderTargets = Partial<Record<StudioOrderField, PageColumn>>;

type StudioFieldRule = {
  field: Exclude<StudioOrderField, "orderDate">;
  /** Ключ столбца в шаблоне студии (`STUDIO_DESK_COLUMNS`). */
  key: string;
  /** Подходит ли столбец по типу — чтобы «Статус» не стал «Комментарием». */
  accepts: (column: PageColumn) => boolean;
  /** Сначала — первый столбец этого типа (сумма — первый денежный, как у дашборда). */
  byType?: (column: PageColumn) => boolean;
  re: RegExp | null;
};

const isTextual = (c: PageColumn) => c.type === "text" || c.type === "phone" || c.type === "email" || c.type === "url";
const isAmountType = (c: PageColumn) => STUDIO_NUMERIC_TYPES.has(c.type) || c.type === "text";
const isChoiceType = (c: PageColumn) => c.type === "custom" || c.type === "text";

/**
 * Порядок важен: поле, стоящее выше, забирает столбец первым («Предоплата» —
 * раньше «Суммы», иначе «Сумма предоплаты» досталась бы сумме заказа;
 * «Оплата» ищется после «Предоплаты» и только с начала подписи).
 */
const STUDIO_ORDER_RULES: StudioFieldRule[] = [
  { field: "client", key: "client", accepts: (c) => c.type === "text", re: /клиент|заказчик|имя|фио|назван/ },
  { field: "contact", key: "contact", accepts: isTextual, re: /тел|telegram|телеграм|контакт|phone|номер|whats|ватс/ },
  { field: "workType", key: "workType", accepts: isChoiceType, re: /тип\s*работ|вид\s*работ|^тип$/ },
  { field: "topic", key: "topic", accepts: (c) => c.type === "text", re: /^тем[аы](?![а-яё])|тема работ/ },
  { field: "subject", key: "subject", accepts: (c) => c.type === "text", re: /предмет|дисциплин/ },
  { field: "deadline", key: "deadline", accepts: (c) => c.type === "date" || c.type === "text", re: /дедлайн|сдач|срок|deadline/ },
  { field: "status", key: "status", accepts: (c) => c.type === "status", byType: (c) => c.type === "status", re: null },
  { field: "prepaid", key: "prepaid", accepts: isAmountType, re: /предоплат|аванс/ },
  { field: "amount", key: "amount", accepts: isAmountType, byType: (c) => c.type === "currency", re: /сумм|цена|стоимост|чек/ },
  { field: "payBank", key: "payBank", accepts: isChoiceType, re: /банк|^оплата|способ оплат/ },
  { field: "note", key: "note", accepts: (c) => c.type === "text", re: /коммент|примеч|пожелан|заметк|требован/ },
];

/**
 * Какой столбец получит какое поле формы: сначала ключи шаблона студии
 * (стол, созданный по шаблону, сопоставляется точно), потом — по типу и
 * названию среди ещё не занятых; столбец достаётся одному полю. Клиенту,
 * если ничего не подошло, — первый свободный текстовый (как у «Быстрого
 * заказа»). «Дата заказа» — ключ шаблона, иначе первый свободный столбец-дата
 * (дедлайн к этому моменту свой столбец уже забрал). Видимые столбцы впереди,
 * скрытые — запасом (как `mergeColumnPicks`).
 */
export function findStudioOrderColumns(columns: PageColumn[]): StudioOrderTargets {
  const pick = mergeColumnPicks(
    columns.filter((c) => !c.hidden),
    columns
  );
  const taken = new Set<string>();
  const out: StudioOrderTargets = {};
  const claim = (field: StudioOrderField, column: PageColumn | undefined) => {
    if (!column) return;
    out[field] = column;
    taken.add(column.key);
  };
  for (const rule of STUDIO_ORDER_RULES) {
    claim(
      rule.field,
      pick.find((c) => c.key === rule.key && rule.accepts(c))
    );
  }
  for (const rule of STUDIO_ORDER_RULES) {
    if (out[rule.field]) continue;
    const free = pick.filter((c) => !taken.has(c.key) && rule.accepts(c));
    const re = rule.re;
    claim(rule.field, (rule.byType ? free.find(rule.byType) : undefined) ?? (re ? free.find((c) => re.test(normLabel(c.label))) : undefined));
  }
  if (!out.client) claim("client", pick.find((c) => !taken.has(c.key) && c.type === "text"));
  // Дата заказа — по порядку ТАБЛИЦЫ: первый столбец-дату как дату заказа
  // читают и счётчики стола (`countDeskLoad`), и дашборд.
  claim(
    "orderDate",
    columns.find((c) => c.key === "orderDate" && c.type === "date" && !taken.has(c.key)) ??
      columns.find((c) => c.type === "date" && !taken.has(c.key))
  );
  return out;
}

/** Вариант «Новый» списка статусов: значение `new`, иначе по подписи; списка нет — `new`. */
function newStatusValue(options: StatusOption[]): string | null {
  if (options.length === 0) return "new";
  return (options.find((o) => o.value === "new") ?? options.find((o) => /^нов/i.test(o.label.trim())))?.value ?? null;
}

/**
 * Ячейки новой строки из формы «+ Заказ» студии: ключ столбца → значение в
 * формате ячейки (числа — как пишет ячейка, `normalizeNumericInput`; даты —
 * миллисекунды строкой, как пишет календарь ячейки и автодата стола). Поля
 * без столбца пропускаются. «Дата заказа» — сейчас (как автодата стола при
 * первом вводе клиента), статус — «Новый», если есть столбец-статус.
 */
export function studioOrderCells(
  columns: PageColumn[],
  form: StudioOrderForm,
  opts: { now: number; optionsOf: (column: PageColumn) => StatusOption[] }
): Record<string, string> {
  const t = findStudioOrderColumns(columns);
  const cells: Record<string, string> = {};
  const put = (column: PageColumn | undefined, value: string | null | undefined) => {
    const text = (value ?? "").trim();
    if (column && text) cells[column.key] = text;
  };
  put(t.client, form.client);
  put(t.contact, form.contact);
  if (t.workType) put(t.workType, choiceCellValue(t.workType, form.workType, opts.optionsOf));
  put(t.topic, form.topic.replace(/[\r\n]+/g, " "));
  put(t.subject, form.subject);
  const deadline = dateInputMillis(form.deadline);
  if (t.deadline && deadline != null) put(t.deadline, t.deadline.type === "date" ? String(deadline) : formatOrderDate(deadline));
  for (const [column, raw] of [
    [t.amount, form.amount],
    [t.prepaid, form.prepaid],
  ] as const) {
    if (!column || !raw.trim()) continue;
    put(column, STUDIO_NUMERIC_TYPES.has(column.type) ? normalizeNumericInput(raw) : raw);
  }
  if (t.payBank) put(t.payBank, choiceCellValue(t.payBank, form.payBank, opts.optionsOf));
  put(t.note, form.note);
  if (t.status) put(t.status, newStatusValue(opts.optionsOf(t.status)));
  if (t.orderDate) put(t.orderDate, String(opts.now));
  return cells;
}

/**
 * Визитка новой строки из формы студии. Срок у строки один: лёг в столбец
 * срока стола (`studioDeadlineColumn`) — визитке его не пишем (null). У стола
 * такого столбца нет (или форма положила срок в текстовый «Срок» / скрытый
 * столбец) — срок уходит в визитку, иначе он бы потерялся.
 */
export function studioOrderExtras(columns: PageColumn[], form: StudioOrderForm): RowExtras | null {
  const deadline = dateInputMillis(form.deadline);
  if (deadline == null) return null;
  const target = findStudioOrderColumns(columns).deadline;
  if (target && target.key === studioDeadlineColumn(columns)?.key) return null;
  return normalizeRowExtras({ deadline });
}
