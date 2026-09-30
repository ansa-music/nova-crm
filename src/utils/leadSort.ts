import { leadDeadlineOf, type LeadOrder } from "@/services/leadBoardService";

/**
 * Порядок строк «Общей таблицы». Умолчание — «Новые снизу»: по времени
 * внесения В ТАБЛИЦУ, сверху вниз, как журнал в Excel (просьба Nurba
 * 30.09.2026; до того было «Новые сверху»). Время внесения = max(createdAt,
 * filledAt), как у стола: слот, заполненный сегодня, — сегодняшний; дата,
 * которую вписали в строку, тут ни при чём.
 */
export const LEAD_SORTS = [
  "new-top",
  "new-bottom",
  "date-desc",
  "date-asc",
  "sum-desc",
  "sum-asc",
  "upsell-desc",
  "deadline-asc",
  "client",
  "os",
  "tech",
  "status",
] as const;
export type LeadSort = (typeof LEAD_SORTS)[number];

export const DEFAULT_LEAD_SORT: LeadSort = "new-bottom";

/**
 * Умолчание на телефоне — «Новые сверху»: там не таблица, а лента карточек,
 * и до вчерашних заказов иначе пришлось бы листать все заказы периода.
 */
export function defaultLeadSort(mobile: boolean): LeadSort {
  return mobile ? "new-top" : DEFAULT_LEAD_SORT;
}

export const LEAD_SORT_LABELS: Record<LeadSort, string> = {
  "new-top": "Новые сверху",
  "new-bottom": "Новые снизу",
  "date-desc": "Дата заказа: новые",
  "date-asc": "Дата заказа: старые",
  "sum-desc": "Сумма: больше",
  "sum-asc": "Сумма: меньше",
  "upsell-desc": "Апсейл: больше",
  "deadline-asc": "Срок сдачи: ближе",
  client: "Клиент А–Я",
  os: "ОС А–Я",
  tech: "Технарь А–Я",
  status: "По статусу",
};

/** Группы в меню «Порядок». */
export const LEAD_SORT_SECTIONS: Array<{ title: string; sorts: LeadSort[] }> = [
  { title: "Время внесения в таблицу", sorts: ["new-bottom", "new-top"] },
  { title: "Дата и деньги", sorts: ["date-desc", "date-asc", "deadline-asc", "sum-desc", "sum-asc", "upsell-desc"] },
  { title: "Люди и статус", sorts: ["client", "os", "tech", "status"] },
];

/** Столбец шапки → вид сортировки при первом клике и при повторном. */
export type LeadSortColumn = "client" | "status" | "os" | "tech" | "sum" | "upsell" | "date" | "deadline";
const COLUMN_SORTS: Record<LeadSortColumn, [LeadSort, LeadSort | null]> = {
  client: ["client", null],
  status: ["status", null],
  os: ["os", null],
  tech: ["tech", null],
  sum: ["sum-desc", "sum-asc"],
  upsell: ["upsell-desc", null],
  date: ["new-bottom", "new-top"],
  deadline: ["deadline-asc", null],
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
    case "deadline-asc":
      return { column: "deadline", dir: "asc" };
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

/**
 * Компаратор строк; равенство решает время внесения — в ту же сторону, что
 * читается таблица (сверху вниз, новые ниже; у «Новые сверху» и «Дата заказа:
 * новые» — новые выше), затем ключ.
 */
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
      case "deadline-asc":
        return byNumber(leadDeadlineOf(a), leadDeadlineOf(b), 1);
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
    if (b.enteredAt !== a.enteredAt) return sort === "new-top" || sort === "date-desc" ? b.enteredAt - a.enteredAt : a.enteredAt - b.enteredAt;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  };
}

/**
 * Выбор в меню «Порядок» — на человека (localStorage). Ключ новый: прежняя
 * память (`nova:leads-sort`) держала и случайный клик по заголовку, и у
 * кого-то умолчание навсегда стало «по сумме». Клик по заголовку — только в
 * адресе и в память не идёт.
 */
const MEMORY_KEY = "nova:leads-sort:v2";

export function rememberedLeadSort(mobile = false): LeadSort {
  try {
    const v = localStorage.getItem(MEMORY_KEY);
    if (v && (LEAD_SORTS as readonly string[]).includes(v)) return v as LeadSort;
  } catch {
    /* нет хранилища — умолчание */
  }
  return defaultLeadSort(mobile);
}

export function rememberLeadSort(sort: LeadSort, mobile = false): void {
  try {
    if (sort === defaultLeadSort(mobile)) localStorage.removeItem(MEMORY_KEY);
    else localStorage.setItem(MEMORY_KEY, sort);
  } catch {
    /* не страшно */
  }
}

/**
 * Группы по статусу: по умолчанию выключены — таблица одним списком по
 * времени внесения, как отчёт в Excel. Включил — запоминается на человека.
 */
const GROUP_MEMORY_KEY = "nova:leads-group";

export function rememberedLeadGrouping(): boolean {
  try {
    return localStorage.getItem(GROUP_MEMORY_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberLeadGrouping(on: boolean): void {
  try {
    if (on) localStorage.setItem(GROUP_MEMORY_KEY, "1");
    else localStorage.removeItem(GROUP_MEMORY_KEY);
  } catch {
    /* не страшно */
  }
}
