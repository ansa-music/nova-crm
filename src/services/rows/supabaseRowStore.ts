import type { RealtimeChannel } from "@supabase/supabase-js";
import { DESK_ROWS_CONFLICT, DESK_ROWS_TABLE, supabaseRows } from "@/lib/supabaseRows";
import { listenRowsDoorbell, ringRowsDoorbell } from "@/services/rows/rowsDoorbell";
import { dropRowSnapshot, readRowSnapshot, writeRowSnapshot } from "@/services/rows/rowSnapshotCache";
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
  /**
   * Номер правки строки (20260929_desk_rows_rev.sql): ставит триггер базы на
   * каждой вставке и правке. Клиент его НЕ пишет (rowToRecord его не кладёт) —
   * только читает: по нему дочитывается дельта и узнаётся неизменная строка.
   * Нет в записи — SQL ещё не накатан.
   */
  rev?: number | null;
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
 * Плашку «живое обновление не работает» — один раз за загрузку страницы, а не
 * на каждом открытом столе: причина одна на всё приложение (сеть, настройки
 * Realtime), и повтор на каждом столе только пугал.
 */
let liveWarnedOnce = false;
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

/**
 * «Голова» таблицы (20260929_desk_rows_rev.sql): число строк, наибольший
 * `rev` и md5 пар `id:rev` по порядку id. Считается под политиками
 * спрашивающего. Содержимого строк в ней нет — `rev` и так меняется при
 * любой правке, поэтому совпавшая голова значит «у меня ровно то же, что в
 * базе», а разошедшаяся — удаление, обгон фиксаций или сменившиеся права.
 */
interface TableHead {
  count: number;
  rev: number;
  ids: string;
}

interface TableDelta extends TableHead {
  rows: DeskRowRecord[];
  /** Изменений больше лимита — дешевле перечитать таблицу обычной выборкой. */
  more: boolean;
}

/** Нет функции/колонки — SQL 20260929 ещё не накатан, работаем по-старому. */
function isMissingRevSql(error: { code?: string } | null): boolean {
  const code = error?.code ?? "";
  return code === "PGRST202" || code === "42883" || code === "42703" || code === "PGRST204";
}

function parseHead(data: unknown): TableHead | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const value = data as Record<string, unknown>;
  const count = Number(value.count);
  const rev = Number(value.rev);
  if (!Number.isFinite(count) || !Number.isFinite(rev) || typeof value.ids !== "string") return null;
  return { count, rev, ids: value.ids };
}

/** Голова таблицы или null, если в базе нет функции (или ответ не того вида — тогда по-старому). */
async function fetchTableHead(workspaceId: string, pageId: string, tabId: string): Promise<TableHead | null> {
  const { data, error } = await supabaseRows.rpc("rows_table_head", {
    p_workspace: workspaceId,
    p_page: pageId,
    p_tab: tabId,
  });
  if (error) {
    if (isMissingRevSql(error)) return null;
    throw toStoreError(error, "Не удалось сверить таблицу");
  }
  return parseHead(data);
}

/** Сколько изменённых строк берём дельтой; больше — полная выборка. */
const DELTA_LIMIT = 500;

/**
 * Строки с `rev > after` и голова — одним запросом, из одного снимка базы
 * (раздельные запросы расходились бы на правку между ними). null — функции нет.
 */
async function fetchTableDelta(
  workspaceId: string,
  pageId: string,
  tabId: string,
  after: number
): Promise<TableDelta | null> {
  const { data, error } = await supabaseRows.rpc("rows_table_delta", {
    p_workspace: workspaceId,
    p_page: pageId,
    p_tab: tabId,
    p_after: after,
    p_limit: DELTA_LIMIT,
  });
  if (error) {
    if (isMissingRevSql(error)) return null;
    throw toStoreError(error, "Не удалось дочитать строки");
  }
  const head = parseHead(data);
  const value = data as { rows?: unknown; more?: unknown } | null;
  if (!head || !Array.isArray(value?.rows)) return null;
  return { ...head, rows: value.rows as DeskRowRecord[], more: value.more === true };
}

/**
 * Сравнение строк по кодовым точкам — это порядок байт UTF-8, то есть
 * `collate "C"` в голове таблицы. Обычный `<` сравнивает единицы UTF-16 и
 * разошёлся бы с базой на символах за пределами BMP.
 */
function compareCodePoints(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a.codePointAt(i)!;
    const y = b.codePointAt(i)!;
    if (x !== y) return x - y;
    if (x > 0xffff) i++;
  }
  return a.length - b.length;
}

const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11,
  16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

/**
 * md5 строки (в байтах UTF-8) — тот же, что `md5()` в Postgres: им стол
 * сверяет свою голову с головой базы. WebCrypto md5 не умеет, а тащить ради
 * одной функции библиотеку незачем.
 */
export function md5Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const length = bytes.length;
  const blocks = ((length + 8) >>> 6) + 1;
  const words = new Uint32Array(blocks * 16);
  for (let i = 0; i < length; i++) words[i >> 2] |= bytes[i] << ((i % 4) * 8);
  words[length >> 2] |= 0x80 << ((length % 4) * 8);
  words[blocks * 16 - 2] = (length * 8) >>> 0;
  words[blocks * 16 - 1] = Math.floor(length / 0x20000000);
  let a0 = 0x67452301;
  let b0 = 0xefcdab89 | 0;
  let c0 = 0x98badcfe | 0;
  let d0 = 0x10325476;
  for (let block = 0; block < words.length; block += 16) {
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let j = 0; j < 64; j++) {
      let f: number;
      let g: number;
      if (j < 16) {
        f = (b & c) | (~b & d);
        g = j;
      } else if (j < 32) {
        f = (d & b) | (~d & c);
        g = (5 * j + 1) % 16;
      } else if (j < 48) {
        f = b ^ c ^ d;
        g = (3 * j + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * j) % 16;
      }
      const next = d;
      d = c;
      c = b;
      const sum = (a + f + MD5_K[j] + words[block + g]) | 0;
      b = (b + ((sum << MD5_S[j]) | (sum >>> (32 - MD5_S[j])))) | 0;
      a = next;
    }
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }
  let hex = "";
  for (const word of [a0, b0, c0, d0]) {
    for (let k = 0; k < 4; k++) hex += ((word >>> (8 * k)) & 0xff).toString(16).padStart(2, "0");
  }
  return hex;
}

/** Голова набора записей — так же, как её считает rows_table_head. */
function headOf(records: Iterable<DeskRowRecord>): TableHead {
  const list = [...records];
  let rev = 0;
  for (const record of list) rev = Math.max(rev, Number(record.rev ?? 0) || 0);
  const parts = list
    .map((record) => ({ id: record.id, part: `${record.id}:${Number(record.rev ?? 0) || 0}` }))
    .sort((x, y) => compareCodePoints(x.id, y.id))
    .map((entry) => entry.part);
  return { count: list.length, rev, ids: parts.length > 0 ? md5Hex(parts.join(",")) : "" };
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
  /**
   * Правка удаляет строки ('all' — всю таблицу). Дельта удалений не
   * привозит, и без этой подсказки каждое своё удаление кончалось бы полной
   * перечиткой стола; подсказку всё равно проверяет голова таблицы.
   */
  deletes?: string[] | "all";
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
  write: () => Promise<T>,
  deletes?: string[] | "all"
): Promise<T> {
  const id = ++opSeq;
  const targets = tablesFor(workspaceId, pageId, tab);
  for (const t of targets) {
    t.overlays.set(id, { op, remaining: rowIds ? new Set(rowIds) : null, committedAt: null, deletes });
    t.pending += 1;
    t.refresh();
  }
  try {
    const result = await sequenced(laneKey(workspaceId, pageId, tab), rowIds, () => writeWithRetry(write));
    for (const t of targets) {
      const overlay = t.overlays.get(id);
      if (overlay) overlay.committedAt = Date.now();
    }
    // Остальным, у кого стол открыт, — «звонок» (см. rowsDoorbell.ts).
    ringRowsDoorbell(workspaceId, pageId, tab === undefined ? "*" : tabKey(tab));
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
  // Поля строки-заказа тоже ложатся поверх сразу: проход стола ОС решает по
  // `syncHash`/адресу копии, и со старыми значениями до события Realtime он
  // отправлял бы заказ повторно (цикл «правка → снимок → правка»).
  if (patch.syncHash !== undefined) next.syncHash = patch.syncHash;
  if (patch.osUid !== undefined) next.osUid = patch.osUid;
  if (patch.techUid !== undefined) next.techUid = patch.techUid;
  if (patch.statusKey !== undefined) next.statusKey = patch.statusKey;
  if (patch.srcPageId !== undefined) next.srcPageId = patch.srcPageId;
  if (patch.srcTabId !== undefined) next.srcTabId = patch.srcTabId;
  if (patch.srcRowId !== undefined) next.srcRowId = patch.srcRowId;
  if (patch.successRequestedAt !== undefined) next.successRequestedAt = patch.successRequestedAt;
  if (patch.successRequestedBy !== undefined) next.successRequestedBy = patch.successRequestedBy;
  if (patch.clearSuccessRequest) {
    delete next.successRequestedAt;
    delete next.successRequestedBy;
  }
  if (patch.mirrorPageId !== undefined) next.mirrorPageId = patch.mirrorPageId;
  if (patch.mirrorTabId !== undefined) next.mirrorTabId = patch.mirrorTabId;
  if (patch.mirrorRowId !== undefined) next.mirrorRowId = patch.mirrorRowId;
  if (patch.clearMirror) {
    delete next.mirrorPageId;
    delete next.mirrorTabId;
    delete next.mirrorRowId;
  }
  if (patch.releaseOrder) {
    delete next.osUid;
    delete next.techUid;
    delete next.statusKey;
    delete next.srcPageId;
    delete next.srcTabId;
    delete next.srcRowId;
  }
  if (updatedAt !== null) next.updatedAt = updatedAt;
  return next;
}

/** Поля записи, без которых строку не собрать (у события вставки они есть всегда). */
const REQUIRED_KEYS: (keyof DeskRowRecord)[] = ["cells", "sort_order", "created_at", "updated_at"];

/**
 * Запас курсора дельты: номер `rev` берётся из последовательности в начале
 * записи, а виден становится при фиксации — правка с МЕНЬШИМ номером может
 * зафиксироваться позже большей («обгон фиксаций»). Поэтому дочитываем не
 * от последнего увиденного номера, а от того, что был виден ≥10 с назад: за
 * это время любая запись (миллисекунды) успевает зафиксироваться. Что всё же
 * проскочит — поймает голова таблицы (md5 пар id:rev) и полная выборка.
 * `updated_at` курсором не годится: это часы разных устройств.
 */
const REV_LAG_MS = 10_000;
/**
 * Звонки живы — опрос головы редкий: он лишь страховка от потерянного звонка
 * и записей в обход клиента (SQL-редактор). Без звонков — как раньше, 15 с.
 */
const HEAD_POLL_WITH_DOORBELL_MS = 60_000;
/**
 * Столы (`ws:page:tab`), чей снимок с диска уже рисовался, а право читать
 * сервер ещё не подтвердил (строками или rows_page_access). Живёт дольше
 * одной подписки: страница по непустому снимку уже сочла доступ
 * подтверждённым (usePageRows запоминает это на ключ стола), и после
 * «Повторить» новая подписка — уже без снимка, его стёрли — отдала бы
 * пустоту без прав как настоящую таблицу, а публикатор записал бы нули в
 * «Технари». Пока ключ здесь, пустота с сервера сверяется с правами.
 */
const unverifiedSnapshots = new Set<string>();
/**
 * Канал Postgres Changes в проде не поднимается (токен Firebase без claim
 * `role`): он лишь бесконечно переподключается и держит второй сокет на
 * вкладку. Открываем его только по флагу на устройстве — для проверки, когда
 * claim появится (задача обмена токена).
 */
const PG_CHANGES_FLAG = "nova:sb-pg-changes";

function pgChangesEnabled(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(PG_CHANGES_FLAG) === "1";
  } catch {
    return false;
  }
}

/**
 * Живые строки таблицы: снимок с диска → выборка → дочитывание дельтой по
 * `rev` + свои правки поверх (см. Overlay).
 *
 * Открытие. Есть снимок стола в IndexedDB (rowSnapshotCache) — он рисуется
 * сразу с `fromServer = false` (рисовать можно, решать нельзя: публикация
 * счётчиков ждёт сервера), и с сервера дочитывается только `rev > курсор`
 * снимка. Нет снимка — обычная выборка всей таблицы.
 *
 * Дальше таблица НЕ перечитывается целиком ни после своей правки, ни на
 * чужой звонок: одна дельта `rows_table_delta` (изменённые строки + голова
 * из того же снимка базы). Своя голова (число строк и md5 пар id:rev) не
 * сошлась с головой базы — было удаление, обгон фиксаций или сменились права
 * — тогда полная выборка. Возврат на вкладку и опрос спрашивают только
 * голову (десятки байт) и дочитывают, лишь если она разошлась.
 *
 * Нет колонки `rev` или функций (SQL 20260929 не накатан) — всё по-старому:
 * полная выборка + отметка таблицы (`rows_table_stamp`).
 *
 * События Realtime (только с флагом PG_CHANGES_FLAG) применяются в порядке
 * ПРИХОДА — так их и отдаёт Postgres, в порядке фиксации. Сравнивать
 * `updated_at` нельзя: это `Date.now()` разных устройств, и отстающие часы у
 * одного человека выбрасывали бы его правки у всех остальных. Событие,
 * пришедшее, пока идёт выборка, не накладывается на неё — выборка
 * повторяется. Событие правки НАКЛАДЫВАЕТСЯ на сохранённую запись строки:
 * большое jsonb (TOAST) Postgres в событие не кладёт. Удаления слушаются
 * ОТДЕЛЬНО и без фильтра: фильтр по столбцу на DELETE в Supabase не действует.
 *
 * Не прочиталось — `onError` и повтор через 3 → 6 → … 30 с; строк прошлой
 * таблицы при этом никто не увидит — `onData` просто не зовётся.
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
  /** Строки есть (со снимка или с сервера) — можно рисовать. */
  let loaded = false;
  /**
   * Сервер уже ответил. До этого строки — со снимка, и `onData` получает
   * `fromServer = false`: как `fromCache` у Firestore, по ним не решают.
   */
  let serverConfirmed = false;
  /** Снимок был непустым — первая пустота с сервера требует проверки прав (см. load). */
  let snapshotHadRows = false;
  let serverRecords = new Map<string, DeskRowRecord>();
  let serverRows: RowsMap = new Map();
  let loading = false;
  /** Что сделать после текущей выборки: дочитать дельту или перечитать целиком. */
  let queued: "delta" | "full" | null = null;
  let channelHealthy = false;
  let liveWarnTimer: ReturnType<typeof setTimeout> | null = null;
  let retryDelay = 3000;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let reloadTimer: ReturnType<typeof setTimeout> | null = null;
  let sweepTimer: ReturnType<typeof setTimeout> | null = null;
  let emitTimer: ReturnType<typeof setTimeout> | null = null;
  let stampTimer: ReturnType<typeof setTimeout> | null = null;
  /** Отметка таблицы на момент последней выборки (старый путь, см. STAMP_POLL_MS). */
  let lastStamp: string | null = null;
  /** В базе нет `rows_table_stamp` — страховку не зовём. */
  let stampMissing = false;
  /** Канал «звонков» поднят — чужие правки доезжают сразу и без Postgres Changes. */
  let doorbellReady = false;
  /**
   * Есть ли в базе `rev` и функции головы/дельты: "unknown" — ещё не ясно
   * (пустой стол), "off" — SQL 20260929 не накатан, работаем по-старому.
   */
  let revMode: "unknown" | "on" | "off" = "unknown";
  /** Наибольший `rev` таблицы и когда он был увиден — для курсора с запасом (REV_LAG_MS). */
  let checkpoints: { at: number; rev: number }[] = [];
  /** Своя голова по serverRecords; сбрасывается при каждом их изменении. */
  let headMemo: TableHead | null = null;

  const snapKey = `${workspaceId}:${pageId}:${tabId}`;
  /** Пустоту с сервера отдавать, только сверив права (см. unverifiedSnapshots). */
  const emptyNeedsAccessCheck = () => !serverConfirmed && (snapshotHadRows || unverifiedSnapshots.has(snapKey));

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
      // Канал не подключён — события не придут, правку подтвердит дочитывание.
      if (table.pending === 0 && !channelHealthy) scheduleReload();
    },
    reload: () => void sync(),
  };

  function emit() {
    if (emitTimer) {
      clearTimeout(emitTimer);
      emitTimer = null;
    }
    if (cancelled || !loaded) return;
    const view: RowsMap = new Map(serverRows);
    for (const id of [...table.overlays.keys()].sort((a, b) => a - b)) table.overlays.get(id)!.op(view);
    onData([...view.values()].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt), serverConfirmed);
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

  /**
   * Прежний объект строки, если `rev` не изменился: memo строк таблицы
   * сравнивает поля по ссылке, и новые объекты на каждую выборку
   * перерисовывали весь стол из-за правки одной ячейки.
   */
  function rowFor(record: DeskRowRecord): PageRow {
    const prev = serverRecords.get(record.id);
    const prevRow = serverRows.get(record.id);
    if (prev && prevRow && record.rev != null && prev.rev === record.rev) return prevRow;
    return recordToRow(record);
  }

  function replaceAll(records: DeskRowRecord[]) {
    const nextRows: RowsMap = new Map();
    for (const record of records) nextRows.set(record.id, rowFor(record));
    serverRecords = new Map(records.map((record) => [record.id, record]));
    serverRows = nextRows;
    headMemo = null;
  }

  function localHead(): TableHead {
    if (!headMemo) headMemo = headOf(serverRecords.values());
    return headMemo;
  }

  /** Наибольший увиденный `rev` — отметка для курсора (см. REV_LAG_MS). */
  function checkpoint() {
    const now = Date.now();
    checkpoints.push({ at: now, rev: localHead().rev });
    // Храним свежие отметки и одну — самую новую из «отстоявшихся».
    const settled = checkpoints.filter((c) => c.at <= now - REV_LAG_MS);
    const fresh = checkpoints.filter((c) => c.at > now - REV_LAG_MS);
    const best = settled.reduce<{ at: number; rev: number } | null>((acc, c) => (!acc || c.rev > acc.rev ? c : acc), null);
    checkpoints = best ? [best, ...fresh] : fresh;
  }

  /** Курсор дельты: наибольший `rev`, увиденный ≥10 с назад (иначе самый ранний из свежих). */
  function deltaCursor(): number {
    const limit = Date.now() - REV_LAG_MS;
    let best: number | null = null;
    for (const c of checkpoints) if (c.at <= limit) best = Math.max(best ?? 0, c.rev);
    if (best !== null) return best;
    return checkpoints.length > 0 ? Math.min(...checkpoints.map((c) => c.rev)) : 0;
  }

  function saveSnapshot() {
    if (revMode !== "on" || !serverConfirmed) return;
    // Снимок собирается в момент записи (после паузы) — самый свежий. Пустой стол модуль снимков стирает.
    writeRowSnapshot<DeskRowRecord>(workspaceId, pageId, tabId, () => ({
      records: [...serverRecords.values()],
      cursor: deltaCursor(),
      savedAt: Date.now(),
    }));
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
          // бывает — порядок несдвинутых строк): сверяемся с базой, а не
          // откатываем экран к тому, что было до правки.
          if (overlay.remaining === null || overlay.remaining.size > 0) unconfirmed = true;
        }
      }
      if (unconfirmed) void sync();
      else if (changed) emit();
      if ([...table.overlays.values()].some((o) => o.committedAt !== null)) scheduleSweep();
    }, OVERLAY_TTL_MS);
  }

  function scheduleReload() {
    if (cancelled) return;
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      if (table.pending === 0) void sync();
    }, 300);
  }

  /** Сверка с базой: дельтой, если она есть в базе, иначе полной выборкой. */
  function sync(): Promise<void> {
    return revMode !== "off" && loaded ? syncDelta() : load();
  }

  function runQueued() {
    const next = queued;
    queued = null;
    if (cancelled || !next) return;
    if (next === "full") void load();
    else void syncDelta();
  }

  /** true — изменились строки; "reload" — события не хватает, нужна выборка. */
  function apply(payload: RealtimePayload): boolean | "reload" {
    if (payload.eventType === "DELETE") {
      const old = payload.old;
      if (!old.id) return false;
      dropConfirmed(old.id);
      serverRecords.delete(old.id);
      headMemo = null;
      return serverRows.delete(old.id);
    }
    const next = payload.new;
    if (!next.id) return false;
    const defined = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)) as Partial<DeskRowRecord>;
    const merged = { ...(serverRecords.get(next.id) ?? {}), ...defined } as DeskRowRecord;
    if (REQUIRED_KEYS.some((key) => merged[key] === undefined)) return "reload";
    serverRows.set(next.id, rowFor(merged));
    serverRecords.set(next.id, merged);
    headMemo = null;
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
      queued = "full";
      return;
    }
    const result = apply(payload);
    if (result === "reload") void load();
    else if (result) emitSoon();
  }

  /** Полная выборка таблицы (первое открытие без снимка, расхождение головы, старый SQL). */
  async function load() {
    if (cancelled) return;
    if (loading) {
      queued = "full";
      return;
    }
    loading = true;
    queued = null;
    // Подтверждённые ДО начала выборки правки выборка уже содержит.
    const confirmedBefore = [...table.overlays].filter(([, o]) => o.committedAt !== null).map(([id]) => id);
    // Отметка таблицы нужна только старому пути (нет `rev`) и только без живого канала.
    const wantStamp = revMode !== "on" && !stampMissing && !channelHealthy;
    try {
      // Пустой стол без прав здесь не ошибка: «права ещё не доехали» различает
      // сама страница (usePageRows → sbPageAccess), не дёргая проверку на каждом повторе.
      let stampBefore: string | null = null;
      let records: DeskRowRecord[];
      if (!wantStamp) {
        records = await fetchTableRecords();
      } else if (!loaded) {
        // Первое открытие: отметку — ПАРАЛЛЕЛЬНО с выборкой, а не лишним
        // запросом перед ней (+1 RTT на каждом открытии стола). Правка между
        // ними, если отметка окажется новее строк, догонит звонок или
        // следующая правка; с `rev` отметка не нужна вовсе.
        const [stamp, fetched] = await Promise.all([
          fetchTableStamp(workspaceId, pageId, tabId).catch(() => null),
          fetchTableRecords(),
        ]);
        stampBefore = stamp;
        records = fetched;
      } else {
        // Отметку берём ДО выборки: правка между ними попадёт в строки, а отметка
        // окажется старой — следующий тик лишний раз перечитает, но не пропустит.
        stampBefore = await fetchTableStamp(workspaceId, pageId, tabId).catch(() => null);
        records = await fetchTableRecords();
      }
      if (cancelled) return;
      if (revMode === "unknown" && records.length > 0) revMode = records.some((r) => r.rev !== undefined) ? "on" : "off";
      // Снимок с диска показал строки (в этой подписке или в прошлой — см.
      // unverifiedSnapshots), а сервер — пустоту. Страница по непустому
      // снимку уже сочла право читать подтверждённым, и эта пустота ушла бы
      // в «Технари» нулями. Пустоту отдаём, только если читать можно.
      if (records.length === 0 && emptyNeedsAccessCheck()) {
        const access = await sbPageAccess(workspaceId, pageId);
        if (cancelled) return;
        if (!access.canRead) {
          // Ключ в unverifiedSnapshots остаётся: и «Повторить» проверит снова.
          dropRowSnapshot(workspaceId, pageId, tabId);
          throw new RowsStoreError(
            access.hasAcl ? "Нет доступа к строкам этого стола" : "Права на этот стол ещё не доехали до базы строк",
            access.hasAcl ? "permission-denied" : "unavailable"
          );
        }
      }
      // Сервер ответил строками (или rows_page_access разрешил) — право подтверждено.
      unverifiedSnapshots.delete(snapKey);
      replaceAll(records);
      lastStamp = stampBefore;
      for (const id of confirmedBefore) table.overlays.delete(id);
      loaded = true;
      serverConfirmed = true;
      retryDelay = 3000;
      if (revMode === "on") {
        checkpoint();
        saveSnapshot();
      }
      emit();
    } catch (error) {
      if (cancelled) return;
      onError?.(error instanceof RowsStoreError ? error : toStoreError(null, String(error)));
      // Повтор ниже и так перечитает целиком: отложенная сверка (звонок во
      // время выборки) не должна обходить паузу 3 → 30 с.
      queued = null;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void load();
      }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30_000);
    } finally {
      loading = false;
      runQueued();
    }
  }

  /**
   * Дочитать изменённое: `rev > курсор` и голова одним запросом. Своя голова
   * после слияния совпала с головой базы — таблица сверена (как полной
   * выборкой, но за 1–2 строки); не совпала — полная выборка.
   */
  async function syncDelta() {
    if (cancelled) return;
    if (revMode === "off" || !loaded) {
      void load();
      return;
    }
    if (loading) {
      if (queued !== "full") queued = "delta";
      return;
    }
    loading = true;
    queued = null;
    const confirmed = [...table.overlays].filter(([, o]) => o.committedAt !== null);
    let fallback = false;
    try {
      const delta = await fetchTableDelta(workspaceId, pageId, tabId, deltaCursor());
      if (cancelled) return;
      if (delta === null) {
        // SQL 20260929 не накатан (или откатили) — дальше по-старому.
        revMode = "off";
        fallback = true;
        return;
      }
      revMode = "on";
      // Долго не были на столе — изменений много; пустота после непустого
      // снимка — через полную выборку, там она сверяется с правами.
      if (delta.more || (delta.count === 0 && emptyNeedsAccessCheck())) {
        fallback = true;
        return;
      }
      // Перерисовка — только если что-то поменялось: пустая дельта (звонок
      // без изменений, опрос) не должна дёргать весь стол.
      let changed = !serverConfirmed || confirmed.length > 0 || delta.rows.length > 0;
      // Свои подтверждённые удаления — сразу: дельта удалений не привозит.
      // Ошиблись — голова не сойдётся, и будет полная выборка.
      for (const [, overlay] of confirmed) {
        if (overlay.deletes === "all") {
          serverRecords.clear();
          serverRows.clear();
          changed = true;
        } else if (overlay.deletes) {
          for (const id of overlay.deletes) {
            serverRecords.delete(id);
            if (serverRows.delete(id)) changed = true;
          }
        }
      }
      for (const record of delta.rows) {
        if (!record?.id || !inScope(record)) continue;
        serverRows.set(record.id, rowFor(record));
        serverRecords.set(record.id, record);
      }
      headMemo = null;
      const mine = localHead();
      if (mine.count !== delta.count || mine.ids !== delta.ids) {
        fallback = true;
        return;
      }
      // Таблица сверена с базой — правки, подтверждённые до запроса, в ней уже есть.
      for (const [id] of confirmed) table.overlays.delete(id);
      serverConfirmed = true;
      // Сюда пустота без сверки прав не доходит (см. выше) — голова со строками и есть подтверждение.
      unverifiedSnapshots.delete(snapKey);
      retryDelay = 3000;
      checkpoint();
      if (changed) {
        saveSnapshot();
        emit();
      }
    } catch {
      // Нет связи — полная выборка сама скажет об ошибке и будет повторять.
      fallback = true;
    } finally {
      loading = false;
      if (fallback && !cancelled) queued = "full";
      runQueued();
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
   * Голова базы против своей (возврат на вкладку, опрос): совпала — ничего не
   * делаем (десятки байт вместо таблицы), разошлась — дельта.
   */
  async function checkHead() {
    if (cancelled || !loaded || loading || table.pending > 0) return;
    try {
      const head = await fetchTableHead(workspaceId, pageId, tabId);
      if (cancelled) return;
      if (head === null) {
        revMode = "off";
        void load();
        return;
      }
      revMode = "on";
      const mine = localHead();
      if (serverConfirmed && head.count === mine.count && head.ids === mine.ids) {
        // Совпало — всё, что видно сейчас, отстоится в курсор через REV_LAG_MS.
        checkpoint();
        return;
      }
      void syncDelta();
    } catch {
      // Нет связи — следующий тик попробует снова.
    }
  }

  /**
   * Тик страховки: только пока канал НЕ подключён, вкладка на виду, таблица
   * загружена и своих записей в пути нет (иначе отметка менялась бы от своих
   * же правок). С `rev` — голова раз в минуту при живых звонках, без них раз в
   * 15 с; без `rev` — отметка раз в 15 с, как раньше.
   */
  function scheduleStampCheck() {
    if (cancelled) return;
    if (stampTimer) clearTimeout(stampTimer);
    const delay = revMode === "on" && doorbellReady ? HEAD_POLL_WITH_DOORBELL_MS : STAMP_POLL_MS;
    stampTimer = setTimeout(() => {
      stampTimer = null;
      void checkStamp().finally(scheduleStampCheck);
    }, delay);
  }

  async function checkStamp() {
    if (cancelled || channelHealthy || !loaded || loading || table.pending > 0) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    if (revMode !== "off") {
      await checkHead();
      return;
    }
    if (stampMissing) return;
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

  /** Ни канала, ни звонков за 15 с — сказать человеку один раз (см. liveWarnedOnce). */
  function armLiveWarn() {
    if (cancelled || liveWarnedOnce || liveWarnTimer) return;
    liveWarnTimer = setTimeout(() => {
      liveWarnTimer = null;
      // Звонки работают — чужие правки и так доезжают за секунду, пугать незачем.
      if (cancelled || channelHealthy || doorbellReady || liveWarnedOnce) return;
      liveWarnedOnce = true;
      toast.error("Живое обновление строк не работает", {
        description:
          stampMissing && revMode !== "on"
            ? "Свои правки сохраняются, а чужие появятся только после обновления страницы."
            : "Свои правки сохраняются, а чужие будут подтягиваться раз в 15 секунд.",
        duration: 8000,
      });
    }, LIVE_WARN_AFTER_MS);
  }

  const channel: RealtimeChannel | null = pgChangesEnabled()
    ? supabaseRows
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
          // Канал не поднялся. Молчать нельзя: свои правки видно, а ЧУЖИЕ не
          // появятся вовсе. Ждём 15 с — phoenix сам переподключается.
          armLiveWarn();
        })
    : null;
  // Без канала живость держат звонки: не поднялись и они — та же плашка.
  if (!channel) armLiveWarn();

  /**
   * Кто-то записал строки этой вкладки (rowsDoorbell). Живой канал сам привёз
   * бы событие — тогда ничего не делаем; иначе дочитываем дельту (старый SQL —
   * сверяем отметку и перечитываем, только если она сменилась). Свёрнутая
   * вкладка сверится с головой при возврате.
   */
  async function onRing() {
    if (cancelled || channelHealthy) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    // Своя запись в пути — таблицу и так дочитает `settled`.
    if (table.pending > 0) return;
    if (!loaded) {
      // Идёт первая выборка: правка могла зафиксироваться ПОСЛЕ снимка строк,
      // но до отметки, взятой параллельно, — тогда отметка уже новая, и опрос
      // разницы не увидит никогда. Звонок не теряем: после выборки — сверка
      // (старый SQL — полная, с `rev` — дельта). Выборка ещё не началась —
      // она и так увидит правку.
      if (loading) queued = revMode === "off" || queued === "full" ? "full" : "delta";
      return;
    }
    if (revMode !== "off") {
      void syncDelta();
      return;
    }
    if (loading) {
      queued = "full";
      return;
    }
    if (stampMissing) {
      void load();
      return;
    }
    try {
      const stamp = await fetchTableStamp(workspaceId, pageId, tabId);
      if (!cancelled && stamp !== lastStamp) void load();
    } catch {
      void load();
    }
  }

  const stopDoorbell = listenRowsDoorbell(
    workspaceId,
    pageId,
    (ringTab) => {
      if (ringTab === tabId || ringTab === "*") void onRing();
    },
    (ready) => {
      doorbellReady = ready;
    }
  );

  /**
   * Открытие: снимок с диска (если есть) рисуется сразу, затем дельта от его
   * курсора; нет снимка — выборка. Не дожидаемся канала: Realtime может и не
   * подключиться, а таблица должна открыться всё равно.
   */
  async function start() {
    const snapshot = await readRowSnapshot<DeskRowRecord>(workspaceId, pageId, tabId).catch(() => null);
    if (cancelled || loaded || loading) return;
    const records = (snapshot?.records ?? []).filter((record) => record && typeof record.id === "string" && inScope(record));
    if (!snapshot || records.length === 0) {
      void load();
      return;
    }
    // Снимок пишется только при `rev` в базе — значит, дельта там есть.
    revMode = "on";
    replaceAll(records);
    checkpoints = [{ at: 0, rev: snapshot.cursor }];
    snapshotHadRows = true;
    unverifiedSnapshots.add(snapKey);
    loaded = true;
    emit();
    void syncDelta();
  }

  void start();
  scheduleStampCheck();

  const onVisible = () => {
    if (document.visibilityState !== "visible") return;
    if (revMode === "off" || !loaded) void load();
    else void checkHead();
  };
  document.addEventListener("visibilitychange", onVisible);

  return () => {
    cancelled = true;
    liveTables.delete(table);
    for (const timer of [retryTimer, reloadTimer, sweepTimer, emitTimer, liveWarnTimer, stampTimer]) if (timer) clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisible);
    stopDoorbell();
    if (channel) void supabaseRows.removeChannel(channel);
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
  /** Снять адрес копии со строки-источника (копию убрали или потеряли). */
  clearMirror?: boolean;
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
        p_clear_mirror: patch.clearMirror ?? false,
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
    },
    [rowId]
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
  if (data) ringRowsDoorbell(workspaceId, pageId, tabKey(tab));
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
    },
    "all"
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
