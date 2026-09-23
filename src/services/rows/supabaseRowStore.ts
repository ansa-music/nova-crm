import type { RealtimeChannel } from "@supabase/supabase-js";
import { DESK_ROWS_CONFLICT, DESK_ROWS_TABLE, supabaseRows } from "@/lib/supabaseRows";
import { toast } from "@/components/ui/sonner";
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
  // Строка-заказ: её ведёт ОС (см. PageRow.osUid).
  os_uid: string | null;
  tech_uid: string | null;
  status_key: string | null;
  src_page_id: string | null;
  src_tab_id: string | null;
  src_row_id: string | null;
  mirror_page_id: string | null;
  mirror_tab_id: string | null;
  mirror_row_id: string | null;
  sync_hash: string | null;
  success_requested_at: number | null;
  success_requested_by: string | null;
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
  row.deskPageId = record.page_id;
  row.tabId = record.tab_id ?? "";
  if (Array.isArray(record.attachments)) row.attachments = record.attachments;
  if (record.height != null) row.height = Number(record.height);
  if (record.filled_at != null) row.filledAt = Number(record.filled_at);
  if (record.extras) row.extras = record.extras;
  if (record.order_id) row.orderId = record.order_id;
  if (record.highlight) row.highlight = true;
  if (record.os_uid) row.osUid = record.os_uid;
  if (record.tech_uid) row.techUid = record.tech_uid;
  if (record.status_key) row.statusKey = record.status_key;
  if (record.src_page_id) row.srcPageId = record.src_page_id;
  if (record.src_tab_id != null) row.srcTabId = record.src_tab_id;
  if (record.src_row_id) row.srcRowId = record.src_row_id;
  if (record.mirror_page_id) row.mirrorPageId = record.mirror_page_id;
  if (record.mirror_tab_id != null) row.mirrorTabId = record.mirror_tab_id;
  if (record.mirror_row_id) row.mirrorRowId = record.mirror_row_id;
  if (record.sync_hash) row.syncHash = record.sync_hash;
  if (record.success_requested_at != null) row.successRequestedAt = Number(record.success_requested_at);
  if (record.success_requested_by) row.successRequestedBy = record.success_requested_by;
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
    os_uid: row.osUid ?? null,
    tech_uid: row.techUid ?? null,
    status_key: row.statusKey ?? null,
    src_page_id: row.srcPageId ?? null,
    src_tab_id: row.srcTabId ?? null,
    src_row_id: row.srcRowId ?? null,
    mirror_page_id: row.mirrorPageId ?? null,
    mirror_tab_id: row.mirrorTabId ?? null,
    mirror_row_id: row.mirrorRowId ?? null,
    sync_hash: row.syncHash ?? null,
    success_requested_at: row.successRequestedAt ?? null,
    success_requested_by: row.successRequestedBy ?? null,
  };
}

// ---------------------------------------------------------------------------
// Чтение
// ---------------------------------------------------------------------------

/** PostgREST отдаёт не больше 1000 строк за запрос — длинный стол читается страницами. */
/** Сколько ждём переподключения канала, прежде чем сказать человеку. */
const LIVE_WARN_AFTER_MS = 15_000;
/**
 * Страховка живых строк: пока канал Realtime не подключён, стол раз в столько
 * спрашивает отметку своей таблицы (`rows_table_stamp`: число строк + хеш) и
 * перечитывает строки, только если она сменилась. Отметка — десятки байт, а
 * полная выборка на каждый тик съела бы месячный трафик Supabase.
 */
const STAMP_POLL_MS = 15_000;

/**
 * Отметка таблицы или null, если в базе ещё нет функции (SQL не накатан):
 * тогда страховки просто нет, а стол работает как раньше.
 */
async function fetchTableStamp(workspaceId: string, pageId: string, tabId: string): Promise<string | null> {
  const { data, error } = await supabaseRows.rpc("rows_table_stamp", {
    p_workspace: workspaceId,
    p_page: pageId,
    p_tab: tabId,
  });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") return null;
    throw toStoreError(error, "Не удалось сверить таблицу");
  }
  return typeof data === "string" ? data : null;
}

const PAGE_SIZE = 1000;

type PagedResult = PromiseLike<{
  data: unknown[] | null;
  error: { message?: string; code?: string } | null;
  count?: number | null;
}>;

/**
 * Все строки запроса страницами. Первый запрос спрашивает и общее число
 * (`count: exact`), и чтение идёт, пока не набрано столько: потолок строк на
 * запрос задаёт настройка проекта Supabase (`max_rows`), и если её поставят
 * меньше 1000, «пришло меньше страницы» перестанет значить «это всё» — стол
 * молча обрезался бы. Без числа (старый PostgREST) — по короткой странице.
 */
async function fetchPaged(build: (from: number, to: number, withCount: boolean) => PagedResult): Promise<DeskRowRecord[]> {
  const out: DeskRowRecord[] = [];
  let total: number | null = null;
  for (let from = 0; ; ) {
    const { data, error, count } = await build(from, from + PAGE_SIZE - 1, from === 0);
    if (error) throw toStoreError(error, "Не удалось прочитать строки");
    if (from === 0 && typeof count === "number") total = count;
    const chunk = (data ?? []) as DeskRowRecord[];
    out.push(...chunk);
    from += chunk.length;
    if (chunk.length === 0) return out;
    if (total !== null ? out.length >= total : chunk.length < PAGE_SIZE) return out;
  }
}

function selectRows(withCount: boolean) {
  return supabaseRows.from(DESK_ROWS_TABLE).select("*", withCount ? { count: "exact" } : undefined);
}

interface FetchOptions {
  /**
   * Пустая выборка — сверить права (по умолчанию да). Политика отдаёт пустоту
   * и когда строк нет, и когда стол читать нельзя; Firestore во втором случае
   * бросал `permission-denied`, и код, что читает строки (бэкап, копия
   * вкладки, сводка «Столов ОС»), на этот отказ и рассчитан — пустой список
   * он принял бы за пустой стол.
   */
  assertAccess?: boolean;
}

async function assertReadable(workspaceId: string, pageId: string) {
  const access = await sbPageAccess(workspaceId, pageId);
  if (!access.canRead) {
    throw new RowsStoreError(
      access.hasAcl ? "Нет доступа к строкам этого стола" : "Права на этот стол ещё не доехали до базы строк",
      access.hasAcl ? "permission-denied" : "unavailable"
    );
  }
}

/** Строки одной таблицы по порядку — как `fetchRows`/`fetchSubPageRows`. */
export async function sbFetchRows(
  workspaceId: string,
  pageId: string,
  tab: string | null,
  options: FetchOptions = {}
): Promise<PageRow[]> {
  const records = await fetchPaged((from, to, withCount) =>
    selectRows(withCount)
      .eq("workspace_id", workspaceId)
      .eq("page_id", pageId)
      .eq("tab_id", tabKey(tab))
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
  );
  if (records.length === 0 && options.assertAccess !== false) await assertReadable(workspaceId, pageId);
  return records.map(recordToRow);
}

/**
 * ВСЕ строки-заказы этого ОС — по всем столам технарей сразу.
 *
 * Политика чтения отдаёт ему ровно строки с его `os_uid`, поэтому один запрос
 * заменяет обход столов (их у технарей полтора десятка) и не требует доступа
 * к самим столам. По нему стол ОС показывает статус каждого заказа и видит,
 * доехала ли правка (`sync_hash`).
 */
export async function sbFetchMyOrderRows(workspaceId: string, osUid: string): Promise<PageRow[]> {
  const records = await fetchPaged((from, to, withCount) =>
    selectRows(withCount)
      .eq("workspace_id", workspaceId)
      .eq("os_uid", osUid)
      .order("updated_at", { ascending: false })
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
  since: number,
  options: FetchOptions = {}
): Promise<PageRow[]> {
  const records = await fetchPaged((from, to, withCount) =>
    selectRows(withCount)
      .eq("workspace_id", workspaceId)
      .eq("page_id", pageId)
      .eq("tab_id", tabKey(tab))
      .gte(field, since)
      .order("id", { ascending: true })
      .range(from, to)
  );
  if (records.length === 0 && options.assertAccess !== false) await assertReadable(workspaceId, pageId);
  return records.map(recordToRow);
}

/** Все строки стола, по таблицам: '' — «Основная», иначе id вкладки. */
export async function sbFetchAllPageRows(
  workspaceId: string,
  pageId: string,
  options: FetchOptions = {}
): Promise<Map<string, PageRow[]>> {
  const records = await fetchPaged((from, to, withCount) =>
    selectRows(withCount)
      .eq("workspace_id", workspaceId)
      .eq("page_id", pageId)
      .order("tab_id", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
  );
  if (records.length === 0 && options.assertAccess !== false) await assertReadable(workspaceId, pageId);
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
/** События Realtime приходят пачками (вставка 200 строк = 200 событий) — перерисовка одна на кадр. */
const EMIT_COALESCE_MS = 16;

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

// ---------------------------------------------------------------------------
// Порядок записей
// ---------------------------------------------------------------------------

/**
 * Записи одной строки уходят в базу СТРОГО по очереди. Firestore SDK сам
 * держит порядок записей; здесь каждая запись — отдельный HTTP-запрос, и два
 * быстрых ввода в одну ячейку могли дойти до базы наоборот: в ячейке
 * оставалось старое значение, а на экране — новое. Разные строки пишутся
 * параллельно (заполнение 100 строк не должно идти 100 запросов подряд), а
 * запись всей таблицы (удаление, порядок) ждёт все записи строк до неё и
 * задерживает все после.
 */
interface WriteLane {
  rows: Map<string, Promise<void>>;
  table: Promise<void> | null;
}

const lanes = new Map<string, WriteLane>();

function laneKey(workspaceId: string, pageId: string, tab: string | null | undefined): string {
  return `${workspaceId}|${pageId}|${tab === undefined ? "*" : tabKey(tab)}`;
}

function sequenced<T>(key: string, rowIds: string[] | null, write: () => Promise<T>): Promise<T> {
  const lane = lanes.get(key) ?? { rows: new Map(), table: null };
  lanes.set(key, lane);
  const before: Promise<void>[] = [];
  if (lane.table) before.push(lane.table);
  if (rowIds) {
    for (const id of rowIds) {
      const prev = lane.rows.get(id);
      if (prev) before.push(prev);
    }
  } else {
    before.push(...lane.rows.values());
  }
  const run = Promise.all(before).then(write);
  const done: Promise<void> = run.then(
    () => undefined,
    () => undefined
  );
  if (rowIds) {
    for (const id of rowIds) lane.rows.set(id, done);
  } else {
    lane.table = done;
    lane.rows.clear();
  }
  void done.then(() => {
    if (rowIds) {
      for (const id of rowIds) if (lane.rows.get(id) === done) lane.rows.delete(id);
    } else if (lane.table === done) {
      lane.table = null;
    }
    if (!lane.table && lane.rows.size === 0 && lanes.get(key) === lane) lanes.delete(key);
  });
  return run;
}

/**
 * Дождаться записей строк, ушедших в базу из ЭТОЙ вкладки. У Supabase нет
 * очереди офлайн-записей, как у Firestore-SDK: перезагрузка страницы посреди
 * запроса обрывает правку. Этим пользуется обновление сайта перед reload.
 */
export async function sbWaitForPendingWrites(): Promise<void> {
  for (let round = 0; round < 5 && lanes.size > 0; round++) {
    const all: Promise<void>[] = [];
    for (const lane of lanes.values()) {
      if (lane.table) all.push(lane.table);
      all.push(...lane.rows.values());
    }
    await Promise.all(all);
  }
}

/**
 * Запись с немедленным показом: `op` ложится поверх строк у всех открытых
 * подписок этой таблицы сразу, `write` уходит в базу в очередь своей строки
 * (см. sequenced). Отказ — правка снимается и таблица перечитывается (а
 * ошибка идёт дальше, к тому, кто её покажет).
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
    const result = await sequenced(laneKey(workspaceId, pageId, tab), rowIds, () => writeWithRetry(write));
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

/**
 * Повтор записи при обрыве связи — 1 → 3 → 7 с, и только на «нет сети».
 *
 * Firestore-SDK держал очередь офлайн-записей: пропала связь на минуту —
 * правка уходила сама, человек ничего не замечал. У Supabase такой очереди
 * нет, `fetch` падает сразу, и каждая кочка в метро оборачивалась бы «не
 * удалось сохранить». Повторять безопасно: все записи идемпотентны (upsert,
 * `rows_patch`, удаление по ключу, `rows_set_order`), а порядок не ломается —
 * повтор идёт ВНУТРИ очереди своей строки (`sequenced`). Отказ прав, квоты
 * или данных не повторяем: он не пройдёт и на третий раз.
 */
const WRITE_RETRY_DELAYS = [1000, 3000, 7000];

async function writeWithRetry<T>(write: () => Promise<T>): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= WRITE_RETRY_DELAYS.length; attempt += 1) {
    try {
      return await write();
    } catch (error) {
      lastError = error;
      const code = (error as { code?: string } | null)?.code;
      if (code !== "unavailable" || attempt === WRITE_RETRY_DELAYS.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, WRITE_RETRY_DELAYS[attempt]));
    }
  }
  throw lastError;
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

/** Поля записи, без которых строку не собрать (у события вставки они есть всегда). */
const REQUIRED_KEYS: (keyof DeskRowRecord)[] = ["cells", "sort_order", "created_at", "updated_at"];

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
 * Событие правки НАКЛАДЫВАЕТСЯ на сохранённую запись строки, а не заменяет
 * её: большое jsonb-значение (ячейки длинной строки, вложения), которое
 * правка не тронула, Postgres хранит отдельно (TOAST) и в событие НЕ кладёт —
 * замена стёрла бы у строки все ячейки до следующей выборки. Нет сохранённой
 * записи и в событии не хватает полей — выборка.
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
  let serverRecords = new Map<string, DeskRowRecord>();
  let serverRows: RowsMap = new Map();
  let loading = false;
  let reloadQueued = false;
  let channelHealthy = false;
  /** Предупредили ли уже, что живой канал не поднялся (один раз на подписку). */
  let liveWarned = false;
  let liveWarnTimer: ReturnType<typeof setTimeout> | null = null;
  let retryDelay = 3000;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let reloadTimer: ReturnType<typeof setTimeout> | null = null;
  let sweepTimer: ReturnType<typeof setTimeout> | null = null;
  let emitTimer: ReturnType<typeof setTimeout> | null = null;
  let stampTimer: ReturnType<typeof setTimeout> | null = null;
  /** Отметка таблицы на момент последней выборки (см. STAMP_POLL_MS). */
  let lastStamp: string | null = null;
  /** В базе нет `rows_table_stamp` — страховку не зовём. */
  let stampMissing = false;

  const inScope = (record: Partial<DeskRowRecord>) =>
    record.workspace_id === workspaceId && record.page_id === pageId && (record.tab_id ?? "") === tabId;

  const table: LiveTable = {
    workspaceId,
    pageId,
    tabId,
    overlays: new Map(),
    pending: 0,
    // Своя правка — сразу, без отложенной перерисовки: ввод должен остаться на экране.
    refresh: () => emit(),
    settled: () => {
      scheduleSweep();
      // Канал не подключён — события не придут, правку подтвердит выборка.
      if (table.pending === 0 && !channelHealthy) scheduleReload();
    },
    reload: () => void load(),
  };

  function emit() {
    if (emitTimer) {
      clearTimeout(emitTimer);
      emitTimer = null;
    }
    if (cancelled || !loaded) return;
    const view: RowsMap = new Map(serverRows);
    for (const id of [...table.overlays.keys()].sort((a, b) => a - b)) table.overlays.get(id)!.op(view);
    onData([...view.values()].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt), true);
  }

  function emitSoon() {
    if (emitTimer) return;
    emitTimer = setTimeout(() => {
      emitTimer = null;
      emit();
    }, EMIT_COALESCE_MS);
  }

  function dropConfirmed(rowId: string) {
    for (const [id, overlay] of table.overlays) {
      if (overlay.committedAt === null || !overlay.remaining) continue;
      overlay.remaining.delete(rowId);
      if (overlay.remaining.size === 0) table.overlays.delete(id);
    }
  }

  function scheduleSweep() {
    // Ушли со стола — таймер ставить некому снимать: запись, начатая до ухода,
    // в своём `finally` зовёт эту функцию уже после очистки подписки.
    if (cancelled || sweepTimer) return;
    sweepTimer = setTimeout(() => {
      sweepTimer = null;
      const now = Date.now();
      let changed = false;
      let unconfirmed = false;
      for (const [id, overlay] of table.overlays) {
        if (overlay.committedAt !== null && now - overlay.committedAt >= OVERLAY_TTL_MS) {
          table.overlays.delete(id);
          changed = true;
          // Сервер так и не показал правку (события потерялись или их не
          // бывает — порядок несдвинутых строк): сверяемся выборкой, а не
          // откатываем экран к тому, что было до правки.
          if (overlay.remaining === null || overlay.remaining.size > 0) unconfirmed = true;
        }
      }
      if (unconfirmed) void load();
      else if (changed) emit();
      if ([...table.overlays.values()].some((o) => o.committedAt !== null)) scheduleSweep();
    }, OVERLAY_TTL_MS);
  }

  function scheduleReload() {
    if (cancelled) return;
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      if (table.pending === 0) void load();
    }, 300);
  }

  /** true — изменились строки; "reload" — события не хватает, нужна выборка. */
  function apply(payload: RealtimePayload): boolean | "reload" {
    if (payload.eventType === "DELETE") {
      const old = payload.old;
      if (!old.id) return false;
      dropConfirmed(old.id);
      serverRecords.delete(old.id);
      return serverRows.delete(old.id);
    }
    const next = payload.new;
    if (!next.id) return false;
    const defined = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)) as Partial<DeskRowRecord>;
    const merged = { ...(serverRecords.get(next.id) ?? {}), ...defined } as DeskRowRecord;
    if (REQUIRED_KEYS.some((key) => merged[key] === undefined)) return "reload";
    serverRecords.set(next.id, merged);
    serverRows.set(next.id, recordToRow(merged));
    dropConfirmed(next.id);
    return true;
  }

  function onEvent(raw: unknown) {
    if (cancelled) return;
    const payload = raw as RealtimePayload;
    // Слушатель удалений без фильтра получает удаления ЧУЖИХ таблиц — они не
    // должны ни менять эту, ни заставлять её перечитываться.
    const record = payload.eventType === "DELETE" ? payload.old : payload.new;
    if (!record || !inScope(record)) return;
    if (loading) {
      reloadQueued = true;
      return;
    }
    const result = apply(payload);
    if (result === "reload") void load();
    else if (result) emitSoon();
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
    // Отметку берём ДО выборки: правка между ними попадёт в строки, а отметка
    // окажется старой — следующий тик лишний раз перечитает, но не пропустит.
    // Наоборот (после выборки) правка между ними потерялась бы до следующей.
    // При живом канале отметка не нужна (события приходят сами) — лишний запрос не делаем.
    const stampBefore =
      stampMissing || channelHealthy ? null : await fetchTableStamp(workspaceId, pageId, tabId).catch(() => null);
    try {
      // Пустой стол без прав здесь не ошибка: «права ещё не доехали» различает
      // сама страница (usePageRows → sbPageAccess), не дёргая проверку на каждом повторе.
      const records = await fetchTableRecords();
      if (cancelled) return;
      serverRecords = new Map(records.map((record) => [record.id, record]));
      serverRows = new Map(records.map((record) => [record.id, recordToRow(record)]));
      lastStamp = stampBefore;
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

  function fetchTableRecords(): Promise<DeskRowRecord[]> {
    return fetchPaged((from, to, withCount) =>
      selectRows(withCount)
        .eq("workspace_id", workspaceId)
        .eq("page_id", pageId)
        .eq("tab_id", tabId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
    );
  }

  /**
   * Тик страховки: только пока канал НЕ подключён, вкладка на виду, таблица
   * загружена и своих записей в пути нет (иначе отметка менялась бы от своих
   * же правок). При живом канале события и так приходят — лишние запросы ни к чему.
   */
  function scheduleStampCheck() {
    if (cancelled || stampMissing) return;
    if (stampTimer) clearTimeout(stampTimer);
    stampTimer = setTimeout(() => {
      stampTimer = null;
      void checkStamp().finally(scheduleStampCheck);
    }, STAMP_POLL_MS);
  }

  async function checkStamp() {
    if (cancelled || channelHealthy || !loaded || loading || table.pending > 0) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    try {
      const stamp = await fetchTableStamp(workspaceId, pageId, tabId);
      if (cancelled) return;
      if (stamp === null) {
        stampMissing = true;
        return;
      }
      if (stamp !== lastStamp) void load();
    } catch {
      // Нет связи — следующий тик попробует снова; выборка своё сообщит сама.
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
      if (status === "SUBSCRIBED") {
        if (liveWarnTimer) {
          clearTimeout(liveWarnTimer);
          liveWarnTimer = null;
        }
        void load();
        return;
      }
      // Канал не поднялся. Молчать нельзя: свои правки видно (после них
      // таблица перечитывается), а ЧУЖИЕ не появятся вовсе, и человек будет
      // думать, что коллега ничего не сделал. Ждём 15 с — phoenix сам
      // переподключается, и без выдержки предупреждение мигало бы постоянно.
      if (cancelled || liveWarned || liveWarnTimer) return;
      liveWarnTimer = setTimeout(() => {
        liveWarnTimer = null;
        if (cancelled || channelHealthy) return;
        liveWarned = true;
        toast.error("Живое обновление строк не работает", {
          description: stampMissing
            ? "Свои правки сохраняются, а чужие появятся только после обновления страницы."
            : "Свои правки сохраняются, а чужие будут подтягиваться раз в 15 секунд.",
          duration: 8000,
        });
      }, LIVE_WARN_AFTER_MS);
    });

  // Выборка сразу, не дожидаясь канала: Realtime может и не подключиться
  // (сеть, расширения), а таблица должна открыться всё равно.
  void load();
  scheduleStampCheck();

  const onVisible = () => {
    if (document.visibilityState === "visible") void load();
  };
  document.addEventListener("visibilitychange", onVisible);

  return () => {
    cancelled = true;
    liveTables.delete(table);
    for (const timer of [retryTimer, reloadTimer, sweepTimer, emitTimer, liveWarnTimer, stampTimer]) if (timer) clearTimeout(timer);
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
  /**
   * Поля строки-заказа (её ведёт ОС, см. PageRow.osUid). Пишутся только при
   * выдаче заказа и при снятии управления; обычная правка их не передаёт.
   */
  osUid?: string;
  techUid?: string;
  statusKey?: string;
  syncHash?: string;
  srcPageId?: string;
  srcTabId?: string;
  srcRowId?: string;
  successRequestedAt?: number;
  successRequestedBy?: string;
  /** Адрес строки-копии — пишется на строку стола ОС. */
  mirrorPageId?: string;
  mirrorTabId?: string;
  mirrorRowId?: string;
  /** Снять просьбу об «Успешке» (решили — чип гаснет). */
  clearSuccessRequest?: boolean;
  /** Снять управление со строки — только Owner (аварийный выход). */
  releaseOrder?: boolean;
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
        p_os_uid: patch.osUid ?? null,
        p_tech_uid: patch.techUid ?? null,
        p_status_key: patch.statusKey ?? null,
        p_sync_hash: patch.syncHash ?? null,
        p_src_page: patch.srcPageId ?? null,
        p_src_tab: patch.srcTabId ?? null,
        p_src_row: patch.srcRowId ?? null,
        p_success_requested_at: patch.successRequestedAt ?? null,
        p_success_requested_by: patch.successRequestedBy ?? null,
        p_clear_success: patch.clearSuccessRequest ?? false,
        p_mirror_page: patch.mirrorPageId ?? null,
        p_mirror_tab: patch.mirrorTabId ?? null,
        p_mirror_row: patch.mirrorRowId ?? null,
        p_release_order: patch.releaseOrder ?? false,
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

/**
 * Строка, приехавшая в стол технаря с «Заказов», — при удалении самого
 * заказа. Удаляют заказ ОС, Тимлид и Owner, а политики строк первых двоих в
 * чужой стол не пускают (и отказ там молчаливый: удаление просто находит
 * ноль строк), поэтому — функция базы, которая сверяет роль и то, что строка
 * рождена ЭТИМ заказом. false — строки уже нет.
 */
export async function sbDropOrderRow(
  workspaceId: string,
  pageId: string,
  tab: string | null,
  rowId: string,
  orderId: string
): Promise<boolean> {
  const { data, error } = await supabaseRows.rpc("rows_drop_order_row", {
    p_workspace: workspaceId,
    p_page: pageId,
    p_tab: tabKey(tab),
    p_row: rowId,
    p_order: orderId,
  });
  if (error) {
    // Функции нет — SQL 20260926_order_row_drop.sql ещё не накатан.
    if (error.code === "PGRST202" || error.code === "42883") {
      throw new RowsStoreError(
        "В базе строк ещё нет функции удаления строки заказа — накатите SQL (Настройки → Строки таблиц → «Скопировать SQL»)",
        "supabase-missing-function"
      );
    }
    throw toStoreError(error, "Не удалось убрать строку заказа из стола технаря");
  }
  return Boolean(data);
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
