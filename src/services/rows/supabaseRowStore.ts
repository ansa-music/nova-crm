import type { RealtimeChannel } from "@supabase/supabase-js";
import { DESK_ROWS_CONFLICT, DESK_ROWS_TABLE, supabaseRows } from "@/lib/supabaseRows";
import type { PageRow, RowAttachment } from "@/types";

/**
 * Строки таблиц в Supabase (`desk_rows`) — зеркальные двойники функций строк
 * из pageService/subPageService. Вызываются ТОЛЬКО через них, по
 * переключателю `rowsBackendOf(workspaceId)`, поэтому остальной код не знает,
 * где лежат строки.
 *
 * `tab` — id вкладки или null для «Основной»; в базе «Основная» — ''.
 */

type Cells = PageRow["cells"];

interface DeskRowRecord {
  workspace_id: string;
  page_id: string;
  tab_id: string;
  id: string;
  cells: Cells | null;
  extras: PageRow["extras"] | null;
  attachments: RowAttachment[] | null;
  sort_order: number;
  height: number | null;
  created_at: number;
  updated_at: number;
  filled_at: number | null;
  order_id: string | null;
  highlight: boolean;
}

/**
 * Ошибка Supabase с кодом в духе Firestore — чтобы `firestoreErrorText` и
 * прочие места, что показывают отказ человеку, объясняли его так же понятно:
 * «не хватает прав», «нет связи».
 */
export class RowsStoreError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

function toStoreError(error: { message?: string; code?: string; status?: number } | null, fallback: string): RowsStoreError {
  const raw = error?.code ?? "";
  const message = error?.message || fallback;
  // 42501 — политика RLS; PGRST301/302 — Supabase не принял токен.
  if (raw === "42501") return new RowsStoreError(message, "permission-denied");
  if (raw === "PGRST301" || raw === "PGRST302" || error?.status === 401) return new RowsStoreError(message, "unauthenticated");
  if (/fetch|network|Failed to fetch|NetworkError/i.test(message)) return new RowsStoreError(message, "unavailable");
  return new RowsStoreError(message, raw ? `supabase-${raw}` : "supabase");
}

function tabKey(tab: string | null | undefined): string {
  return tab ?? "";
}

export function recordToRow(record: DeskRowRecord): PageRow {
  const row: PageRow = {
    id: record.id,
    // Как у документов Firestore: у строки вкладки pageId — id вкладки.
    pageId: record.tab_id || record.page_id,
    cells: (record.cells ?? {}) as Cells,
    order: Number(record.sort_order) || 0,
    createdAt: Number(record.created_at) || 0,
    updatedAt: Number(record.updated_at) || 0,
  };
  if (Array.isArray(record.attachments)) row.attachments = record.attachments;
  if (record.height != null) row.height = Number(record.height);
  if (record.filled_at != null) row.filledAt = Number(record.filled_at);
  if (record.extras) row.extras = record.extras;
  if (record.order_id) row.orderId = record.order_id;
  if (record.highlight) row.highlight = true;
  return row;
}

export function rowToRecord(workspaceId: string, pageId: string, tab: string | null, row: PageRow): DeskRowRecord {
  return {
    workspace_id: workspaceId,
    page_id: pageId,
    tab_id: tabKey(tab),
    id: row.id,
    cells: row.cells ?? {},
    extras: row.extras ?? null,
    attachments: row.attachments ?? null,
    sort_order: typeof row.order === "number" && Number.isFinite(row.order) ? row.order : 0,
    height: typeof row.height === "number" ? row.height : null,
    created_at: typeof row.createdAt === "number" ? row.createdAt : Date.now(),
    updated_at: typeof row.updatedAt === "number" ? row.updatedAt : Date.now(),
    filled_at: typeof row.filledAt === "number" ? row.filledAt : null,
    order_id: row.orderId ?? null,
    highlight: Boolean(row.highlight),
  };
}

// ---------------------------------------------------------------------------
// Чтение
// ---------------------------------------------------------------------------

/** PostgREST отдаёт не больше 1000 строк за запрос — длинный стол читается страницами. */
const PAGE_SIZE = 1000;

async function fetchPaged(
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message?: string; code?: string } | null }>
): Promise<DeskRowRecord[]> {
  const out: DeskRowRecord[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) throw toStoreError(error, "Не удалось прочитать строки");
    const chunk = (data ?? []) as DeskRowRecord[];
    out.push(...chunk);
    if (chunk.length < PAGE_SIZE) return out;
  }
}

/** Строки одной таблицы по порядку — как `fetchRows`/`fetchSubPageRows`. */
export async function sbFetchRows(workspaceId: string, pageId: string, tab: string | null): Promise<PageRow[]> {
  const records = await fetchPaged((from, to) =>
    supabaseRows
      .from(DESK_ROWS_TABLE)
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("page_id", pageId)
      .eq("tab_id", tabKey(tab))
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
  );
  return records.map(recordToRow);
}

/** Строки таблицы, у которых поле (created_at / filled_at) не раньше `since`. */
export async function sbFetchRowsSince(
  workspaceId: string,
  pageId: string,
  tab: string | null,
  field: "created_at" | "filled_at",
  since: number
): Promise<PageRow[]> {
  const records = await fetchPaged((from, to) =>
    supabaseRows
      .from(DESK_ROWS_TABLE)
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("page_id", pageId)
      .eq("tab_id", tabKey(tab))
      .gte(field, since)
      .order("id", { ascending: true })
      .range(from, to)
  );
  return records.map(recordToRow);
}

/** Все строки стола, по таблицам: '' — «Основная», иначе id вкладки. */
export async function sbFetchAllPageRows(workspaceId: string, pageId: string): Promise<Map<string, PageRow[]>> {
  const records = await fetchPaged((from, to) =>
    supabaseRows
      .from(DESK_ROWS_TABLE)
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("page_id", pageId)
      .order("tab_id", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
  );
  const byTab = new Map<string, PageRow[]>();
  for (const record of records) {
    const list = byTab.get(record.tab_id) ?? [];
    list.push(recordToRow(record));
    byTab.set(record.tab_id, list);
  }
  return byTab;
}

export interface PageAccess {
  canRead: boolean;
  canEdit: boolean;
  /** Запись о правах стола уже доехала в Supabase. */
  hasAcl: boolean;
}

/** Отличает «строк нет» от «права ещё не доехали» — политика в обоих случаях отдаёт пустоту. */
export async function sbPageAccess(workspaceId: string, pageId: string): Promise<PageAccess> {
  const { data, error } = await supabaseRows.rpc("rows_page_access", { p_workspace: workspaceId, p_page: pageId });
  if (error) throw toStoreError(error, "Не удалось проверить доступ к столу");
  const value = (data ?? {}) as Partial<PageAccess>;
  return { canRead: Boolean(value.canRead), canEdit: Boolean(value.canEdit), hasAcl: Boolean(value.hasAcl) };
}

// ---------------------------------------------------------------------------
// Живые строки
// ---------------------------------------------------------------------------

interface RealtimePayload {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: Partial<DeskRowRecord>;
  old: Partial<DeskRowRecord>;
}

type RowsMap = Map<string, PageRow>;
type Op = (rows: RowsMap) => void;

/**
 * Правка, ещё не подтверждённая тем, что таблица видит с сервера.
 *
 * С Firestore правка появлялась в таблице сразу (SDK сам показывает свою
 * запись до ответа сервера), и `DataTable` на это рассчитан — своего
 * «оптимистичного» слоя у него нет. Здесь то же делаем сами: правка ложится
 * поверх серверных строк сразу, а уходит, когда сервер её показал — событием
 * Realtime по каждой затронутой строке или свежей выборкой. Без этого, если
 * Realtime не подключился, введённое значение откатывалось бы до возврата на
 * вкладку, и человек вбивал бы его заново.
 */
interface Overlay {
  op: Op;
  /** Строки, событий по которым ждём; null — всей таблицы (ждём выборку). */
  remaining: Set<string> | null;
  /** Когда запись подтвердил сервер; null — ещё в пути. */
  committedAt: number | null;
}

/** Подтверждённая правка держится поверх не дольше этого — дальше верим серверу. */
const OVERLAY_TTL_MS = 5000;

interface LiveTable {
  workspaceId: string;
  pageId: string;
  tabId: string;
  overlays: Map<number, Overlay>;
  pending: number;
  refresh: () => void;
  /** Запись в этой таблице завершилась (успешно или нет). */
  settled: () => void;
  reload: () => void;
}

const liveTables = new Set<LiveTable>();
let opSeq = 0;

function tablesFor(workspaceId: string, pageId: string, tab: string | null | undefined): LiveTable[] {
  return [...liveTables].filter(
    (t) => t.workspaceId === workspaceId && t.pageId === pageId && (tab === undefined || t.tabId === tabKey(tab))
  );
}

/**
 * Запись с немедленным показом: `op` ложится поверх строк у всех открытых
 * подписок этой таблицы, `write` уходит в базу. Отказ — правка снимается и
 * таблица перечитывается (а ошибка идёт дальше, к тому, кто её покажет).
 */
async function optimistic<T>(
  workspaceId: string,
  pageId: string,
  tab: string | null | undefined,
  op: Op,
  rowIds: string[] | null,
  write: () => Promise<T>
): Promise<T> {
  const id = ++opSeq;
  const targets = tablesFor(workspaceId, pageId, tab);
  for (const t of targets) {
    t.overlays.set(id, { op, remaining: rowIds ? new Set(rowIds) : null, committedAt: null });
    t.pending += 1;
    t.refresh();
  }
  try {
    const result = await write();
    for (const t of targets) {
      const overlay = t.overlays.get(id);
      if (overlay) overlay.committedAt = Date.now();
    }
    return result;
  } catch (error) {
    for (const t of targets) {
      t.overlays.delete(id);
      t.refresh();
      t.reload();
    }
    throw error;
  } finally {
    for (const t of targets) {
      t.pending -= 1;
      t.settled();
    }
  }
}

function applyPatch(row: PageRow, patch: RowPatch, updatedAt: number | null): PageRow {
  const next: PageRow = { ...row, cells: { ...row.cells, ...(patch.cells ?? {}) } };
  if (patch.extras !== undefined) {
    if (patch.extras === null) delete next.extras;
    else next.extras = patch.extras;
  }
  if (patch.highlight !== undefined) {
    if (patch.highlight) next.highlight = true;
    else delete next.highlight;
  }
  if (patch.filledAt !== undefined) next.filledAt = patch.filledAt;
  if (patch.orderId !== undefined) next.orderId = patch.orderId;
  if (patch.attachments !== undefined) next.attachments = patch.attachments;
  if (patch.height !== undefined) next.height = patch.height;
  if (updatedAt !== null) next.updatedAt = updatedAt;
  return next;
}

/**
 * Живые строки таблицы: полная выборка + изменения через Realtime + свои
 * правки поверх (см. Overlay).
 *
 * События применяются в порядке ПРИХОДА — так их и отдаёт Postgres, в порядке
 * фиксации. Сравнивать `updated_at` нельзя: это `Date.now()` разных
 * устройств, и отстающие часы у одного человека выбрасывали бы его правки у
 * всех остальных. Событие, пришедшее, пока идёт выборка, не накладывается на
 * неё (выборка могла оказаться и новее, и старее) — выборка просто
 * повторяется.
 *
 * Удаления слушаются ОТДЕЛЬНО и без фильтра: в Supabase фильтр по столбцу на
 * DELETE не действует, и отфильтрованная подписка удалений не получает —
 * удалённая строка возвращалась бы при следующем событии. В событии удаления
 * только первичный ключ (workspace, стол, вкладка, id) — по нему и сверяем.
 *
 * Выборка делается при каждом (пере)подключении канала, при возврате на
 * вкладку и после своих правок, если канал не подключён. Не прочиталось —
 * `onError` и повтор через 3 → 6 → … 30 с; строк прошлой таблицы при этом
 * никто не увидит — `onData` просто не зовётся.
 */
export function sbSubscribeRows(
  workspaceId: string,
  pageId: string,
  tab: string | null,
  onData: (rows: PageRow[], fromServer: boolean) => void,
  onError?: (error: RowsStoreError) => void
): () => void {
  const tabId = tabKey(tab);
  let cancelled = false;
  let loaded = false;
  let serverRows: RowsMap = new Map();
  let loading = false;
  let reloadQueued = false;
  let channelHealthy = false;
  let retryDelay = 3000;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let reloadTimer: ReturnType<typeof setTimeout> | null = null;
  let sweepTimer: ReturnType<typeof setTimeout> | null = null;

  const inScope = (record: Partial<DeskRowRecord>) =>
    record.workspace_id === workspaceId && record.page_id === pageId && (record.tab_id ?? "") === tabId;

  const table: LiveTable = {
    workspaceId,
    pageId,
    tabId,
    overlays: new Map(),
    pending: 0,
    refresh: () => emit(),
    settled: () => {
      scheduleSweep();
      // Канал не подключён — события не придут, правку подтвердит выборка.
      if (table.pending === 0 && !channelHealthy) scheduleReload();
    },
    reload: () => void load(),
  };

  function emit() {
    if (cancelled || !loaded) return;
    const view: RowsMap = new Map(serverRows);
    for (const id of [...table.overlays.keys()].sort((a, b) => a - b)) table.overlays.get(id)!.op(view);
    onData([...view.values()].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt), true);
  }

  function dropConfirmed(rowId: string) {
    for (const [id, overlay] of table.overlays) {
      if (overlay.committedAt === null || !overlay.remaining) continue;
      overlay.remaining.delete(rowId);
      if (overlay.remaining.size === 0) table.overlays.delete(id);
    }
  }

  function scheduleSweep() {
    if (sweepTimer) return;
    sweepTimer = setTimeout(() => {
      sweepTimer = null;
      const now = Date.now();
      let changed = false;
      for (const [id, overlay] of table.overlays) {
        if (overlay.committedAt !== null && now - overlay.committedAt >= OVERLAY_TTL_MS) {
          table.overlays.delete(id);
          changed = true;
        }
      }
      if (changed) emit();
      if ([...table.overlays.values()].some((o) => o.committedAt !== null)) scheduleSweep();
    }, OVERLAY_TTL_MS);
  }

  function scheduleReload() {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      if (table.pending === 0) void load();
    }, 300);
  }

  function apply(payload: RealtimePayload): boolean {
    if (payload.eventType === "DELETE") {
      const old = payload.old;
      if (!old.id || !inScope(old)) return false;
      dropConfirmed(old.id);
      return serverRows.delete(old.id);
    }
    const next = payload.new;
    if (!next.id || !inScope(next)) return false;
    serverRows.set(next.id, recordToRow(next as DeskRowRecord));
    dropConfirmed(next.id);
    return true;
  }

  function onEvent(payload: unknown) {
    if (cancelled) return;
    if (loading) {
      reloadQueued = true;
      return;
    }
    if (apply(payload as RealtimePayload)) emit();
  }

  async function load() {
    if (cancelled) return;
    if (loading) {
      reloadQueued = true;
      return;
    }
    loading = true;
    reloadQueued = false;
    // Подтверждённые ДО начала выборки правки выборка уже содержит.
    const confirmedBefore = [...table.overlays].filter(([, o]) => o.committedAt !== null).map(([id]) => id);
    try {
      const rows = await sbFetchRows(workspaceId, pageId, tab);
      if (cancelled) return;
      serverRows = new Map(rows.map((row) => [row.id, row]));
      for (const id of confirmedBefore) table.overlays.delete(id);
      loaded = true;
      retryDelay = 3000;
      emit();
    } catch (error) {
      if (cancelled) return;
      onError?.(error instanceof RowsStoreError ? error : toStoreError(null, String(error)));
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void load();
      }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30_000);
    } finally {
      loading = false;
      if (reloadQueued && !cancelled) void load();
    }
  }

  liveTables.add(table);

  const channel: RealtimeChannel = supabaseRows
    .channel(`desk_rows:${workspaceId}:${pageId}:${tabId || "main"}:${Math.random().toString(36).slice(2)}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: DESK_ROWS_TABLE, filter: `page_id=eq.${pageId}` },
      onEvent
    )
    .on("postgres_changes", { event: "DELETE", schema: "public", table: DESK_ROWS_TABLE }, onEvent)
    .subscribe((status) => {
      channelHealthy = status === "SUBSCRIBED";
      // Первое подключение и каждое переподключение — полная выборка.
      if (status === "SUBSCRIBED") void load();
    });

  // Выборка сразу, не дожидаясь канала: Realtime может и не подключиться
  // (сеть, расширения), а таблица должна открыться всё равно.
  void load();

  const onVisible = () => {
    if (document.visibilityState === "visible") void load();
  };
  document.addEventListener("visibilitychange", onVisible);

  return () => {
    cancelled = true;
    liveTables.delete(table);
    for (const timer of [retryTimer, reloadTimer, sweepTimer]) if (timer) clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisible);
    void supabaseRows.removeChannel(channel);
  };
}

// ---------------------------------------------------------------------------
// Запись — каждая сразу видна в открытой таблице (см. optimistic).
// ---------------------------------------------------------------------------

/** Строка целиком — как setDoc без merge (новая строка, копия, повтор заезда заказа). */
export async function sbPutRow(workspaceId: string, pageId: string, tab: string | null, row: PageRow): Promise<void> {
  await sbPutRows(workspaceId, pageId, tab, [row]);
}

const UPSERT_CHUNK = 500;

export async function sbPutRows(workspaceId: string, pageId: string, tab: string | null, rows: PageRow[]): Promise<void> {
  if (rows.length === 0) return;
  const pageRowId = tab ?? pageId;
  await optimistic(
    workspaceId,
    pageId,
    tab,
    (map) => {
      for (const row of rows) map.set(row.id, { ...row, pageId: pageRowId });
    },
    rows.map((row) => row.id),
    async () => {
      for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
        const slice = rows.slice(i, i + UPSERT_CHUNK).map((row) => rowToRecord(workspaceId, pageId, tab, row));
        const { error } = await supabaseRows.from(DESK_ROWS_TABLE).upsert(slice, { onConflict: DESK_ROWS_CONFLICT });
        if (error) throw toStoreError(error, "Не удалось сохранить строки");
      }
    }
  );
}

export interface RowPatch {
  cells?: Cells;
  /** undefined — визитку не трогать, null — убрать, объект — заменить. */
  extras?: PageRow["extras"] | null;
  /** true — подсветить, false — снять, undefined — не трогать. */
  highlight?: boolean;
  filledAt?: number;
  orderId?: string;
  /** undefined — вложения не трогать. */
  attachments?: RowAttachment[];
  height?: number;
  /** Время правки; по умолчанию — сейчас. Высоту строки время правки не сдвигает. */
  updatedAt?: number;
}

/**
 * Правка строки слиянием — как setDoc(..., { merge: true }). Слияние ячеек
 * делает САМА база (`rows_patch`), одним оператором: две быстрые правки
 * одной строки не затирают друг друга.
 */
export async function sbPatchRow(
  workspaceId: string,
  pageId: string,
  tab: string | null,
  rowId: string,
  patch: RowPatch
): Promise<void> {
  const onlyHeight =
    patch.height !== undefined &&
    patch.cells === undefined &&
    patch.extras === undefined &&
    patch.highlight === undefined &&
    patch.filledAt === undefined &&
    patch.orderId === undefined &&
    patch.attachments === undefined;
  const updatedAt = onlyHeight ? null : (patch.updatedAt ?? Date.now());
  await optimistic(
    workspaceId,
    pageId,
    tab,
    (map) => {
      // Строки нет на экране — показывать нечего (база её заведёт, придёт событием).
      const row = map.get(rowId);
      if (row) map.set(rowId, applyPatch(row, patch, updatedAt));
    },
    [rowId],
    async () => {
      const { error } = await supabaseRows.rpc("rows_patch", {
        p_workspace: workspaceId,
        p_page: pageId,
        p_tab: tabKey(tab),
        p_id: rowId,
        p_cells: patch.cells ?? {},
        p_updated_at: updatedAt,
        p_filled_at: patch.filledAt ?? null,
        p_extras_mode: patch.extras === undefined ? "keep" : patch.extras === null ? "clear" : "set",
        p_extras: patch.extras ?? null,
        p_highlight: patch.highlight ?? null,
        p_order_id: patch.orderId ?? null,
        p_attachments_set: patch.attachments !== undefined,
        p_attachments: patch.attachments ?? null,
        p_height: patch.height ?? null,
      });
      if (error) throw toStoreError(error, "Не удалось сохранить строку");
    }
  );
}

export async function sbDeleteRow(workspaceId: string, pageId: string, tab: string | null, rowId: string): Promise<void> {
  await optimistic(
    workspaceId,
    pageId,
    tab,
    (map) => {
      map.delete(rowId);
    },
    [rowId],
    async () => {
      const { error } = await supabaseRows
        .from(DESK_ROWS_TABLE)
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("page_id", pageId)
        .eq("tab_id", tabKey(tab))
        .eq("id", rowId);
      if (error) throw toStoreError(error, "Не удалось удалить строку");
    }
  );
}

/** Все строки вкладки (tab) или всего стола (tab = undefined). */
export async function sbDeleteRows(workspaceId: string, pageId: string, tab?: string | null): Promise<void> {
  await optimistic(
    workspaceId,
    pageId,
    tab,
    (map) => map.clear(),
    null,
    async () => {
      let query = supabaseRows.from(DESK_ROWS_TABLE).delete().eq("workspace_id", workspaceId).eq("page_id", pageId);
      if (tab !== undefined) query = query.eq("tab_id", tabKey(tab));
      const { error } = await query;
      if (error) throw toStoreError(error, "Не удалось удалить строки");
    }
  );
}

/** Порядок строк таблицы: база пишет только сдвинувшиеся. */
export async function sbSetOrder(workspaceId: string, pageId: string, tab: string | null, orderedRowIds: string[]): Promise<void> {
  await optimistic(
    workspaceId,
    pageId,
    tab,
    (map) => {
      orderedRowIds.forEach((id, index) => {
        const row = map.get(id);
        if (row && row.order !== index) map.set(id, { ...row, order: index });
      });
    },
    // Событие придёт только по сдвинувшимся строкам — ждём остальное по сроку (OVERLAY_TTL_MS).
    orderedRowIds,
    async () => {
      const { error } = await supabaseRows.rpc("rows_set_order", {
        p_workspace: workspaceId,
        p_page: pageId,
        p_tab: tabKey(tab),
        p_ids: orderedRowIds,
      });
      if (error) throw toStoreError(error, "Не удалось сохранить порядок строк");
    }
  );
}

export async function sbClearHighlights(workspaceId: string, pageId: string, tab: string | null, rowIds: string[]): Promise<void> {
  if (rowIds.length === 0) return;
  const now = Date.now();
  await optimistic(
    workspaceId,
    pageId,
    tab,
    (map) => {
      for (const id of rowIds) {
        const row = map.get(id);
        if (row?.highlight) {
          const next = { ...row, updatedAt: now };
          delete next.highlight;
          map.set(id, next);
        }
      }
    },
    rowIds,
    async () => {
      const { error } = await supabaseRows
        .from(DESK_ROWS_TABLE)
        .update({ highlight: false, updated_at: now })
        .eq("workspace_id", workspaceId)
        .eq("page_id", pageId)
        .eq("tab_id", tabKey(tab))
        .in("id", rowIds);
      if (error) throw toStoreError(error, "Не удалось снять подсветку");
    }
  );
}
