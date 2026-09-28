import type { LeadOrder } from "@/services/leadBoardService";

/**
 * Порядок строк «Общей таблицы». Умолчание — «Новые сверху»: последний
 * внесённый заказ первым (время внесения = max(createdAt, filledAt), как у
 * стола — слот, заполненный сегодня, сегодняшний).
 */
export const LEAD_SORTS = [
  "new-top",
  "new-bottom",
  "date-desc",
  "date-asc",
  "sum-desc",
  "sum-asc",
  "upsell-desc",
  "client",
  "os",
  "tech",
  "status",
] as const;
export type LeadSort = (typeof LEAD_SORTS)[number];

export const LEAD_SORT_LABELS: Record<LeadSort, string> = {
  "new-top": "Новые сверху",
  "new-bottom": "Новые снизу",
  "date-desc": "Дата заказа: новые",
  "date-asc": "Дата заказа: старые",
  "sum-desc": "Сумма: больше",
  "sum-asc": "Сумма: меньше",
  "upsell-desc": "Апсейл: больше",
  client: "Клиент А–Я",
  os: "ОС А–Я",
  tech: "Технарь А–Я",
  status: "По статусу",
};

/** Группы в меню «Порядок». */
export const LEAD_SORT_SECTIONS: Array<{ title: string; sorts: LeadSort[] }> = [
  { title: "Время внесения", sorts: ["new-top", "new-bottom"] },
  { title: "Дата и деньги", sorts: ["date-desc", "date-asc", "sum-desc", "sum-asc", "upsell-desc"] },
  { title: "Люди и статус", sorts: ["client", "os", "tech", "status"] },
];

/** Столбец шапки → вид сортировки при первом клике и при повторном. */
export type LeadSortColumn = "client" | "status" | "os" | "tech" | "sum" | "upsell" | "date";
const COLUMN_SORTS: Record<LeadSortColumn, [LeadSort, LeadSort | null]> = {
  client: ["client", null],
  status: ["status", null],
  os: ["os", null],
  tech: ["tech", null],
  sum: ["sum-desc", "sum-asc"],
  upsell: ["upsell-desc", null],
  date: ["new-top", "new-bottom"],
};

/** Клик по заголовку столбца: первый — его вид, повторный — обратное направление. */
export function nextSortForColumn(column: LeadSortColumn, current: LeadSort): LeadSort {
  const [first, second] = COLUMN_SORTS[column];
  if (current === first && second) return second;
  return first;
}

/** Какой столбец подсвечен и в какую сторону стрелка. */
export function sortColumnOf(sort: LeadSort): { column: LeadSortColumn; dir: "asc" | "desc" } {
  switch (sort) {
    case "new-top":
    case "date-desc":
      return { column: "date", dir: "desc" };
    case "new-bottom":
    case "date-asc":
      return { column: "date", dir: "asc" };
    case "sum-desc":
      return { column: "sum", dir: "desc" };
    case "sum-asc":
      return { column: "sum", dir: "asc" };
    case "upsell-desc":
      return { column: "upsell", dir: "desc" };
    default:
      return { column: sort, dir: "asc" };
  }
}

export interface LeadSortContext {
  osLabel: (o: LeadOrder) => string;
  techLabel: (o: LeadOrder) => string;
  /** Место статуса в списке вариантов (для «По статусу»). */
  statusRank: (o: LeadOrder) => number;
}

const collator = new Intl.Collator("ru", { sensitivity: "base", numeric: true });

/** Пустое — всегда в конце, в какую сторону ни сортируй. */
function byNumber(a: number | null, b: number | null, dir: 1 | -1): number {
  const av = a ?? null;
  const bv = b ?? null;
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  return (av - bv) * dir;
}

function byText(a: string, b: string): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return collator.compare(a, b);
}

/** Компаратор строк; равенство решает время внесения (новые выше), затем ключ. */
export function leadComparator(sort: LeadSort, ctx: LeadSortContext): (a: LeadOrder, b: LeadOrder) => number {
  const primary = (a: LeadOrder, b: LeadOrder): number => {
    switch (sort) {
      case "new-top":
        return b.enteredAt - a.enteredAt;
      case "new-bottom":
        return a.enteredAt - b.enteredAt;
      case "date-desc":
        return byNumber(a.dateMs || null, b.dateMs || null, -1);
      case "date-asc":
        return byNumber(a.dateMs || null, b.dateMs || null, 1);
      case "sum-desc":
        return byNumber(a.total, b.total, -1);
      case "sum-asc":
        return byNumber(a.total, b.total, 1);
      case "upsell-desc":
        return byNumber(a.upsell || null, b.upsell || null, -1);
      case "client":
        return byText(a.client.trim(), b.client.trim());
      case "os":
        return byText(ctx.osLabel(a), ctx.osLabel(b));
      case "tech":
        return byText(ctx.techLabel(a), ctx.techLabel(b));
      case "status":
        return ctx.statusRank(a) - ctx.statusRank(b);
    }
  };
  return (a, b) => {
    const r = primary(a, b);
    if (r) return r;
    if (sort !== "new-bottom" && b.enteredAt !== a.enteredAt) return b.enteredAt - a.enteredAt;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  };
}

const MEMORY_KEY = "nova:leads-sort";

export function rememberedLeadSort(): LeadSort {
  try {
    const v = localStorage.getItem(MEMORY_KEY);
    if (v && (LEAD_SORTS as readonly string[]).includes(v)) return v as LeadSort;
  } catch {
    /* нет хранилища — умолчание */
  }
  return "new-top";
}

export function rememberLeadSort(sort: LeadSort): void {
  try {
    if (sort === "new-top") localStorage.removeItem(MEMORY_KEY);
    else localStorage.setItem(MEMORY_KEY, sort);
  } catch {
    /* не страшно */
  }
}
