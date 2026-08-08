export type FinanceType = "income" | "expense";
export type FinanceCategory = "Еда" | "Транспорт" | "Покупки" | "Дом" | "Здоровье" | "Развлечения" | "Другое";

export const DEFAULT_FINANCE_CATEGORIES: FinanceCategory[] = [
  "Еда", "Транспорт", "Покупки", "Дом", "Здоровье", "Развлечения", "Другое",
];

const CATEGORY_KEYWORDS: Record<FinanceCategory, string[]> = {
  Еда: ["еда", "еду", "продукт", "кафе", "кофе", "обед", "ужин", "завтрак", "ресторан"],
  Транспорт: ["такси", "метро", "автобус", "бензин", "транспорт", "парковк", "проезд"],
  Покупки: ["покупк", "одежд", "обув", "техник", "подарк", "космет"],
  Дом: ["дом", "аренд", "коммунал", "квартир", "ремонт", "мебель", "интернет"],
  Здоровье: ["аптек", "лекарств", "врач", "здоров", "анализ", "стоматолог", "фитнес"],
  Развлечения: ["кино", "театр", "концерт", "игр", "бар", "отдых", "развлеч"],
  Другое: [],
};
const INCOME_WORDS = ["зарплат", "доход", "аванс", "преми", "гонорар", "получил", "получила", "возврат", "бонус"];

export interface ParsedFinanceInput {
  valid: boolean;
  amountMinor: number;
  type: FinanceType;
  category: FinanceCategory;
  description: string;
  categoryGuessed: boolean;
}

function amountMajor(input: string): number {
  const normalized = input.replace(/[\s\u00a0\u202f]/g, "").replace(/,/g, ".");
  const match = normalized.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : Number.NaN;
}

export function parseFinanceInput(raw: string, forcedType: FinanceType = "expense"): ParsedFinanceInput {
  const text = raw.trim().toLowerCase().replace(/ё/g, "е");
  const major = amountMajor(text);
  if (!Number.isFinite(major) || major <= 0) {
    return { valid: false, amountMinor: 0, type: forcedType, category: "Другое", description: raw.trim(), categoryGuessed: true };
  }
  const inferredIncome = forcedType === "income" || INCOME_WORDS.some((word) => text.includes(word));
  let category: FinanceCategory = "Другое";
  let matchedLength = 0;
  for (const candidate of DEFAULT_FINANCE_CATEGORIES) {
    for (const keyword of CATEGORY_KEYWORDS[candidate]) {
      if (text.includes(keyword) && keyword.length > matchedLength) {
        category = candidate;
        matchedLength = keyword.length;
      }
    }
  }
  const description = raw
    .replace(/[-+]?\d[\d\s\u00a0\u202f.,]*/u, "")
    .replace(/[₸$€₽]/g, "")
    .trim();
  return {
    valid: true,
    amountMinor: Math.round(major * 100),
    type: inferredIncome ? "income" : "expense",
    category,
    description,
    categoryGuessed: matchedLength === 0,
  };
}
