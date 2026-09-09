import { parseLooseNumber } from "@/utils/numberInput";
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

/**
 * The amount is embedded in free text ("2000 \u0442\u0430\u043a\u0441\u0438"), so pull the numeric
 * run out first and hand THAT to the shared parser \u2014 the old inline version
 * ("," -> "." then take the first \d+(\.\d+)? match) read "2.000 \u0435\u0434\u0430" as 2,
 * making the entry, the \u00ab\u0420\u0430\u0441\u0445\u043e\u0434\u00bb/\u00ab\u0411\u0430\u043b\u0430\u043d\u0441 \u0437\u0430 \u043c\u0435\u0441\u044f\u0446\u00bb totals and \u00ab\u0412\u0441\u0435\u0433\u043e \u0443 \u0432\u0430\u0441
 * \u0435\u0441\u0442\u044c\u00bb all short by 1998 \u20b8 with nothing to notice. "2 000 \u0435\u0434\u0430" worked, so
 * the bug only appeared once someone typed a dot.
 */
function amountMajor(input: string): number {
  const match = input.match(/-?[\d\s\u00a0\u202f.,]*\d/);
  if (!match) return Number.NaN;
  const value = parseLooseNumber(match[0]);
  return value === null ? Number.NaN : value;
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
