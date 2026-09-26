import { isOptionColumn } from "@/utils/columnOptions";
import { parseLooseNumber } from "@/utils/numberInput";
import type { PageColumn } from "@/types";
import type { TableClipboardColumn } from "@/utils/tableClipboard";

/**
 * «Умная вставка»: куда лечь данным, скопированным из чужой таблицы (Excel,
 * Google Sheets) или из другого стола. Решаем по двум сигналам — подпись
 * столбца источника (строка заголовков или подписи скопированного столбца) и
 * само содержимое (телефон/дата/деньги/ссылка/имя/авто). Эвристики подписей
 * намеренно такие же, как у `findQuickOrderColumns` в `quickOrder.ts`: два
 * разных набора правил «какой столбец считать номером» разъехались бы за месяц.
 */
export type PasteFieldKind =
  | "phone"
  | "money"
  | "count"
  | "date"
  | "url"
  | "email"
  | "car"
  | "name"
  | "status"
  | "responsible"
  | "text";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^(https?:\/\/|www\.)/i;
const DATE_RE = /^\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{2,4}$|^\d{4}-\d{1,2}-\d{1,2}/;
const MONEY_MARK_RE = /\p{Sc}|(тг|тенге|kzt|руб|rub|usd|eur)/iu;

/** Марки и модели — по ним «Camry 70» отличается от имени клиента. */
const CAR_WORDS =
  /(toyota|lexus|camry|corolla|rav4|land\s?cruiser|prado|highlander|kia|rio|cerato|sportage|optima|sorento|hyundai|sonata|elantra|accent|tucson|santa\s?fe|creta|bmw|mercedes|benz|gelandewagen|gelik|audi|volkswagen|passat|tiguan|touareg|polo|skoda|octavia|nissan|honda|mazda|ford|chevrolet|cobalt|nexia|opel|renault|mitsubishi|subaru|lada|granta|priora|niva|vesta|daewoo|jetour|chery|haval|geely|changan|porsche|infiniti|range\s?rover)/i;

function norm(value: string) {
  return value.trim().toLowerCase().replace(/ё/g, "е");
}

function isPhoneLike(value: string) {
  if (!/^[\d\s+()\-.]+$/.test(value)) return false;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return false;
  // «1 500 000» — это деньги, а не телефон: у номера есть «+», скобки/дефисы
  // или он начинается с 7/8.
  return value.trim().startsWith("+") || /^[78]/.test(digits) || /[()\-]/.test(value);
}

function isCarLike(value: string) {
  if (CAR_WORDS.test(value)) return true;
  // Латиница вперемешку с цифрами — «Camry 70», «X5 30d», госномер «123ABC02».
  return /[a-z]/i.test(value) && /\d/.test(value) && !/[а-я]{4,}/i.test(value) && value.length <= 24;
}

function isPersonName(value: string) {
  if (/\d/.test(value)) return false;
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 3) return false;
  return words.every((w) => /^[а-яa-z][а-яa-zё'’-]*$/i.test(w)) && value.length <= 40;
}

/** Что это за значение само по себе. `null` — пусто, такие не голосуют. */
export function classifyValue(raw: string): PasteFieldKind | null {
  const value = raw.trim();
  if (!value) return null;
  if (EMAIL_RE.test(value)) return "email";
  if (URL_RE.test(value)) return "url";
  // Телефон и дата ДО денег: `parseLooseNumber` схрумкает и «+7 701 000 00 00»,
  // и «12.05.2026» (точки он считает разделителем тысяч).
  if (isPhoneLike(value)) return "phone";
  if (DATE_RE.test(value)) return "date";
  const num = parseLooseNumber(value);
  if (num != null) {
    if (MONEY_MARK_RE.test(value) || Math.abs(num) >= 1000) return "money";
    return "count";
  }
  if (isCarLike(value)) return "car";
  if (isPersonName(value)) return "name";
  return "text";
}

/** Преобладающий вид в столбце вставки. Пустые ячейки не голосуют. */
export function classifyColumn(values: string[]): PasteFieldKind {
  const counts = new Map<PasteFieldKind, number>();
  let total = 0;
  for (const value of values.slice(0, 40)) {
    const kind = classifyValue(value);
    if (!kind) continue;
    total += 1;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  if (total === 0) return "text";
  let best: PasteFieldKind = "text";
  let bestCount = 0;
  for (const [kind, count] of counts) {
    if (count > bestCount) {
      best = kind;
      bestCount = count;
    }
  }
  return bestCount / total >= 0.6 ? best : "text";
}

function labelHas(column: PageColumn, re: RegExp) {
  return re.test(norm(column.label));
}

function isPlainText(column: PageColumn) {
  return column.type === "text";
}

/** Насколько столбец стола подходит под такой вид данных. 0 — не подходит. */
export function scoreTargetColumn(column: PageColumn, kind: PasteFieldKind): number {
  switch (kind) {
    case "phone":
      return column.type === "phone" ? 5 : labelHas(column, /номер|тел|phone|моб|whats|watsap/) ? 4 : 0;
    case "email":
      return column.type === "email" ? 5 : labelHas(column, /почт|mail/) ? 4 : 0;
    case "url":
      return column.type === "url" ? 5 : labelHas(column, /ссылк|сайт|link|url|диск|drive/) ? 4 : 0;
    case "date":
      return column.type === "date" ? 5 : labelHas(column, /дата|дедлайн|сдач|срок|date/) ? 4 : 0;
    case "money":
      return column.type === "currency"
        ? 5
        : labelHas(column, /цена|сумм|чек|оплат|стоим|price/)
          ? 4
          : column.type === "number"
            ? 2.5
            : 0;
    case "count":
      return labelHas(column, /перс|мин|кол-?во|количеств|шт|штук/)
        ? 4.5
        : column.type === "number"
          ? 4
          : column.type === "currency"
            ? 1.5
            : 0;
    case "car":
      return labelHas(column, /авто|машин|модел|марк|тачк|car|гос.?номер/) ? 5 : isPlainText(column) ? 1 : 0;
    case "name":
      return labelHas(column, /клиент|имя|фио|заказчик|назван|name/) ? 5 : isPlainText(column) ? 2 : 0;
    case "status":
      return column.type === "status" ? 5 : 0;
    case "responsible":
      return column.type === "responsible" ? 5 : labelHas(column, /^ос$|менеджер|ответствен|исполнит/) ? 4 : 0;
    case "text":
      return isPlainText(column) ? 1 : 0;
  }
}

/** Под какой вид данных намекает подпись столбца источника. */
export function headerKind(header: string): PasteFieldKind | null {
  const h = norm(header);
  if (!h) return null;
  if (/тел|phone|моб|whats|watsap|^номер$|номер клиент/.test(h)) return "phone";
  if (/почт|mail/.test(h)) return "email";
  if (/ссылк|сайт|link|url|диск|drive/.test(h)) return "url";
  if (/дата|дедлайн|сдач|срок|date/.test(h)) return "date";
  if (/цена|сумм|чек|оплат|стоим|price/.test(h)) return "money";
  if (/перс|^мин|кол-?во|количеств|шт/.test(h)) return "count";
  if (/авто|машин|модел|марк|тачк|car|гос.?номер/.test(h)) return "car";
  if (/клиент|имя|фио|заказчик|назван|name/.test(h)) return "name";
  if (/статус|status|состоян/.test(h)) return "status";
  if (/^ос$|менеджер|ответствен|исполнит/.test(h)) return "responsible";
  return null;
}

/** Совпадение подписи источника с подписью столбца стола. */
export function scoreHeaderAgainstColumn(header: string, column: PageColumn): number {
  const h = norm(header);
  const l = norm(column.label);
  if (!h || !l) return 0;
  if (h === l) return 10;
  // Вхождение — только для длинных подписей: «ОС» иначе влезет в «Осень».
  if (h.length >= 4 && l.length >= 4 && (l.includes(h) || h.includes(l))) return 7;
  const kind = headerKind(h);
  if (!kind) return 0;
  const byKind = scoreTargetColumn(column, kind);
  // Подпись — сигнал сильный, но слабее точного совпадения имён.
  return byKind > 0 ? byKind * 0.9 : 0;
}

/** Доля значений, совпавших с вариантами столбца-справочника. */
function optionMatchRatio(column: PageColumn, values: string[]): number {
  const options = column.statusOptions ?? [];
  if (options.length === 0) return 0;
  const labels = new Set(options.map((o) => norm(o.label)));
  let total = 0;
  let hit = 0;
  for (const value of values.slice(0, 40)) {
    const v = norm(value);
    if (!v) continue;
    total += 1;
    if (labels.has(v)) hit += 1;
  }
  return total === 0 ? 0 : hit / total;
}

export interface PasteMappingInput {
  matrix: string[][];
  /** Столбцы стола-приёмника в том же порядке, что на экране. */
  columns: PageColumn[];
  /** Подписи столбцов источника, если копировали внутри CRM. */
  sourceColumns?: TableClipboardColumn[] | null;
}

export interface PasteMappingResult {
  /** Первая строка матрицы — заголовки, её не вставляем. */
  hasHeader: boolean;
  /** По одному на столбец вставки: ключ столбца стола или null («пропустить»). */
  mapping: (string | null)[];
  /** Чем сматчили: подписью источника или содержимым. */
  reasons: Array<"header" | "content" | null>;
  /** Подписи источника (строка заголовков или подписи скопированных столбцов). */
  headers: string[] | null;
  /** Сколько столбцов вставки нашли себе место. */
  matched: number;
  /** Самая слабая уверенность среди сматченных — по ней решаем, спрашивать ли. */
  minScore: number;
}

/**
 * Похожа ли первая строка на заголовки. Значение-телефон/дата/деньги сразу
 * снимает вопрос: это данные, и терять их нельзя.
 */
function detectHeader(matrix: string[][], columns: PageColumn[]): boolean {
  if (matrix.length < 2) return false;
  const cells = matrix[0].filter((c) => c.trim());
  if (cells.length === 0) return false;
  for (const cell of cells) {
    const kind = classifyValue(cell);
    if (kind === "phone" || kind === "money" || kind === "date" || kind === "url" || kind === "email") return false;
  }
  let matched = 0;
  for (const cell of cells) {
    const best = Math.max(0, ...columns.map((col) => scoreHeaderAgainstColumn(cell, col)));
    if (best >= 4) matched += 1;
  }
  return matched >= Math.max(1, Math.ceil(cells.length / 2));
}

export function guessPasteMapping({ matrix, columns, sourceColumns }: PasteMappingInput): PasteMappingResult {
  const width = Math.max(1, ...matrix.map((line) => line.length));
  const empty: PasteMappingResult = {
    hasHeader: false,
    mapping: Array.from({ length: width }, () => null),
    reasons: Array.from({ length: width }, () => null),
    headers: null,
    matched: 0,
    minScore: 0,
  };
  if (columns.length === 0) return empty;

  // Копия из CRM приносит подписи с собой — строки заголовков в ней нет.
  const hasHeader = sourceColumns ? false : detectHeader(matrix, columns);
  const body = hasHeader ? matrix.slice(1) : matrix;
  const headers = sourceColumns ? sourceColumns.map((c) => c.label) : hasHeader ? matrix[0] : null;

  const columnValues: string[][] = Array.from({ length: width }, (_, i) => body.map((line) => line[i] ?? ""));
  const kinds = columnValues.map((values) => classifyColumn(values));

  type Pair = { paste: number; target: number; score: number; reason: "header" | "content" };
  const pairs: Pair[] = [];
  for (let i = 0; i < width; i++) {
    for (let j = 0; j < columns.length; j++) {
      const column = columns[j];
      const byHeader = headers?.[i] ? scoreHeaderAgainstColumn(headers[i], column) : 0;
      let byContent = scoreTargetColumn(column, kinds[i]);
      // Столбец-справочник: значения совпали с его вариантами — это он и есть.
      // Сигнал сильнее любого «по типу»: «В работе» — это и имя из двух слов,
      // и статус, но статусом оно названо в самом столбце.
      if (isOptionColumn(column.type) && optionMatchRatio(column, columnValues[i]) >= 0.6) {
        byContent = Math.max(byContent, 6);
      }
      // Тип у источника и приёмника совпал — небольшая добавка, чтобы «Дата
      // заказа» не уехала в «Дата сдачи» только из-за порядка столбцов.
      const sameType = sourceColumns?.[i] && sourceColumns[i].type === column.type ? 0.5 : 0;
      const score = Math.max(byHeader, byContent) + sameType;
      if (score <= 0) continue;
      pairs.push({ paste: i, target: j, score, reason: byHeader >= byContent ? "header" : "content" });
    }
  }
  // Сильные пары первыми; при равенстве — та, что ближе по порядку столбцов.
  pairs.sort((a, b) => b.score - a.score || Math.abs(a.paste - a.target) - Math.abs(b.paste - b.target));

  const mapping: (string | null)[] = Array.from({ length: width }, () => null);
  const reasons: Array<"header" | "content" | null> = Array.from({ length: width }, () => null);
  const usedPaste = new Set<number>();
  const usedTarget = new Set<number>();
  let matched = 0;
  let minScore = Infinity;
  for (const pair of pairs) {
    if (usedPaste.has(pair.paste) || usedTarget.has(pair.target)) continue;
    if (pair.score < 2) continue;
    usedPaste.add(pair.paste);
    usedTarget.add(pair.target);
    mapping[pair.paste] = columns[pair.target].key;
    reasons[pair.paste] = pair.reason;
    matched += 1;
    minScore = Math.min(minScore, pair.score);
  }

  return { hasHeader, mapping, reasons, headers, matched, minScore: matched === 0 ? 0 : minScore };
}
