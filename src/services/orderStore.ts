import {
  getCountFromServer,
  getDoc,
  getDocFromServer,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  where,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { supabaseRows } from "@/lib/supabaseRows";
import {
  isSbMissingError,
  markSbTableMissing,
  markSbTablePresent,
  sbBackendOf,
  sbTableRecheckDue,
  sbTargetOf,
  useSbBackend,
  type SbBackend,
} from "@/services/sb/sbCollections";
import { listenTopic, ringTopic } from "@/services/sb/topicDoorbell";
import { normalizeTimestamp } from "@/utils/date";
import type { WorkOrder, WorkOrderStatus } from "@/types";

/**
 * Где живёт биржа «Заказы» и как её читать (26.09.2026, SQL 20261010).
 *
 * Пока таблицы `work_orders` нет (или строки не в Supabase, или Owner
 * выключил), всё идёт по-старому в Firestore — orderService не меняет
 * поведения. В режиме Supabase:
 *  • ЖИВЫЕ заказы (открытые и выданные) — ОДИН общий поток на вкладку
 *    (`subscribeLiveOrdersFeed`): окно живых из Supabase + дельта по `rev`
 *    по звонку `nova:{ws}:orders` и опросу; плюс узкий слушатель живых
 *    заказов Firestore — заказы, выданные до переезда (или вкладкой на
 *    старом коде), остаются на бирже, пока их не заберут. Все экраны
 *    («Заказы», зелёный пункт меню, автозаезд технаря, стол ОС, довоз от
 *    ОС) берут свои подмножества из этого потока, а не держат по слушателю;
 *  • запись — `order_write` (SECURITY DEFINER: права — копия правил
 *    Firestore, время и автор — серверные); заказ Firestore-эпохи правится
 *    там же, где лежит: база отвечает «заказа нет» (P0002) — идём в Firestore;
 *  • история («В столах», «Отменённые») — из обоих хранилищ слиянием.
 */

export const ORDERS_TABLE = "work_orders";
const ORDER_COLUMNS = "id,data,rev,deleted,status";
const LIVE_STATUSES = ["open", "assigned"] as const;

export function ordersTopic(workspaceId: string) {
  return `nova:${workspaceId}:orders`;
}

/** Где биржа этого workspace — по документу workspace из стора (как у чатов). */
export function ordersBackendFor(workspaceId: string): SbBackend {
  const docWs = useWorkspaceStore.getState().workspaces.find((w) => w.id === workspaceId);
  if (!docWs) return "firestore";
  const backend = sbBackendOf(docWs, "orders");
  if (backend === "firestore" && sbTargetOf(docWs, "orders") === "supabase" && sbTableRecheckDue("orders")) {
    return "supabase";
  }
  return backend;
}

/** То же для экрана: переподписка, когда таблица нашлась (или пропала). */
export function useOrdersBackend(workspaceId: string | null): SbBackend | null {
  const workspace = useWorkspaceStore((s) => (workspaceId ? (s.workspaces.find((w) => w.id === workspaceId) ?? null) : null));
  return useSbBackend(workspace, "orders");
}

interface OrderRow {
  id: string;
  data: Record<string, unknown> | null;
  rev: number | string;
  deleted: boolean;
  status: string;
}

export function sbError(error: { code?: string; message?: string } | null | undefined): Error {
  // Без кода — это сеть (fetch не дошёл): для экранов это «unavailable», как у Firestore.
  return Object.assign(new Error(error?.message || "Supabase"), { code: error?.code || "unavailable" });
}

export function mapFirestoreOrder(data: Record<string, unknown>, id: string): WorkOrder {
  const row = { id, ...data } as WorkOrder;
  return {
    ...row,
    claims: row.claims ?? {},
    createdAt: normalizeTimestamp(row.createdAt),
    updatedAt: normalizeTimestamp(row.updatedAt),
  };
}

function rowToOrder(row: OrderRow, workspaceId: string): WorkOrder {
  const data = (row.data ?? {}) as Partial<WorkOrder>;
  return {
    ...(data as WorkOrder),
    id: row.id,
    workspaceId,
    claims: (data.claims as WorkOrder["claims"]) ?? {},
    createdAt: Number(data.createdAt) || 0,
    updatedAt: Number(data.updatedAt) || 0,
    source: "sb",
  };
}

function isLive(order: Pick<WorkOrder, "status">): boolean {
  return order.status === "open" || order.status === "assigned";
}

// ---------------------------------------------------------------------
// Живые заказы: общий поток на workspace.
// ---------------------------------------------------------------------

type FeedReader = { onData: (orders: WorkOrder[], fromCache: boolean) => void; onError?: (error: unknown) => void };

interface FeedEntry {
  workspaceId: string;
  readers: Set<FeedReader>;
  sb: Map<string, WorkOrder>;
  /** rev последнего увиденного состояния каждого заказа — старое событие не перебьёт новое. */
  sbRev: Map<string, number>;
  fs: Map<string, WorkOrder>;
  sbSynced: boolean;
  sbOff: boolean;
  fsSynced: boolean;
  last: { orders: WorkOrder[]; fromCache: boolean } | null;
  stop: () => void;
  linger: ReturnType<typeof setTimeout> | null;
  refresh: () => void;
}

const feeds = new Map<string, FeedEntry>();
/** Серию звонков — одной дельтой. */
const RING_SETTLE_MS = 250;
/** Без звонка — опрос: на виду раз в 30 с, свёрнутая — раз в 2 мин (автозаезд технаря живёт и там). */
const POLL_MS = 30_000;
const HIDDEN_POLL_EVERY = 4;
const RETRY_MS = [3_000, 10_000, 30_000];
const DELTA_PAGE = 200;
const CURSOR_SAFETY_MS = 15_000;
const LINGER_MS = 60_000;
/** Сколько последних правок первая дельта перечитывает заново (см. fetchRows). */
const HEAD_SPAN = 50;

function emitFeed(entry: FeedEntry) {
  const byId = new Map<string, WorkOrder>();
  for (const order of entry.fs.values()) byId.set(order.id, order);
  // Один id в обоих хранилищах не встречается (id заказа уникален), но если
  // вдруг — Supabase свежее.
  for (const order of entry.sb.values()) byId.set(order.id, order);
  const orders = [...byId.values()].filter(isLive).sort((a, b) => b.createdAt - a.createdAt);
  const fromCache = !(entry.fsSynced && (entry.sbSynced || entry.sbOff));
  entry.last = { orders, fromCache };
  for (const reader of [...entry.readers]) reader.onData(orders, fromCache);
}

function failFeed(entry: FeedEntry, error: unknown) {
  // Firestore после ошибки слушатель не поднимает сам — поток мёртв; следующий
  // экран заведёт новый (как «Повторить» у страницы).
  if (feeds.get(entry.workspaceId) === entry) feeds.delete(entry.workspaceId);
  entry.stop();
  for (const reader of [...entry.readers]) reader.onError?.(error);
}

function startFeed(workspaceId: string): FeedEntry {
  let stopped = false;
  let inFlight = false;
  let again = false;
  let failures = 0;
  let revLog: { rev: number; at: number; seenAt: number }[] = [];
  let newestAt = 0;
  let cursorRev = 0;
  let ringTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTick = 0;
  let toldError = false;

  const entry: FeedEntry = {
    workspaceId,
    readers: new Set(),
    sb: new Map(),
    sbRev: new Map(),
    fs: new Map(),
    sbSynced: false,
    sbOff: false,
    fsSynced: false,
    last: null,
    linger: null,
    stop: () => {},
    refresh: () => schedule(),
  };

  function noteRevs(rows: { rev: number | string; server_at?: string }[]) {
    const seenAt = Date.now();
    for (const row of rows) {
      const rev = Number(row.rev) || 0;
      const at = row.server_at ? Date.parse(row.server_at) || 0 : 0;
      newestAt = Math.max(newestAt, at);
      if (rev > cursorRev) revLog.push({ rev, at, seenAt });
    }
  }

  function cursor(): number {
    const now = Date.now();
    for (const e of revLog) {
      const settled = (e.at > 0 && e.at <= newestAt - CURSOR_SAFETY_MS) || now - e.seenAt >= CURSOR_SAFETY_MS;
      if (settled && e.rev > cursorRev) cursorRev = e.rev;
    }
    revLog = revLog.filter((e) => e.rev > cursorRev);
    return cursorRev;
  }

  function take(row: OrderRow): boolean {
    const rev = Number(row.rev) || 0;
    const known = entry.sbRev.get(row.id);
    if (known !== undefined && known >= rev) return false;
    entry.sbRev.set(row.id, rev);
    const order = rowToOrder(row, workspaceId);
    if (row.deleted || !isLive(order)) return entry.sb.delete(row.id);
    entry.sb.set(row.id, order);
    return true;
  }

  async function fetchRows() {
    if (stopped || entry.sbOff) return;
    if (inFlight) {
      again = true;
      return;
    }
    inFlight = true;
    try {
      let changed = false;
      const base = () =>
        supabaseRows.from(ORDERS_TABLE).select(`${ORDER_COLUMNS},server_at`).eq("workspace_id", workspaceId);
      if (!entry.sbSynced) {
        // Голова таблицы — ДО окна: курсор дельты начинается с неё, а не с
        // нуля (иначе первая дельта перечитала бы всю историю заказов). Запас
        // в 50 последних правок покрывает транзакции, зафиксированные позже
        // своего номера; они дочитаются первой дельтой.
        const head = await supabaseRows
          .from(ORDERS_TABLE)
          .select("rev,server_at")
          .eq("workspace_id", workspaceId)
          .order("rev", { ascending: false })
          .limit(HEAD_SPAN);
        if (stopped) return;
        if (head.error) throw head.error;
        const { data, error } = await base().eq("deleted", false).in("status", [...LIVE_STATUSES]).limit(1000);
        if (stopped) return;
        if (error) throw error;
        const rows = (data ?? []) as (OrderRow & { server_at: string })[];
        for (const row of rows) take(row);
        const headRows = (head.data ?? []) as { rev: number | string; server_at: string }[];
        cursorRev = headRows.length >= HEAD_SPAN ? Math.min(...headRows.map((r) => Number(r.rev) || 0)) - 1 : 0;
        noteRevs(headRows);
        entry.sbSynced = true;
        changed = true;
      } else {
        const after = cursor();
        for (let from = 0; ; from += DELTA_PAGE) {
          const { data, error } = await base().gt("rev", after).order("rev", { ascending: true }).range(from, from + DELTA_PAGE - 1);
          if (stopped) return;
          if (error) throw error;
          const rows = (data ?? []) as (OrderRow & { server_at: string })[];
          for (const row of rows) if (take(row)) changed = true;
          noteRevs(rows);
          if (rows.length < DELTA_PAGE) break;
        }
      }
      markSbTablePresent("orders");
      failures = 0;
      toldError = false;
      if (changed) emitFeed(entry);
    } catch (error) {
      if (stopped) return;
      if (isSbMissingError(error)) {
        // SQL не накатан — поток живёт на одном Firestore; экраны сами
        // переключатся в режим Firestore (useOrdersBackend).
        markSbTableMissing("orders");
        entry.sbOff = true;
        entry.sb.clear();
        emitFeed(entry);
        return;
      }
      const delay = RETRY_MS[Math.min(failures, RETRY_MS.length - 1)];
      failures += 1;
      if (!retryTimer) {
        retryTimer = setTimeout(() => {
          retryTimer = null;
          void fetchRows();
        }, delay);
      }
      if (!entry.sbSynced && !toldError) {
        toldError = true;
        for (const reader of [...entry.readers]) reader.onError?.(sbError(error as { code?: string; message?: string }));
      }
    } finally {
      inFlight = false;
      if (again) {
        again = false;
        void fetchRows();
      }
    }
  }

  function schedule() {
    if (stopped || entry.sbOff || ringTimer) return;
    ringTimer = setTimeout(() => {
      ringTimer = null;
      void fetchRows();
    }, RING_SETTLE_MS);
  }

  const onVisible = () => {
    if (document.visibilityState === "visible") schedule();
  };

  const stopRing = listenTopic(ordersTopic(workspaceId), schedule);
  document.addEventListener("visibilitychange", onVisible);
  const poll = setInterval(() => {
    pollTick += 1;
    if (document.visibilityState === "visible" || pollTick % HIDDEN_POLL_EVERY === 0) void fetchRows();
  }, POLL_MS);

  // Заказы Firestore-эпохи и вкладок на старом коде: только живые.
  let stopFs: () => void = () => {};
  if (db) {
    stopFs = onSnapshot(
      query(paths.orders(workspaceId), where("status", "in", [...LIVE_STATUSES])),
      { includeMetadataChanges: true },
      (snap) => {
        if (stopped) return;
        entry.fs = new Map(
          snap.docs.map((d) => {
            const order = mapFirestoreOrder(d.data(), d.id);
            return [order.id, { ...order, source: "fs" as const }];
          })
        );
        entry.fsSynced = !snap.metadata.fromCache;
        emitFeed(entry);
      },
      (error) => {
        if (!stopped) failFeed(entry, error);
      }
    );
  } else {
    entry.fsSynced = true;
  }

  entry.stop = () => {
    if (stopped) return;
    stopped = true;
    stopRing();
    stopFs();
    clearInterval(poll);
    if (ringTimer) clearTimeout(ringTimer);
    if (retryTimer) clearTimeout(retryTimer);
    document.removeEventListener("visibilitychange", onVisible);
  };

  void fetchRows();
  return entry;
}

/**
 * Живые заказы workspace (открытые и выданные), новые сверху — из обоих
 * хранилищ. `fromCache` — пока хоть одно не подтверждено сервером: рисовать
 * можно, решать («заказ ушёл с биржи», «выдай заново») — нет.
 */
export function subscribeLiveOrdersFeed(
  workspaceId: string,
  onData: (orders: WorkOrder[], fromCache: boolean) => void,
  onError?: (error: unknown) => void
): () => void {
  let entry = feeds.get(workspaceId);
  if (!entry) {
    entry = startFeed(workspaceId);
    feeds.set(workspaceId, entry);
  }
  const current = entry;
  if (current.linger) {
    clearTimeout(current.linger);
    current.linger = null;
  }
  const reader: FeedReader = { onData, onError };
  current.readers.add(reader);
  if (current.last) onData(current.last.orders, current.last.fromCache);
  return () => {
    current.readers.delete(reader);
    if (current.readers.size > 0 || current.linger) return;
    current.linger = setTimeout(() => {
      current.linger = null;
      if (current.readers.size > 0) return;
      current.stop();
      if (feeds.get(workspaceId) === current) feeds.delete(workspaceId);
    }, LINGER_MS);
  };
}

/** Своя запись легла — показать её сразу во всех экранах вкладки. */
function applyLocal(workspaceId: string, row: OrderRow) {
  const entry = feeds.get(workspaceId);
  if (!entry || entry.sbOff) return;
  const rev = Number(row.rev) || 0;
  const known = entry.sbRev.get(row.id);
  if (known !== undefined && known >= rev) return;
  entry.sbRev.set(row.id, rev);
  const order = rowToOrder(row, workspaceId);
  if (row.deleted || !isLive(order)) entry.sb.delete(row.id);
  else entry.sb.set(row.id, order);
  emitFeed(entry);
}

// ---------------------------------------------------------------------
// Запись.
// ---------------------------------------------------------------------

export type OrderOp = "create" | "claim" | "scope" | "assign" | "unassign" | "cancel" | "delete" | "take" | "retab";

/** Заказа в Supabase нет (Firestore-эпоха) — писать в Firestore. */
export class OrderNotInSupabase extends Error {}

/**
 * Операция над заказом в Supabase. Нет таблицы — бросает OrderNotInSupabase
 * (и запоминает «таблицы нет»); заказа нет в базе — тоже. Иначе — заказ,
 * каким его оставила база.
 */
export async function sbOrderWrite(workspaceId: string, id: string, op: OrderOp, args: Record<string, unknown> = {}): Promise<WorkOrder> {
  const { data, error } = await supabaseRows.rpc("order_write", { p_workspace: workspaceId, p_id: id, p_op: op, p_args: args });
  if (error) {
    if (isSbMissingError(error)) {
      markSbTableMissing("orders");
      throw new OrderNotInSupabase("orders: SQL не накатан");
    }
    if (error.code === "P0002") throw new OrderNotInSupabase("orders: заказа нет в Supabase");
    throw sbError(error);
  }
  markSbTablePresent("orders");
  const obj = (typeof data === "string" ? JSON.parse(data) : data) as Record<string, unknown> & { rev?: number; deleted?: boolean };
  const row: OrderRow = { id, data: obj, rev: Number(obj?.rev) || 0, deleted: Boolean(obj?.deleted), status: String(obj?.status ?? "") };
  applyLocal(workspaceId, row);
  ringTopic(ordersTopic(workspaceId));
  return rowToOrder(row, workspaceId);
}

/**
 * Запись в то хранилище, где заказ лежит. Заказ из Supabase — только туда;
 * из Firestore (метка `fs`) — только в Firestore; неизвестно откуда (есть
 * лишь id) — сперва Supabase, «нет там» — Firestore.
 */
export async function routeOrderWrite(
  workspaceId: string,
  order: Pick<WorkOrder, "id" | "source"> | string,
  op: OrderOp,
  args: Record<string, unknown>,
  firestore: () => Promise<unknown>
): Promise<void> {
  const id = typeof order === "string" ? order : order.id;
  const source = typeof order === "string" ? undefined : order.source;
  if (source === "fs" || ordersBackendFor(workspaceId) === "firestore") {
    await firestore();
    return;
  }
  try {
    await sbOrderWrite(workspaceId, id, op, args);
  } catch (error) {
    if (error instanceof OrderNotInSupabase && source !== "sb") {
      await firestore();
      return;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------
// Один заказ.
// ---------------------------------------------------------------------

async function sbFetchOne(workspaceId: string, id: string): Promise<WorkOrder | null | undefined> {
  const { data, error } = await supabaseRows.from(ORDERS_TABLE).select(ORDER_COLUMNS).eq("workspace_id", workspaceId).eq("id", id).limit(1);
  if (error) {
    if (isSbMissingError(error)) {
      markSbTableMissing("orders");
      return undefined;
    }
    throw sbError(error);
  }
  const row = ((data ?? []) as OrderRow[])[0];
  if (!row) return undefined;
  return row.deleted ? null : rowToOrder(row, workspaceId);
}

/**
 * Заказ разово. `fresh` — только с сервера (решение «выдан ли он мне ещё»);
 * без — Firestore может ответить из кэша. undefined из Supabase = «там его
 * нет» → Firestore; null — удалён.
 */
export async function fetchOrderAnywhere(workspaceId: string, id: string, fresh: boolean): Promise<WorkOrder | null> {
  if (ordersBackendFor(workspaceId) === "supabase") {
    const found = await sbFetchOne(workspaceId, id);
    if (found !== undefined) return found;
  }
  if (!db) return null;
  const snap = fresh ? await getDocFromServer(paths.order(workspaceId, id)) : await getDoc(paths.order(workspaceId, id));
  return snap.exists() ? { ...mapFirestoreOrder(snap.data(), snap.id), source: "fs" } : null;
}

// ---------------------------------------------------------------------
// История.
// ---------------------------------------------------------------------

export interface OrderHistoryCursor {
  sbOffset: number;
  sbDone: boolean;
  fsAfter: QueryDocumentSnapshot | null;
  fsDone: boolean;
  /** Прочитано, но ещё не показано: слияние двух хранилищ по дате. */
  sbBuffer: WorkOrder[];
  fsBuffer: WorkOrder[];
}

export function initialHistoryCursor(workspaceId: string): OrderHistoryCursor {
  const sb = ordersBackendFor(workspaceId) === "supabase";
  return { sbOffset: 0, sbDone: !sb, fsAfter: null, fsDone: !db, sbBuffer: [], fsBuffer: [] };
}

async function sbHistoryPage(workspaceId: string, from: number, size: number): Promise<WorkOrder[] | null> {
  const { data, error } = await supabaseRows
    .from(ORDERS_TABLE)
    .select(ORDER_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("deleted", false)
    .in("status", ["taken", "cancelled"])
    .order("created_at", { ascending: false })
    .range(from, from + size - 1);
  if (error) {
    if (isSbMissingError(error)) {
      markSbTableMissing("orders");
      return null;
    }
    throw sbError(error);
  }
  return ((data ?? []) as OrderRow[]).map((row) => rowToOrder(row, workspaceId));
}

/**
 * Следующие `size` заказов истории из обоих хранилищ, новые сверху. Верно
 * по построению: верхние N объединения лежат среди верхних N каждого
 * хранилища — поэтому каждое дочитывается до N в буфере, а лишнее ждёт
 * следующей страницы.
 */
export async function fetchMergedHistoryPage(
  workspaceId: string,
  cursor: OrderHistoryCursor,
  size: number
): Promise<{ orders: WorkOrder[]; cursor: OrderHistoryCursor; hasMore: boolean }> {
  const next: OrderHistoryCursor = { ...cursor, sbBuffer: [...cursor.sbBuffer], fsBuffer: [...cursor.fsBuffer] };
  if (!next.sbDone && next.sbBuffer.length < size) {
    const page = await sbHistoryPage(workspaceId, next.sbOffset, size);
    if (page === null) {
      next.sbDone = true;
    } else {
      next.sbOffset += page.length;
      next.sbBuffer.push(...page);
      if (page.length < size) next.sbDone = true;
    }
  }
  if (!next.fsDone && next.fsBuffer.length < size && db) {
    const q = next.fsAfter
      ? query(paths.orders(workspaceId), orderBy("createdAt", "desc"), startAfter(next.fsAfter), limit(size))
      : query(paths.orders(workspaceId), orderBy("createdAt", "desc"), limit(size));
    const snap = await getDocs(q);
    next.fsAfter = snap.docs[snap.docs.length - 1] ?? next.fsAfter;
    if (snap.size < size) next.fsDone = true;
    // Живые заказы в этой выборке — не история (их показывает поток).
    next.fsBuffer.push(
      ...snap.docs
        .map((d) => ({ ...mapFirestoreOrder(d.data(), d.id), source: "fs" as const }))
        .filter((o) => !isLive(o))
    );
  }
  const merged = [...next.sbBuffer, ...next.fsBuffer].sort((a, b) => b.createdAt - a.createdAt);
  const shown = merged.slice(0, size);
  const shownIds = new Set(shown.map((o) => o.id));
  next.sbBuffer = next.sbBuffer.filter((o) => !shownIds.has(o.id));
  next.fsBuffer = next.fsBuffer.filter((o) => !shownIds.has(o.id));
  const hasMore = next.sbBuffer.length > 0 || next.fsBuffer.length > 0 || !next.sbDone || !next.fsDone;
  return { orders: shown, cursor: next, hasMore };
}

/** Сколько заказов в статусе — сумма по обоим хранилищам. */
export async function countOrdersAnywhere(workspaceId: string, status: WorkOrderStatus): Promise<number> {
  let total = 0;
  if (ordersBackendFor(workspaceId) === "supabase") {
    const { count, error } = await supabaseRows
      .from(ORDERS_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("deleted", false)
      .eq("status", status);
    if (error) {
      if (isSbMissingError(error)) markSbTableMissing("orders");
      else throw sbError(error);
    } else {
      total += count ?? 0;
    }
  }
  if (db) {
    const snapshot = await getCountFromServer(query(paths.orders(workspaceId), where("status", "==", status)));
    total += snapshot.data().count;
  }
  return total;
}

/** Для проверок: остановить все потоки. */
export function resetOrderFeedsForTest() {
  for (const entry of feeds.values()) entry.stop();
  feeds.clear();
}
