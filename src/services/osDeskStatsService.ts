import { getDocs, query, where, type CollectionReference } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { fetchSubPages } from "@/services/subPageService";
import { usesSupabaseRows } from "@/services/rows/rowsBackend";
import { sbFetchRowsSince } from "@/services/rows/supabaseRowStore";
import { isBlankRow } from "@/utils/blankRow";
import { almatyMidnightMillis, almatyNoonMillis, ymdPartsInTimeZone } from "@/utils/date";
import { parseLooseNumber } from "@/utils/numberInput";
import type { PageColumn, PageRow, WorkspacePage } from "@/types";

/**
 * Сводка стола ОС за текущий месяц (по Алматы) для «Столов ОС»: сколько
 * заказов записано сегодня и за месяц, сумма цены и апсейла, когда была
 * последняя запись.
 *
 * Читается РАЗОВО и только строки этого месяца (`createdAt >= начало
 * месяца`), а не вся история и не подпиской: на Spark у нас лимит и чтений,
 * и слушателей. Плюс кэш на 15 минут на модуле — переходы туда-обратно по
 * меню не перечитывают столы заново; «Обновить» перечитывает принудительно.
 */
export interface OsDeskMonthStats {
  todayCount: number;
  monthCount: number;
  priceSum: number;
  upsellSum: number;
  /** Последняя запись или правка строки этого месяца. */
  lastActivityAt: number | null;
}

// Было 5 минут, но каждая сводка — это ВСЕ строки месяца каждой вкладки
// стола ОС, и любой заход на «Столы ОС» позже пяти минут читал их заново.
// Цифры тут — итог месяца, а не табло: четверть часа задержки никому не
// мешает, а кому нужно прямо сейчас — есть «Обновить».
const CACHE_TTL_MS = 15 * 60_000;
const cache = new Map<string, { at: number; stats: OsDeskMonthStats }>();

/** 00:00 первого числа текущего месяца по Алматы. */
export function almatyMonthStartMillis(now: number = Date.now()): number {
  const p = ymdPartsInTimeZone(now);
  return almatyNoonMillis(p.year, p.month, 1) - 12 * 60 * 60 * 1000;
}

/**
 * Столбец цены / апсейла. У стола ОС ключи фиксированные (`price`,
 * `upsell` — `OS_DESK_COLUMNS`), но у вкладок, которые ОС завёл сам, ключи
 * свои — тогда по названию.
 */
function moneyColumnKey(columns: PageColumn[], kind: "price" | "upsell"): string | null {
  const byKey = columns.find((c) => c.key === kind);
  if (byKey) return byKey.key;
  const re = kind === "price" ? /^(цена|сумма|стоимость)/i : /апсейл|upsell/i;
  return columns.find((c) => re.test(c.label.trim()))?.key ?? null;
}

function cellNumber(value: unknown): number {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  return parseLooseNumber(String(value)) ?? 0;
}

export async function fetchOsDeskMonthStats(
  workspaceId: string,
  page: WorkspacePage,
  opts: { force?: boolean; now?: number } = {}
): Promise<OsDeskMonthStats> {
  if (!db) throw new Error("Firebase не настроен");
  const now = opts.now ?? Date.now();
  const monthStart = almatyMonthStartMillis(now);
  const todayStart = almatyMidnightMillis(now);
  // День — в ключе: иначе после полуночи «Сегодня» до 15 минут показывало бы вчерашнее.
  const key = `${workspaceId}:${page.id}:${monthStart}:${todayStart}`;
  const hit = cache.get(key);
  if (!opts.force && hit && now - hit.at < CACHE_TTL_MS) return hit.stats;

  // Два запроса: строки, заведённые в этом месяце, и строки-слоты, которые
  // заполнили в этом месяце (слот мог быть заведён раньше — PageRow.filledAt).
  const onSupabase = usesSupabaseRows(workspaceId);
  const monthRows = async (tab: string | null, ref: CollectionReference) => {
    const [created, filled] = onSupabase
      ? await Promise.all([
          sbFetchRowsSince(workspaceId, page.id, tab, "created_at", monthStart),
          sbFetchRowsSince(workspaceId, page.id, tab, "filled_at", monthStart),
        ])
      : await Promise.all([
          getDocs(query(ref, where("createdAt", ">=", monthStart))).then((snap) =>
            snap.docs.map((d) => ({ id: d.id, ...d.data() }) as PageRow)
          ),
          getDocs(query(ref, where("filledAt", ">=", monthStart))).then((snap) =>
            snap.docs.map((d) => ({ id: d.id, ...d.data() }) as PageRow)
          ),
        ]);
    const byId = new Map<string, PageRow>();
    for (const row of [...created, ...filled]) byId.set(row.id, row);
    return [...byId.values()];
  };

  const tables: Array<{ columns: PageColumn[]; rows: PageRow[] }> = [];
  if (!page.hideMainTab) {
    tables.push({ columns: page.columns ?? [], rows: await monthRows(null, paths.rows(workspaceId, page.id)) });
  }
  // Личные вкладки (Personal Space) в общую сводку не идут: это не заказы.
  const subPages = (await fetchSubPages(workspaceId, page.id)).filter((s) => !s.personalOwnerUid);
  const subTables = await Promise.all(
    subPages.map(async (s) => ({
      columns: s.columns ?? [],
      rows: await monthRows(s.id, paths.subPageRows(workspaceId, page.id, s.id)),
    }))
  );
  tables.push(...subTables);

  const stats: OsDeskMonthStats = { todayCount: 0, monthCount: 0, priceSum: 0, upsellSum: 0, lastActivityAt: null };
  for (const table of tables) {
    const priceKey = moneyColumnKey(table.columns, "price");
    const upsellKey = moneyColumnKey(table.columns, "upsell");
    for (const row of table.rows) {
      // Пустая строка — свободный слот, а не заказ (`isBlankRow`, как везде).
      if (isBlankRow(row)) continue;
      // Дата заказа — позднее из «строку завели» и «слот заполнили»: копия
      // строки несёт старый filledAt, но её createdAt новый.
      const orderAt = Math.max(row.createdAt ?? 0, row.filledAt ?? 0);
      if (orderAt < monthStart) continue;
      stats.monthCount += 1;
      if (orderAt >= todayStart) stats.todayCount += 1;
      if (priceKey) stats.priceSum += cellNumber(row.cells?.[priceKey]);
      if (upsellKey) stats.upsellSum += cellNumber(row.cells?.[upsellKey]);
      const touched = Math.max(row.updatedAt ?? 0, row.createdAt ?? 0);
      if (touched && (stats.lastActivityAt == null || touched > stats.lastActivityAt)) stats.lastActivityAt = touched;
    }
  }
  cache.set(key, { at: now, stats });
  return stats;
}
