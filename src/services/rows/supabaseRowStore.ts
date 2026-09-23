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

/**
 * Живые строки таблицы: полная выборка + изменения через Realtime.
 *
 * Выборка делается при КАЖДОМ (пере)подключении канала и при возврате на
 * вкладку: Realtime не хранит пропущенное, а выборка здесь квоты не стоит, —
 * так пропуск события на плохой связи чинится сам. События, пришедшие, пока
 * выборка в пути, копятся и накладываются поверх неё, если они не старше.
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
  let rowsById = new Map<string, PageRow>();
  let loading = false;
  let reloadQueued = false;
  let pending: RealtimePayload[] = [];

  const emit = () => {
    if (cancelled) return;
    onData([...rowsById.values()].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt), true);
  };

  const inScope = (record: Partial<DeskRowRecord>) =>
    record.workspace_id === workspaceId && record.page_id === pageId && (record.tab_id ?? "") === tabId;

  const apply = (payload: RealtimePayload): boolean => {
    if (payload.eventType === "DELETE") {
      const old = payload.old;
      if (!old.id || (old.page_id !== undefined && !inScope(old))) return false;
      return rowsById.delete(old.id);
    }
    const next = payload.new;
    if (!next.id || !inScope(next)) return false;
    const current = rowsById.get(next.id);
    const row = recordToRow(next as DeskRowRecord);
    if (current && current.updatedAt > row.updatedAt) return false;
    rowsById.set(row.id, row);
    return true;
  };

  const load = async () => {
    if (loading) {
      reloadQueued = true;
      return;
    }
    loading = true;
    pending = [];
    try {
      const rows = await sbFetchRows(workspaceId, pageId, tab);
      if (cancelled) return;
      rowsById = new Map(rows.map((row) => [row.id, row]));
      const buffered = pending;
      pending = [];
      buffered.forEach(apply);
      emit();
    } catch (error) {
      if (!cancelled) onError?.(error instanceof RowsStoreError ? error : toStoreError(null, String(error)));
    } finally {
      loading = false;
      if (reloadQueued && !cancelled) {
        reloadQueued = false;
        void load();
      }
    }
  };

  const channel: RealtimeChannel = supabaseRows
    .channel(`desk_rows:${workspaceId}:${pageId}:${tabId || "main"}:${Math.random().toString(36).slice(2)}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: DESK_ROWS_TABLE, filter: `page_id=eq.${pageId}` },
      (payload) => {
        if (cancelled) return;
        const event = payload as unknown as RealtimePayload;
        if (loading) {
          pending.push(event);
          return;
        }
        if (apply(event)) emit();
      }
    )
    .subscribe((status) => {
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
    document.removeEventListener("visibilitychange", onVisible);
    void supabaseRows.removeChannel(channel);
  };
}

// ---------------------------------------------------------------------------
// Запись
// ---------------------------------------------------------------------------

/** Строка целиком — как setDoc без merge (новая строка, копия, повтор заезда заказа). */
export async function sbPutRow(workspaceId: string, pageId: string, tab: string | null, row: PageRow): Promise<void> {
  await sbPutRows(workspaceId, pageId, tab, [row]);
}

const UPSERT_CHUNK = 500;

export async function sbPutRows(workspaceId: string, pageId: string, tab: string | null, rows: PageRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const slice = rows.slice(i, i + UPSERT_CHUNK).map((row) => rowToRecord(workspaceId, pageId, tab, row));
    const { error } = await supabaseRows.from(DESK_ROWS_TABLE).upsert(slice, { onConflict: DESK_ROWS_CONFLICT });
    if (error) throw toStoreError(error, "Не удалось сохранить строки");
  }
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
  const { error } = await supabaseRows.rpc("rows_patch", {
    p_workspace: workspaceId,
    p_page: pageId,
    p_tab: tabKey(tab),
    p_id: rowId,
    p_cells: patch.cells ?? {},
    p_updated_at: onlyHeight ? null : (patch.updatedAt ?? Date.now()),
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

export async function sbDeleteRow(workspaceId: string, pageId: string, tab: string | null, rowId: string): Promise<void> {
  const { error } = await supabaseRows
    .from(DESK_ROWS_TABLE)
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("page_id", pageId)
    .eq("tab_id", tabKey(tab))
    .eq("id", rowId);
  if (error) throw toStoreError(error, "Не удалось удалить строку");
}

/** Все строки вкладки (tab) или всего стола (tab = undefined). */
export async function sbDeleteRows(workspaceId: string, pageId: string, tab?: string | null): Promise<void> {
  let query = supabaseRows.from(DESK_ROWS_TABLE).delete().eq("workspace_id", workspaceId).eq("page_id", pageId);
  if (tab !== undefined) query = query.eq("tab_id", tabKey(tab));
  const { error } = await query;
  if (error) throw toStoreError(error, "Не удалось удалить строки");
}

/** Порядок строк таблицы: база пишет только сдвинувшиеся. */
export async function sbSetOrder(workspaceId: string, pageId: string, tab: string | null, orderedRowIds: string[]): Promise<void> {
  const { error } = await supabaseRows.rpc("rows_set_order", {
    p_workspace: workspaceId,
    p_page: pageId,
    p_tab: tabKey(tab),
    p_ids: orderedRowIds,
  });
  if (error) throw toStoreError(error, "Не удалось сохранить порядок строк");
}

export async function sbClearHighlights(workspaceId: string, pageId: string, tab: string | null, rowIds: string[]): Promise<void> {
  if (rowIds.length === 0) return;
  const { error } = await supabaseRows
    .from(DESK_ROWS_TABLE)
    .update({ highlight: false, updated_at: Date.now() })
    .eq("workspace_id", workspaceId)
    .eq("page_id", pageId)
    .eq("tab_id", tabKey(tab))
    .in("id", rowIds);
  if (error) throw toStoreError(error, "Не удалось снять подсветку");
}
