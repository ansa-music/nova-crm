import { supabaseRows } from "@/lib/supabaseRows";
import {
  compareCodePoints,
  md5Hex,
  recordToRow,
  RowsStoreError,
  sbPatchRow,
  type DeskRowRecord,
} from "@/services/rows/supabaseRowStore";
import { ringRowsDoorbell } from "@/services/rows/rowsDoorbell";
import { ringTopic } from "@/services/sb/topicDoorbell";
import { addOsDeskOrderRow, fetchOsDeskTabRows, openOsDeskCurrentTab, type NewOsOrderInput } from "@/services/rows/osDeskIssue";
import { findOsDeskOf, resolveOsDeskKeys, type OsDeskKeys } from "@/services/osDeskService";
import { sendNotification } from "@/services/notificationService";
import { computeOsFieldKeys } from "@/utils/osFieldKeys";
import { isBlankRow } from "@/utils/blankRow";
import { rowEnteredAtMs } from "@/utils/rowEntryOrder";
import { almatyDay, cellMillis } from "@/utils/osDates";
import { feeKeyOf, osRowTotal, payKeyOf, paymentPatch } from "@/utils/payment";
import { normalizeNumericInput, parseLooseNumber } from "@/utils/numberInput";
import { deskRowHref } from "@/utils/deskLinks";
import { isApprovalStatusValue, isDoneStatusLabel } from "@/utils/columnOptions";
import { techLoadKindForOption } from "@/utils/techLoad";
import { LEAD_AT_KEY, LEAD_BY_KEY, OS_RECEIVED_ON_KEY } from "@/utils/reservedCellKeys";
import type { PageRow, PaymentMethod, StatusOption, TechLoadKind, WorkspaceMember, WorkspacePage } from "@/types";

/**
 * «Общая таблица» (просьба Nurba 27.09.2026): все заказы периода по всем ОС —
 * выданные и нет — одной таблицей у Тимлида+ и Owner. Данные — те же строки
 * `desk_rows`: строки-источники на столах ОС и их копии у технарей, плюс
 * строки технарей без ОС. Читается одним RPC `lead_board` (SECURITY INVOKER:
 * строки отдаёт политика чтения, Owner и Тимлид+ читают всё), дельтой по rev
 * и головой, как стол (`sbSubscribeRows`). Правка — обычный `rows_patch` в
 * настоящую таблицу строки (звонок стола тоже уходит, у ОС правка видна
 * сразу), смена ОС — `lead_move_os`, история — `order_events`.
 */

export interface LeadTable {
  page: string;
  /** '' — «Основная». */
  tab: string;
  kind: "os" | "tech";
}

/** Ключи ячеек строки — у стола ОС и у стола технаря они свои. */
export interface LeadKeys {
  client: string;
  phone: string;
  price: string;
  /** У стола технаря апсейла нет — пустая строка. */
  upsell: string;
  status: string;
  technician: string;
  link: string;
  note: string;
  /** «Итого» стола ОС; у технаря — пустая строка. */
  total: string;
}

export interface LeadOrder {
  /** `page/tab/id` главной строки — ключ в списке. */
  key: string;
  /** Ключ истории (`order_events.order_key`): id строки-источника. */
  orderKey: string;
  /** Главная строка: источник на столе ОС, а у заказа без ОС — строка технаря. */
  row: PageRow;
  pageId: string;
  tabId: string;
  kind: "os" | "tech";
  keys: LeadKeys;
  /** ОС заказа: хозяин стола ОС, у строки технаря — её метка `osUid`. */
  osUid: string | null;
  /** Копия у технаря (заказ выдан). */
  copy: PageRow | null;
  /** Технарь: хозяин стола копии (или стола строки без ОС). */
  techUid: string | null;
  /** Ник технаря, вписанный в строку ОС (выдача ещё едет или копии нет). */
  techNick: string;
  client: string;
  phone: string;
  price: number | null;
  upsell: number | null;
  /** Касса строки: у ОС — «Итого» (после комиссии), у технаря — цена. */
  total: number | null;
  status: string;
  /** Статус у технаря (копии). */
  techStatus: string | null;
  enteredAt: number;
  /** Дата заказа: поставленная ОС «получен», иначе время внесения. */
  dateMs: number;
}

export interface LeadBoardHead {
  count: number;
  rev: number;
  ids: string;
}

export interface LeadBoardFetch extends LeadBoardHead {
  rows: DeskRowRecord[];
}

// ---------------------------------------------------------------------------
// Какие таблицы читать за период
// ---------------------------------------------------------------------------

/** Вкладка периода у стола ОС: «Основная», вкладка автопилота или `month-{ключ}`. */
function osTabFor(page: WorkspacePage, key: string): string {
  if (page.mainTabMonthKey === key) return "";
  if (page.autoMonthKey === key && page.autoMonthSubPageId) return page.autoMonthSubPageId;
  // До первого переименования «Основная» и есть текущий период.
  if (!page.mainTabMonthKey && !page.autoMonthKey) return "";
  return `month-${key}`;
}

function techTabFor(page: WorkspacePage, key: string): string {
  if (page.autoMonthKey === key && page.autoMonthSubPageId) return page.autoMonthSubPageId;
  return `month-${key}`;
}

/** Все столы ОС и все живые столы технарей с месячными вкладками. */
export function leadTablesFor(
  key: string,
  osDesks: readonly WorkspacePage[],
  pages: readonly WorkspacePage[],
  /** Смотрит Owner: столы «только для Owner» открыты только ему. */
  viewerIsOwner = false
): LeadTable[] {
  const out: LeadTable[] = [];
  for (const page of osDesks) out.push({ page: page.id, tab: osTabFor(page, key), kind: "os" });
  for (const page of pages) {
    if (page.osDesk || page.inactive || !page.autoMonthKey) continue;
    // Стол закрыт Owner: Тимлид+ его строк не прочтёт — и не спрашиваем.
    if (page.ownerOnly && !viewerIsOwner) continue;
    out.push({ page: page.id, tab: techTabFor(page, key), kind: "tech" });
  }
  return out.slice(0, 400);
}

/**
 * Стол технаря этого заказа закрыт «только для Owner», а смотрит не Owner:
 * копии там не видно, и «не выдан» / «едет» было бы неправдой. Стол — у
 * строки технаря её собственный, у заказа ОС без видимой копии — адрес копии
 * на строке-источнике.
 */
export function leadTechDeskHidden(
  order: LeadOrder,
  pagesById: ReadonlyMap<string, WorkspacePage>,
  viewerIsOwner: boolean
): boolean {
  if (viewerIsOwner) return false;
  const deskId = order.kind === "tech" ? order.pageId : order.copy ? null : (order.row.mirrorPageId ?? null);
  return Boolean(deskId && pagesById.get(deskId)?.ownerOnly);
}

// ---------------------------------------------------------------------------
// Чтение
// ---------------------------------------------------------------------------

function rpcError(error: { message?: string; code?: string } | null, fallback: string): RowsStoreError {
  const code = error?.code ?? "";
  if (code === "42501") return new RowsStoreError(error?.message || fallback, "permission-denied");
  if (code === "PGRST202" || code === "42883") return new RowsStoreError("Owner ещё не вставил свежий SQL (20261036)", "sql-missing");
  if (/fetch|network/i.test(error?.message ?? "")) return new RowsStoreError(error?.message || fallback, "unavailable");
  return new RowsStoreError(error?.message || fallback, code ? `supabase-${code}` : "supabase");
}

function tablesArg(tables: readonly LeadTable[]) {
  return tables.map((t) => ({ page: t.page, tab: t.tab }));
}

function parseHead(raw: unknown): LeadBoardHead {
  const v = (raw ?? {}) as Record<string, unknown>;
  return { count: Number(v.count) || 0, rev: Number(v.rev) || 0, ids: typeof v.ids === "string" ? v.ids : "" };
}

export async function fetchLeadBoard(workspaceId: string, tables: readonly LeadTable[], after: number): Promise<LeadBoardFetch> {
  const { data, error } = await supabaseRows.rpc("lead_board", {
    p_workspace: workspaceId,
    p_tables: tablesArg(tables),
    p_after: after,
  });
  if (error) throw rpcError(error, "Не удалось прочитать общую таблицу");
  const head = parseHead(data);
  const rows = Array.isArray((data as { rows?: unknown })?.rows) ? ((data as { rows: DeskRowRecord[] }).rows) : [];
  return { ...head, rows };
}

export async function fetchLeadBoardHead(workspaceId: string, tables: readonly LeadTable[]): Promise<LeadBoardHead> {
  const { data, error } = await supabaseRows.rpc("lead_board_head", { p_workspace: workspaceId, p_tables: tablesArg(tables) });
  if (error) throw rpcError(error, "Не удалось прочитать общую таблицу");
  return parseHead(data);
}

export function recordKey(r: Pick<DeskRowRecord, "page_id" | "tab_id" | "id">): string {
  return `${r.page_id}/${r.tab_id ?? ""}/${r.id}`;
}

/** Голова набора записей — так же, как её считает `lead_board_head`. */
export function leadHeadOf(records: Iterable<DeskRowRecord>): LeadBoardHead {
  const list = [...records];
  let rev = 0;
  for (const r of list) rev = Math.max(rev, Number(r.rev ?? 0) || 0);
  const parts = list
    .map((r) => ({ key: recordKey(r), part: `${recordKey(r)}:${Number(r.rev ?? 0) || 0}` }))
    .sort((x, y) => compareCodePoints(x.key, y.key))
    .map((e) => e.part);
  return { count: list.length, rev, ids: parts.length ? md5Hex(parts.join(",")) : "" };
}

// ---------------------------------------------------------------------------
// Сборка заказов
// ---------------------------------------------------------------------------

function text(row: PageRow, key: string): string {
  if (!key) return "";
  const v = row.cells[key];
  return v === null || v === undefined ? "" : String(v).trim();
}

function amount(row: PageRow, key: string): number | null {
  const raw = text(row, key);
  if (!raw) return null;
  return parseLooseNumber(raw);
}

function osKeysOf(page: WorkspacePage | undefined): LeadKeys {
  const k: OsDeskKeys = resolveOsDeskKeys(page?.columns);
  return { client: k.client, phone: k.phone, price: k.price, upsell: k.upsell, status: k.status, technician: k.technician, link: k.link, note: k.note, total: k.total };
}

function techKeysOf(page: WorkspacePage | undefined, tab: string): LeadKeys {
  const map = page?.osFieldKeys && page.osFieldKeys.tabId === tab ? page.osFieldKeys : computeOsFieldKeys(tab, page?.columns ?? [], 0);
  return {
    client: map.client ?? "",
    phone: map.phone ?? "",
    price: map.price ?? "",
    upsell: "",
    status: map.status ?? "status",
    technician: "",
    link: map.link ?? "",
    note: "",
    total: "",
  };
}

export interface LeadBuildContext {
  pagesById: ReadonlyMap<string, WorkspacePage>;
  tables: readonly LeadTable[];
}

/**
 * Записи → заказы. Строка стола ОС — заказ со своей копией (по адресу
 * `mirror_*`, иначе по `src_*` копии). Строка технаря с меткой ОС, чей
 * источник в выборке, — это копия, отдельным заказом не идёт. Остальные
 * строки технарей (без ОС или источник вне периода) — заказы «от технаря».
 * Пустые слоты не заказы.
 */
export function buildLeadOrders(records: Iterable<DeskRowRecord>, ctx: LeadBuildContext): LeadOrder[] {
  const osTables = new Set(ctx.tables.filter((t) => t.kind === "os").map((t) => `${t.page}/${t.tab}`));
  const all = [...records];
  const byKey = new Map<string, DeskRowRecord>();
  for (const r of all) byKey.set(recordKey(r), r);
  const copyBySource = new Map<string, DeskRowRecord>();
  for (const r of all) {
    if (!r.os_uid || !r.src_row_id || !r.src_page_id) continue;
    copyBySource.set(`${r.src_page_id}/${r.src_tab_id ?? ""}/${r.src_row_id}`, r);
  }
  const usedCopies = new Set<string>();
  const out: LeadOrder[] = [];

  for (const r of all) {
    if (!osTables.has(`${r.page_id}/${r.tab_id ?? ""}`)) continue;
    const row = recordToRow(r);
    if (isBlankRow(row)) continue;
    const page = ctx.pagesById.get(r.page_id);
    const keys = osKeysOf(page);
    const key = recordKey(r);
    const byMirror = r.mirror_row_id && r.mirror_page_id ? byKey.get(`${r.mirror_page_id}/${r.mirror_tab_id ?? ""}/${r.mirror_row_id}`) : undefined;
    const copyRec = byMirror && byMirror.os_uid ? byMirror : copyBySource.get(key);
    if (copyRec) usedCopies.add(recordKey(copyRec));
    const copy = copyRec ? recordToRow(copyRec) : null;
    const copyPage = copyRec ? ctx.pagesById.get(copyRec.page_id) : undefined;
    const receivedOn = cellMillis(row.cells[OS_RECEIVED_ON_KEY]);
    const entered = rowEnteredAtMs(row);
    out.push({
      key,
      orderKey: r.id,
      row,
      pageId: r.page_id,
      tabId: r.tab_id ?? "",
      kind: "os",
      keys,
      osUid: page?.responsibleUserId ?? null,
      copy,
      techUid: copyPage?.responsibleUserId ?? copy?.techUid ?? null,
      techNick: text(row, keys.technician),
      client: text(row, keys.client),
      phone: text(row, keys.phone),
      price: amount(row, keys.price),
      upsell: amount(row, keys.upsell),
      total: osRowTotal(row, { price: keys.price, upsell: keys.upsell }),
      status: text(row, keys.status),
      techStatus: copy ? text(copy, copy.statusKey || "status") || null : null,
      enteredAt: entered,
      dateMs: receivedOn ?? entered,
    });
  }

  const techTables = new Set(ctx.tables.filter((t) => t.kind === "tech").map((t) => `${t.page}/${t.tab}`));
  for (const r of all) {
    const key = recordKey(r);
    if (usedCopies.has(key) || !techTables.has(`${r.page_id}/${r.tab_id ?? ""}`)) continue;
    const row = recordToRow(r);
    if (isBlankRow(row)) continue;
    const page = ctx.pagesById.get(r.page_id);
    const keys = techKeysOf(page, r.tab_id ?? "");
    const statusKey = row.statusKey || keys.status;
    const entered = rowEnteredAtMs(row);
    const price = amount(row, keys.price);
    out.push({
      key,
      orderKey: row.osUid && row.srcRowId ? row.srcRowId : r.id,
      row,
      pageId: r.page_id,
      tabId: r.tab_id ?? "",
      kind: "tech",
      keys: { ...keys, status: statusKey },
      osUid: row.osUid ?? null,
      copy: null,
      techUid: page?.responsibleUserId ?? row.techUid ?? null,
      techNick: "",
      client: text(row, keys.client),
      phone: text(row, keys.phone),
      price,
      upsell: null,
      total: price,
      status: text(row, statusKey),
      techStatus: text(row, statusKey) || null,
      enteredAt: entered,
      dateMs: entered,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Запись
// ---------------------------------------------------------------------------

export function leadsTopic(workspaceId: string): string {
  return `nova:${workspaceId}:leads`;
}

function ringLeads(workspaceId: string) {
  ringTopic(leadsTopic(workspaceId));
}

/**
 * Правка ячеек заказа в его НАСТОЯЩЕЙ таблице. Цена или апсейл строки ОС —
 * той же записью пересчитывается «Итого» (как `useOsTotalsKeeper`).
 */
export async function patchLeadCells(
  workspaceId: string,
  order: LeadOrder,
  cells: Record<string, string | number | null>
): Promise<void> {
  const next = { ...cells };
  const totalKey = order.keys.total;
  const moneyKeys = [order.keys.price, order.keys.upsell].filter(Boolean).flatMap((k) => [k, payKeyOf(k), feeKeyOf(k)]);
  const touchesMoney = moneyKeys.some((k) => k in cells);
  if (order.kind === "os" && totalKey && touchesMoney) {
    const merged = { ...order.row, cells: { ...order.row.cells, ...cells } };
    const total = osRowTotal(merged, { price: order.keys.price, upsell: order.keys.upsell });
    next[totalKey] = total === null ? "" : String(total);
  }
  await sbPatchRow(workspaceId, order.pageId, order.tabId || null, order.row.id, { cells: next });
  ringLeads(workspaceId);
}

export async function patchLeadExtras(workspaceId: string, order: LeadOrder, extras: PageRow["extras"] | null): Promise<void> {
  await sbPatchRow(workspaceId, order.pageId, order.tabId || null, order.row.id, { extras });
  ringLeads(workspaceId);
}

export interface MovedLead {
  page: string;
  tab: string;
  id: string;
  osUid: string;
  fromOsUid: string | null;
  copyMoved: boolean;
}

/**
 * Переназначить заказ другому ОС: строка переезжает на его стол в вкладку
 * текущего периода, копия у технаря — переподписывается. Новому ОС —
 * уведомление.
 */
export async function moveLeadOs(input: {
  workspaceId: string;
  order: LeadOrder;
  toOs: WorkspaceMember;
  osDesks: readonly WorkspacePage[];
  fromUid: string;
  fromName: string;
}): Promise<MovedLead> {
  const { workspaceId, order, toOs } = input;
  if (order.kind !== "os") throw new Error("Заказ без стола ОС — ОС меняется на столе технаря");
  const tab = await openOsDeskCurrentTab({
    workspaceId,
    uid: toOs.uid,
    name: toOs.osNick || toOs.nickname || toOs.name || "",
    osDesks: input.osDesks,
    createIfMissing: true,
  });
  if (!tab) throw new Error("Стол ОС не открылся");
  const { data, error } = await supabaseRows.rpc("lead_move_os", {
    p_workspace: workspaceId,
    p_from_page: order.pageId,
    p_from_tab: order.tabId,
    p_row: order.row.id,
    p_to_page: tab.page.id,
    p_to_tab: tab.tabId ?? "",
  });
  if (error) throw rpcError(error, "Не удалось переназначить заказ");
  const v = (data ?? {}) as Record<string, unknown>;
  const moved: MovedLead = {
    page: String(v.page ?? tab.page.id),
    tab: String(v.tab ?? tab.tabId ?? ""),
    id: String(v.id ?? order.row.id),
    osUid: String(v.osUid ?? toOs.uid),
    fromOsUid: typeof v.fromOsUid === "string" ? v.fromOsUid : null,
    copyMoved: Boolean(v.copyMoved),
  };
  ringRowsDoorbell(workspaceId, order.pageId, order.tabId);
  ringRowsDoorbell(workspaceId, moved.page, moved.tab);
  if (order.copy?.deskPageId) ringRowsDoorbell(workspaceId, order.copy.deskPageId, order.copy.tabId ?? "");
  ringLeads(workspaceId);
  const client = order.client || "клиент";
  await sendNotification(
    {
      workspaceId,
      title: `Тимлид передал вам заказ: ${client}`,
      body: order.phone ? `${client} · ${order.phone}` : client,
      priority: "important",
      fromUid: input.fromUid,
      fromName: input.fromName,
      target: "selected",
      selectedUids: [toOs.uid],
      href: deskRowHref(moved.page, moved.tab || null, moved.id),
      pageId: moved.page,
      kind: "lead-assigned",
    },
    [toOs.uid]
  ).catch(() => undefined);
  return moved;
}

export interface NewLeadInput extends NewOsOrderInput {
  upsell: string;
  /** Способ оплаты цены и апсейла (комиссия вычитается из «Итого»). */
  pricePay?: PaymentMethod | null;
  upsellPay?: PaymentMethod | null;
}

/**
 * Новый клиент от Тимлида+: строкой на стол выбранного ОС (вкладка текущего
 * периода, первый пустой слот, «Утверждение»), дальше ОС ведёт его как свой
 * заказ. ОС — уведомление «Тимлид дал вам новый лид».
 */
export async function addLead(input: {
  workspaceId: string;
  os: WorkspaceMember;
  osDesks: readonly WorkspacePage[];
  lead: NewLeadInput;
  statusOptions: readonly StatusOption[];
  fromUid: string;
  fromName: string;
}): Promise<{ pageId: string; tabId: string; rowId: string }> {
  const { workspaceId, os, lead } = input;
  const tab = await openOsDeskCurrentTab({
    workspaceId,
    uid: os.uid,
    name: os.osNick || os.nickname || os.name || "",
    osDesks: input.osDesks,
    createIfMissing: true,
  });
  if (!tab) throw new Error("Стол ОС не открылся");
  const rows = await fetchOsDeskTabRows(tab);
  const now = Date.now();
  const extra: Record<string, string | number | null> = {
    [LEAD_BY_KEY]: input.fromUid,
    [LEAD_AT_KEY]: String(now),
    [OS_RECEIVED_ON_KEY]: String(almatyDay(now)),
  };
  // Апсейл и «Итого» пишутся и без столбца: у старого стола ОС его нет,
  // стол сам допишет столбцы с теми же ключами (`missingOsDeskColumns`), и
  // значения появятся. Тимлиду+ структуру чужого стола править нельзя.
  const price = lead.price.trim() ? normalizeNumericInput(lead.price) : "";
  const upsell = lead.upsell.trim() ? normalizeNumericInput(lead.upsell) : "";
  if (upsell) extra[tab.keys.upsell] = upsell;
  if (lead.pricePay && price) Object.assign(extra, paymentPatch(tab.keys.price, lead.pricePay));
  if (lead.upsellPay && upsell) Object.assign(extra, paymentPatch(tab.keys.upsell, lead.upsellPay));
  const total = osRowTotal({ cells: { ...extra, [tab.keys.price]: price } }, { price: tab.keys.price, upsell: tab.keys.upsell });
  if (total !== null) extra[tab.keys.total] = String(total);
  const row = await addOsDeskOrderRow({ tab, rows, order: lead, statusOptions: input.statusOptions, extraCells: extra, highlight: true });
  ringLeads(workspaceId);
  const client = lead.client.trim() || "клиент";
  await sendNotification(
    {
      workspaceId,
      title: `Тимлид дал вам новый лид: ${client}`,
      body: [lead.phone.trim(), lead.price.trim() ? `${lead.price.trim()}` : "", lead.note.trim()].filter(Boolean).join(" · ") || client,
      priority: "important",
      fromUid: input.fromUid,
      fromName: input.fromName,
      target: "selected",
      selectedUids: [os.uid],
      href: deskRowHref(tab.page.id, tab.tabId, row.id),
      pageId: tab.page.id,
      kind: "lead-assigned",
    },
    [os.uid]
  ).catch(() => undefined);
  return { pageId: tab.page.id, tabId: tab.tabId ?? "", rowId: row.id };
}

/** Живые ОС workspace: основная или вторая роль. */
export function osMembersOf(members: readonly WorkspaceMember[]): WorkspaceMember[] {
  return members.filter((m) => m.uid && m.status === "active" && (m.role === "os" || (m.extraRoles ?? []).includes("os")));
}

export function osDeskOf(osDesks: readonly WorkspacePage[], uid: string | null): WorkspacePage | null {
  return findOsDeskOf([...osDesks], uid);
}

// ---------------------------------------------------------------------------
// История
// ---------------------------------------------------------------------------

export type LeadEventKind = "created" | "status" | "tech" | "issued" | "unissued" | "amount" | "carried" | "deleted" | "os";

export interface LeadEvent {
  id: number;
  orderKey: string;
  pageId: string;
  tabId: string;
  rowId: string;
  kind: LeadEventKind;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  actorUid: string | null;
  at: number;
}

function toEvent(r: Record<string, unknown>): LeadEvent {
  return {
    id: Number(r.id) || 0,
    orderKey: String(r.order_key ?? ""),
    pageId: String(r.page_id ?? ""),
    tabId: String(r.tab_id ?? ""),
    rowId: String(r.row_id ?? ""),
    kind: String(r.kind ?? "") as LeadEventKind,
    field: (r.field as string | null) ?? null,
    oldValue: (r.old_value as string | null) ?? null,
    newValue: (r.new_value as string | null) ?? null,
    actorUid: (r.actor_uid as string | null) ?? null,
    at: Number(r.at) || 0,
  };
}

const EVENT_COLUMNS = "id, order_key, page_id, tab_id, row_id, kind, field, old_value, new_value, actor_uid, at";

/** История одного заказа, старые сверху. */
export async function fetchOrderEvents(workspaceId: string, orderKey: string): Promise<LeadEvent[]> {
  const { data, error } = await supabaseRows
    .from("order_events")
    .select(EVENT_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("order_key", orderKey)
    .order("id", { ascending: true })
    .limit(300);
  if (error) throw rpcError(error, "Не удалось прочитать историю");
  return (data ?? []).map((r) => toEvent(r as Record<string, unknown>));
}

/** Лента последних изменений по всем заказам, новые сверху. */
export async function fetchRecentEvents(workspaceId: string, beforeId: number | null, limit = 50): Promise<LeadEvent[]> {
  let q = supabaseRows
    .from("order_events")
    .select(EVENT_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("id", { ascending: false })
    .limit(limit);
  if (beforeId) q = q.lt("id", beforeId);
  const { data, error } = await q;
  if (error) throw rpcError(error, "Не удалось прочитать ленту");
  return (data ?? []).map((r) => toEvent(r as Record<string, unknown>));
}

// ---------------------------------------------------------------------------
// Статистика
// ---------------------------------------------------------------------------

export interface LeadStats {
  count: number;
  /** На утверждении (не выданы ОС). */
  approval: number;
  /** В работе и переделка. */
  inWork: number;
  payment: number;
  freeze: number;
  done: number;
  cancelled: number;
  /** «Грязная» касса: цена + апсейл до комиссии, без отменённых. */
  gross: number;
  /** Касса после комиссии способа оплаты («Итого»), без отменённых. */
  net: number;
  upsell: number;
  upsellCount: number;
  /** Апсейл заказов в «Готово». */
  upsellDone: number;
  /** Касса «Готово» (после комиссии). */
  doneNet: number;
  /** KPI: доля «Готово» среди заказов без отменённых, 0..1; null — заказов нет. */
  kpi: number | null;
}

function isCancelledLabel(label: string, value: string): boolean {
  const l = label.toLowerCase();
  return l.includes("отмен") || l.includes("cancel") || value === "cancelled";
}

/**
 * Сводка по заказам: статус у ОС-заказа — статус ОС (его же триггер везёт
 * технарю), у заказа технаря без ОС — статус технаря. Вид статуса — те же
 * правила, что у «Технарей» (`techLoadKindForOption`: карта Owner или
 * название), «Готово» — по названию, как касса везде.
 */
/**
 * Статус заказа для группы, статистики и столбца «Статус». Обычно это статус
 * строки. Но у выданного заказа строка ОС бывает «на утверждении» (пустой
 * статус), хотя технарь давно поставил «Готово»: подхваченные заказы и
 * заказы, чей статус технаря к ОС ещё не подтянул проход стола ОС. Тогда
 * верим технарю. Иначе такие заказы висели бы в «Утверждении» и не считались
 * бы в «Готово».
 */
export function leadStatusOf(o: LeadOrder, statusOptions: readonly StatusOption[]): string {
  if (o.kind === "os" && o.techStatus && isApprovalStatusValue(o.status, statusOptions) && !isApprovalStatusValue(o.techStatus, statusOptions)) {
    return o.techStatus;
  }
  return o.status;
}

export function leadStats(
  orders: readonly LeadOrder[],
  statusOptions: readonly StatusOption[],
  kinds: Record<string, TechLoadKind> | undefined
): LeadStats {
  const s: LeadStats = { count: 0, approval: 0, inWork: 0, payment: 0, freeze: 0, done: 0, cancelled: 0, gross: 0, net: 0, upsell: 0, upsellCount: 0, upsellDone: 0, doneNet: 0, kpi: null };
  for (const o of orders) {
    s.count += 1;
    const status = leadStatusOf(o, statusOptions);
    const option = statusOptions.find((x) => x.value === status) ?? null;
    const label = option?.label ?? status;
    if (status && isCancelledLabel(label, status)) {
      s.cancelled += 1;
      continue;
    }
    const upsell = o.upsell ?? 0;
    s.gross += (o.price ?? 0) + upsell;
    s.net += o.total ?? 0;
    if (upsell) {
      s.upsell += upsell;
      s.upsellCount += 1;
    }
    const done = Boolean(status) && (isDoneStatusLabel(label) || status === "done");
    if (done) {
      s.done += 1;
      s.doneNet += o.total ?? 0;
      s.upsellDone += upsell;
      continue;
    }
    if (!status || isApprovalStatusValue(status, statusOptions)) {
      s.approval += 1;
      continue;
    }
    const kind = option ? techLoadKindForOption(option, kinds) : "busy";
    if (kind === "payment") s.payment += 1;
    else if (kind === "freeze") s.freeze += 1;
    else s.inWork += 1;
  }
  const base = s.count - s.cancelled;
  s.kpi = base > 0 ? s.done / base : null;
  return s;
}
