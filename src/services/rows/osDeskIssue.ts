import { addRow, fetchRows, updateRowCellsBulk, updatePageMainTab } from "@/services/pageService";
import { addSubPageRow, fetchSubPageFresh, fetchSubPageRows, monthTabNameForKey, updateSubPageRowCellsBulk } from "@/services/subPageService";
import { currentMonthKey, ensureMonthTab } from "@/services/monthTabService";
import { ensureOsDesk, findOsDeskOf, resolveOsDeskKeys, type OsDeskKeys } from "@/services/osDeskService";
import { isBlankRow } from "@/utils/blankRow";
import { approvalStatusValue, isApprovalStatusValue, isDoneStatusLabel } from "@/utils/columnOptions";
import { normalizeNumericInput } from "@/utils/numberInput";
import { mirrorAddressOf } from "@/utils/osDispatchPlan";
import { cellMillis, osReceivedAt } from "@/utils/osDates";
import { OS_RECEIVED_ON_KEY } from "@/utils/reservedCellKeys";
import type { PageColumn, PageRow, StatusOption, WorkOrder, WorkspacePage } from "@/types";

type RowExtras = NonNullable<PageRow["extras"]>;

/**
 * «Заказы» у ОС — ТОЛЬКО со своего стола (просьба Nurba 24.09.2026: «ОС
 * выдаёт только те заказы, что есть у него на столе; кнопка — добавить,
 * которого нет, и тогда он попадёт и на стол ОС»).
 *
 * Стол ОС — источник заказа (см. «Стол ОС — источник заказов» в CLAUDE.md):
 * заказ, выставленный мимо стола, не знает строки-источника, и его ни касса
 * ОС, ни «ABS», ни «Выдачи ОС» не видят. Поэтому «Выдать заказ» у ОС —
 * выбор строки своего стола, а «новый заказ» сначала ложится строкой на
 * стол и уже оттуда уходит на «Заказы» — тем же `sendOsRowToExchange`,
 * что и кнопка в самой таблице.
 */

/** Открытая «сейчас» вкладка стола ОС — вкладка текущего месяца (или «Основная»). */
export interface OsDeskTab {
  workspaceId: string;
  page: WorkspacePage;
  /** null — «Основная». */
  tabId: string | null;
  columns: PageColumn[];
  keys: OsDeskKeys;
  /** Строки вкладки в ручном порядке (`rowOrder: "manual"`), а не по дате. */
  manualOrder: boolean;
}

/**
 * Вкладка текущего месяца стола ОС, как её откроет сам стол
 * (`ensureOsDeskMonth`): первый раз «Основная» просто называется месяцем, в
 * новом месяце заводится вкладка. Стола нет — заводится (как при первом
 * заходе на «Стол ОС»).
 */
export async function openOsDeskCurrentTab(input: {
  workspaceId: string;
  uid: string;
  /** Имя для нового стола — ник ОС или имя. */
  name: string;
  osDesks: readonly WorkspacePage[];
  /** Стола нет — завести (новый заказ) или вернуть null (просто посмотреть список). */
  createIfMissing: boolean;
}): Promise<OsDeskTab | null> {
  const existing = findOsDeskOf([...input.osDesks], input.uid);
  if (!existing && !input.createIfMissing) return null;
  const page = existing ?? (await ensureOsDesk({ workspaceId: input.workspaceId, uid: input.uid, name: input.name }));
  const monthKey = currentMonthKey();
  let tabId: string | null = null;
  if (!page.mainTabMonthKey) {
    await updatePageMainTab(page.workspaceId, page.id, { name: monthTabNameForKey(monthKey), monthKey });
  } else if (page.mainTabMonthKey !== monthKey) {
    tabId = page.autoMonthKey === monthKey && page.autoMonthSubPageId ? page.autoMonthSubPageId : await ensureMonthTab(page, monthKey, input.uid);
  }
  let columns = page.columns ?? [];
  let manualOrder = page.rowOrder === "manual";
  if (tabId) {
    const tab = await fetchSubPageFresh(page.workspaceId, page.id, tabId);
    if (tab?.columns?.length) columns = tab.columns;
    manualOrder = tab?.rowOrder === "manual";
  }
  return { workspaceId: page.workspaceId, page, tabId, columns, keys: resolveOsDeskKeys(columns), manualOrder };
}

export function fetchOsDeskTabRows(tab: OsDeskTab): Promise<PageRow[]> {
  return tab.tabId ? fetchSubPageRows(tab.workspaceId, tab.page.id, tab.tabId) : fetchRows(tab.workspaceId, tab.page.id);
}

function cellText(row: PageRow, key: string): string {
  const v = row.cells[key];
  return v === null || v === undefined ? "" : String(v).trim();
}

export type OsDeskRowState =
  /** Можно выдать: на утверждении, имя есть, технаря и копии нет, на «Заказах» не висит. */
  | "issuable"
  /** Без технаря, но уже не на утверждении («В работе», «Ждём оплату»…) — в список выдачи не идёт. */
  | "other"
  /** Уже у технаря (ник или копия). */
  | "issued"
  /** Висит на «Заказах» (открыт или отдан, едет). */
  | "exchange"
  /** Закрыт («Готово»/«Успешка») — выдавать нечего. */
  | "done"
  /** Не заказ: пустой слот или без имени клиента. */
  | "none";

/**
 * Что можно сделать со строкой стола ОС на «Заказах».
 *
 * Выдать можно заказ НА УТВЕРЖДЕНИИ (пустой статус — тоже он) без технаря —
 * правило Nurba 24.09.2026 («если на утверждении и нет технаря — можно ещё
 * раз выдать»; жалоба: «в „Заказах“ показываются все заказы со стола без
 * технарей»). Остальные строки без технаря («В работе», «Ждём оплату»,
 * старые) в список не идут — это `other`.
 *
 * `liveOrderIds` — id заказов, открытых или отданных СЕЙЧАС: строка с
 * `orderId`, которого среди них нет, — заказ сняли (отменили, удалили), и её
 * можно выставить снова. `null` — список ещё читается: строка с заказом
 * считается висящей на бирже (иначе её выставили бы второй раз). Взятый
 * («В столах») заказ пишет ник технаря в строку раньше, чем станет взятым
 * (handOffExchangeOrder), так что он узнаётся как «issued».
 */
export function osDeskRowState(
  row: PageRow,
  keys: OsDeskKeys,
  liveOrderIds: ReadonlySet<string> | null,
  statusOptions: readonly StatusOption[]
): OsDeskRowState {
  if (isBlankRow(row) || !cellText(row, keys.client)) return "none";
  if (cellText(row, keys.technician) || mirrorAddressOf(row, null)) return "issued";
  if (row.orderId && (liveOrderIds === null || liveOrderIds.has(row.orderId))) return "exchange";
  const status = cellText(row, keys.status);
  const label = statusOptions.find((o) => o.value === status)?.label ?? status;
  if (status && isDoneStatusLabel(label)) return "done";
  return isApprovalStatusValue(status, statusOptions) ? "issuable" : "other";
}

/** Когда получен: дата, поставленная ОС, иначе дата строки. */
function receivedSortKey(row: PageRow): number {
  return cellMillis(row.cells[OS_RECEIVED_ON_KEY]) ?? osReceivedAt(row) ?? 0;
}

/** Новые сверху: ОС ищет то, что только что продал. */
export function sortByReceivedDesc(rows: PageRow[]): PageRow[] {
  return [...rows].sort((a, b) => receivedSortKey(b) - receivedSortKey(a));
}

export interface NewOsOrderInput {
  client: string;
  phone: string;
  price: string;
  link: string;
  note: string;
  persons: number | null;
  minutes: number | null;
  deadline: number | null;
}

function rowCreatedMs(row: PageRow): number {
  return typeof row.createdAt === "number" ? row.createdAt : 0;
}

/**
 * Новый заказ — строкой на стол ОС: в первый пустой слот (как «Добавить
 * строку» и «Быстрый заказ»), нет слотов — новой строкой внизу. Статус —
 * «Утверждение» (в «В работе» его переводит выставление на биржу).
 * Возвращает строку, как она записана, — её и отдают `sendOsRowToExchange`.
 */
export async function addOsDeskOrderRow(input: {
  tab: OsDeskTab;
  rows: readonly PageRow[];
  order: NewOsOrderInput;
  statusOptions: readonly StatusOption[];
}): Promise<PageRow> {
  const { tab, order } = input;
  const k = tab.keys;
  const has = (key: string) => tab.columns.some((c) => c.key === key);
  const cells: Record<string, string | number | null> = {};
  cells[k.client] = order.client.trim();
  if (order.phone.trim() && has(k.phone)) cells[k.phone] = order.phone.trim();
  const price = order.price.trim() ? normalizeNumericInput(order.price) : "";
  if (price && has(k.price)) cells[k.price] = price;
  if (order.link.trim() && has(k.link)) cells[k.link] = order.link.trim();
  // «Утверждение»: `sendOsRowToExchange` сам переведёт в «В работе», когда
  // заказ ляжет на биржу. Не лёг (сеть, отказ) — строка остаётся «на
  // утверждении» и выдаётся со стола или из того же окна, как обычно.
  if (has(k.status)) cells[k.status] = approvalStatusValue([...input.statusOptions]);
  const extras: RowExtras = {};
  if (order.persons) extras.persons = order.persons;
  if (order.minutes) extras.minutes = order.minutes;
  if (order.note.trim()) extras.note = order.note.trim();
  if (order.deadline) extras.deadline = order.deadline;
  const hasExtras = Object.keys(extras).length > 0;

  const manual = tab.manualOrder;
  const blanks = input.rows.filter((r) => isBlankRow(r));
  blanks.sort((a, b) => (manual ? (a.order ?? 0) - (b.order ?? 0) : 0) || rowCreatedMs(a) - rowCreatedMs(b) || a.id.localeCompare(b.id));
  const slot = blanks[0];
  const now = Date.now();
  if (slot) {
    if (tab.tabId) await updateSubPageRowCellsBulk(tab.workspaceId, tab.page.id, tab.tabId, slot.id, cells, hasExtras ? extras : undefined, undefined, now);
    else await updateRowCellsBulk(tab.workspaceId, tab.page.id, slot.id, cells, hasExtras ? extras : undefined, undefined, now);
    return { ...slot, cells: { ...slot.cells, ...cells }, extras: hasExtras ? extras : slot.extras, filledAt: now, updatedAt: now };
  }
  const order_ = input.rows.reduce((max, r) => Math.max(max, typeof r.order === "number" ? r.order : 0), 0) + 1;
  return tab.tabId
    ? addSubPageRow(tab.workspaceId, tab.page.id, tab.tabId, cells, order_, hasExtras ? extras : undefined)
    : addRow(tab.workspaceId, tab.page.id, cells, order_, hasExtras ? extras : undefined);
}

/** Для тоста: «Айгерим — на «Заказах»». */
export function orderTitle(order: Pick<WorkOrder, "client">): string {
  return order.client?.trim() || "Заказ";
}
