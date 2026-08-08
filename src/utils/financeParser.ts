// PATH: src/utils/financeParser.ts  (NEW FILE)
import { parseAmount, toMinor } from "@/utils/money";

/**
 * Local, deterministic parser for the quick-entry field ("2000 еда").
 * No AI, no API, no network — pure string matching, so it works offline and
 * costs nothing.
 */

export type FinanceCategory =
  | "food"
  | "transport"
  | "home"
  | "shopping"
  | "health"
  | "fun"
  | "subscriptions"
  | "work"
  | "other";

export const CATEGORY_LABELS: Record<FinanceCategory, string> = {
  food: "Еда",
  transport: "Транспорт",
  home: "Дом",
  shopping: "Покупки",
  health: "Здоровье",
  fun: "Развлечения",
  subscriptions: "Подписки",
  work: "Работа",
  other: "Другое",
};

/**
 * Keyword table. Matching is prefix-based on the STEM so Russian inflections
 * work without a morphology library: "такси", "на такси", "такси домой" all
 * hit `такси`; "продукты"/"продуктов" both hit `продукт`.
 */
const CATEGORY_KEYWORDS: Record<FinanceCategory, string[]> = {
  food: ["еда", "еду", "продукт", "кафе", "ресторан", "обед", "ужин", "завтрак", "кофе", "чай", "магазин", "перекус", "доставк", "пицц", "суши", "бургер", "столов"],
  transport: ["такси", "метро", "автобус", "бензин", "заправк", "проезд", "транспорт", "парковк", "каршеринг", "поезд", "самол", "билет", "яндекс", "индрайв", "убер"],
  home: ["дом", "аренд", "квартир", "квартплат", "коммунал", "свет", "газ", "вод", "интернет", "ремонт", "мебель", "уборк"],
  shopping: ["покупк", "одежд", "обув", "техник", "телефон", "ноутбук", "подарок", "подарк", "космет", "маркетплейс", "вайлдберриз", "озон"],
  health: ["здоров", "аптек", "лекарств", "врач", "больниц", "стоматолог", "анализ", "зубн", "витамин", "спортзал", "фитнес"],
  fun: ["развлеч", "кино", "театр", "концерт", "игр", "бар", "клуб", "отдых", "путешеств", "боулинг"],
  subscriptions: ["подписк", "netflix", "spotify", "youtube", "яндекс плюс", "облак", "хостинг", "домен", "apple", "google one", "chatgpt"],
  work: ["работ", "зарплат", "аванс", "преми", "гонорар", "клиент", "заказ", "фриланс", "оплат", "проект", "доход", "выплат", "перевод", "продаж"],
  other: [],
};

/** Words that force the operation to be treated as INCOME. */
const INCOME_KEYWORDS = [
  "зарплат", "аванс", "преми", "гонорар", "доход", "получил", "получила", "пришло",
  "выплат", "возврат", "кэшбэк", "кешбэк", "бонус", "продал", "продала", "перевод",
];

export interface ParsedFinanceEntry {
  /** Integer minor units. */
  amountMinor: number;
  category: FinanceCategory;
  type: "income" | "expense";
  /** Leftover text after removing the amount — shown as the note. */
  description: string;
  /** True when no keyword matched and we fell back to "other". */
  categoryGuessed: boolean;
  /** False when the input contained no usable number at all. */
  isValid: boolean;
}

function normalize(input: string): string {
  return input.toLowerCase().replace(/ё/g, "е").trim();
}

function detectCategory(text: string): { category: FinanceCategory; matched: boolean } {
  // Longest keyword wins, so "яндекс плюс" (subscriptions) beats "яндекс"
  // (transport) rather than depending on object key order.
  let best: { category: FinanceCategory; length: number } | null = null;

  (Object.keys(CATEGORY_KEYWORDS) as FinanceCategory[]).forEach((category) => {
    CATEGORY_KEYWORDS[category].forEach((keyword) => {
      if (text.includes(keyword) && (!best || keyword.length > best.length)) {
        best = { category, length: keyword.length };
      }
    });
  });

  if (!best) return { category: "other", matched: false };
  return { category: (best as { category: FinanceCategory }).category, matched: true };
}

/**
 * "2000 еда"        -> 2000, food, expense
 * "500 кофе"        -> 500,  food, expense
 * "1500 такси"      -> 1500, transport, expense
 * "50000 зарплата"  -> 50000, work, income
 * "2000"            -> 2000, other, expense (categoryGuessed = true)
 */
export function parseFinanceInput(
  raw: string,
  forcedType?: "income" | "expense"
): ParsedFinanceEntry {
  const text = normalize(raw);
  const major = parseAmount(text);

  if (!Number.isFinite(major)) {
    return {
      amountMinor: 0,
      category: "other",
      type: forcedType ?? "expense",
      description: raw.trim(),
      categoryGuessed: true,
      isValid: false,
    };
  }

  const isIncome =
    forcedType === "income" ||
    (forcedType === undefined && INCOME_KEYWORDS.some((k) => text.includes(k)));

  const { category, matched } = detectCategory(text);

  // Strip the first number (and any currency sign) to leave a human note.
  const description = raw
    .replace(/-?[\d\s\u00a0\u202f.,]*\d/, "")
    .replace(/[₸$€₽]/g, "")
    .trim();

  return {
    amountMinor: toMinor(Math.abs(major)),
    category: isIncome && !matched ? "work" : category,
    type: isIncome ? "income" : "expense",
    description,
    categoryGuessed: !matched,
    isValid: true,
  };
}
