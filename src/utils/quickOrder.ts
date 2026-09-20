import { parseLooseNumber } from "@/utils/numberInput";
import { normalizeRowExtras } from "@/utils/rowExtras";
import type { PageColumn, PageRow } from "@/types";

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

  const extras = normalizeRowExtras({ persons, minutes, note: input.note, link });

  return {
    cells,
    extras: extras ?? undefined,
    nameKey: cols.client?.key ?? null,
  };
}
