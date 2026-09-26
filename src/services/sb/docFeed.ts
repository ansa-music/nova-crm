import { supabaseRows } from "@/lib/supabaseRows";
import { isSbMissingError, markSbTableMissing, markSbTablePresent, type CollectionKey } from "@/services/sb/sbCollections";
import { listenTopic, ringTopic } from "@/services/sb/topicDoorbell";

/**
 * Поток «документов» Supabase — для коллекций, переехавших из Firestore в
 * таблицу вида (workspace_id, kind, id, data jsonb, deleted, rev, server_at):
 * «График» (schedule_docs), дальше Грок и прочее.
 *
 * Один движок на (таблица, workspace) в вкладке: общий курсор дельты по rev
 * (все виды разом — правок в таких коллекциях мало), звонок
 * `nova:{ws}:{тема}`, опрос (30 с на виду, 2 мин свёрнутой) и дочитка при
 * возврате на вкладку. Экраны вешают «виды»: начальная выборка своим
 * фильтром + предикат, по которому дальше отбираются документы из общей
 * памяти движка. Вид отдаёт список, только когда его начальная выборка
 * пришла с сервера (`fromServer`) — рисовать раньше нечего, а решать по
 * пустоте нельзя.
 *
 * Удаление мягкое (`deleted`): дельта видит его как правку.
 */

export interface SbDoc {
  kind: string;
  id: string;
  data: Record<string, unknown>;
  deleted: boolean;
  rev: number;
}

export interface DocFeedConfig {
  table: string;
  /** Тема звонка: `nova:{ws}:{topic}`. */
  topic: string;
  /** Ключ коллекции — для памяти «таблицы нет». */
  collection: CollectionKey;
}

type Filter = (q: ReturnType<typeof baseQuery>) => ReturnType<typeof baseQuery>;

export interface DocView {
  /** Начальная выборка: фильтр поверх `workspace_id = ws and deleted = false`. */
  initial: Filter;
  /** Какие документы общей памяти относятся к виду (удалённые отсекаются сами). */
  match: (doc: SbDoc) => boolean;
}

interface ViewEntry {
  view: DocView;
  synced: boolean;
  onData: (docs: SbDoc[], fromServer: boolean) => void;
  onError?: (error: Error) => void;
  onMissing?: () => void;
  last: string;
}

interface Engine {
  key: string;
  docs: Map<string, SbDoc>;
  views: Set<ViewEntry>;
  missing: boolean;
  refresh: () => void;
  load: (entry: ViewEntry) => void;
  stop: () => void;
  linger: ReturnType<typeof setTimeout> | null;
}

const COLUMNS = "kind,id,data,deleted,rev,server_at";
const RING_SETTLE_MS = 250;
const POLL_MS = 30_000;
const HIDDEN_POLL_EVERY = 4;
const RETRY_MS = [3_000, 10_000, 30_000];
const DELTA_PAGE = 500;
const CURSOR_SAFETY_MS = 15_000;
const HEAD_SPAN = 50;
const LINGER_MS = 60_000;

const engines = new Map<string, Engine>();

function baseQuery(table: string, workspaceId: string) {
  return supabaseRows.from(table).select(COLUMNS).eq("workspace_id", workspaceId);
}

function docKey(kind: string, id: string) {
  return `${kind}/${id}`;
}

interface Row {
  kind: string;
  id: string;
  data: Record<string, unknown> | null;
  deleted: boolean;
  rev: number | string;
  server_at?: string;
}

function toDoc(row: Row): SbDoc {
  return { kind: row.kind, id: row.id, data: row.data ?? {}, deleted: Boolean(row.deleted), rev: Number(row.rev) || 0 };
}

function sbFail(error: { code?: string; message?: string }): Error {
  return Object.assign(new Error(error.message || "Supabase"), { code: error.code || "unavailable" });
}

function emitView(engine: Engine, entry: ViewEntry) {
  if (!entry.synced) return;
  const docs = [...engine.docs.values()].filter((d) => !d.deleted && entry.view.match(d));
  const sig = docs.map((d) => `${d.kind}/${d.id}@${d.rev}`).sort().join("|");
  if (sig === entry.last) return;
  entry.last = sig;
  entry.onData(docs, true);
}

function emitAll(engine: Engine) {
  for (const entry of [...engine.views]) emitView(engine, entry);
}

function startEngine(cfg: DocFeedConfig, workspaceId: string): Engine {
  let stopped = false;
  let headReady: Promise<void> | null = null;
  let inFlight = false;
  let again = false;
  let failures = 0;
  let revLog: { rev: number; at: number; seenAt: number }[] = [];
  let newestAt = 0;
  let cursorRev = 0;
  let ringTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTick = 0;

  const engine: Engine = {
    key: `${cfg.table}|${workspaceId}`,
    docs: new Map(),
    views: new Set(),
    missing: false,
    linger: null,
    refresh: () => schedule(),
    load: (entry) => void loadView(entry),
    stop: () => {},
  };

  function noteRevs(rows: Row[]) {
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

  function take(row: Row): boolean {
    const doc = toDoc(row);
    const key = docKey(doc.kind, doc.id);
    const known = engine.docs.get(key);
    if (known && known.rev >= doc.rev) return false;
    engine.docs.set(key, doc);
    return true;
  }

  function goMissing() {
    markSbTableMissing(cfg.collection);
    engine.missing = true;
    for (const entry of [...engine.views]) entry.onMissing?.();
  }

  /** Голова таблицы — ДО первой выборки: курсор дельты начинается с неё, а не с нуля. */
  function ensureHead(): Promise<void> {
    if (!headReady) {
      headReady = (async () => {
        const { data, error } = await supabaseRows
          .from(cfg.table)
          .select("rev,server_at")
          .eq("workspace_id", workspaceId)
          .order("rev", { ascending: false })
          .limit(HEAD_SPAN);
        if (error) throw error;
        const rows = (data ?? []) as Row[];
        cursorRev = rows.length >= HEAD_SPAN ? Math.min(...rows.map((r) => Number(r.rev) || 0)) - 1 : 0;
        noteRevs(rows);
      })();
      headReady.catch(() => {
        headReady = null;
      });
    }
    return headReady;
  }

  async function loadView(entry: ViewEntry, attempt = 0) {
    if (stopped || engine.missing) return;
    try {
      await ensureHead();
      const { data, error } = await entry.view.initial(baseQuery(cfg.table, workspaceId).eq("deleted", false)).limit(5000);
      if (stopped || !engine.views.has(entry)) return;
      if (error) throw error;
      for (const row of (data ?? []) as Row[]) take(row);
      markSbTablePresent(cfg.collection);
      entry.synced = true;
      emitView(engine, entry);
    } catch (error) {
      if (stopped || !engine.views.has(entry)) return;
      if (isSbMissingError(error)) {
        goMissing();
        return;
      }
      if (attempt === 0) entry.onError?.(sbFail(error as { code?: string; message?: string }));
      setTimeout(() => void loadView(entry, attempt + 1), RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]);
    }
  }

  async function fetchDelta() {
    if (stopped || engine.missing || !headReady) return;
    if (inFlight) {
      again = true;
      return;
    }
    inFlight = true;
    try {
      await ensureHead();
      let changed = false;
      const after = cursor();
      for (let from = 0; ; from += DELTA_PAGE) {
        const { data, error } = await baseQuery(cfg.table, workspaceId)
          .gt("rev", after)
          .order("rev", { ascending: true })
          .range(from, from + DELTA_PAGE - 1);
        if (stopped) return;
        if (error) throw error;
        const rows = (data ?? []) as Row[];
        for (const row of rows) if (take(row)) changed = true;
        noteRevs(rows);
        if (rows.length < DELTA_PAGE) break;
      }
      failures = 0;
      if (changed) emitAll(engine);
    } catch (error) {
      if (stopped) return;
      if (isSbMissingError(error)) {
        goMissing();
        return;
      }
      const delay = RETRY_MS[Math.min(failures, RETRY_MS.length - 1)];
      failures += 1;
      if (!retryTimer) {
        retryTimer = setTimeout(() => {
          retryTimer = null;
          void fetchDelta();
        }, delay);
      }
    } finally {
      inFlight = false;
      if (again) {
        again = false;
        void fetchDelta();
      }
    }
  }

  function schedule() {
    if (stopped || ringTimer) return;
    ringTimer = setTimeout(() => {
      ringTimer = null;
      void fetchDelta();
    }, RING_SETTLE_MS);
  }

  const onVisible = () => {
    if (document.visibilityState === "visible") schedule();
  };
  const stopRing = listenTopic(`nova:${workspaceId}:${cfg.topic}`, schedule);
  document.addEventListener("visibilitychange", onVisible);
  const poll = setInterval(() => {
    pollTick += 1;
    if (document.visibilityState === "visible" || pollTick % HIDDEN_POLL_EVERY === 0) void fetchDelta();
  }, POLL_MS);

  engine.stop = () => {
    if (stopped) return;
    stopped = true;
    stopRing();
    clearInterval(poll);
    if (ringTimer) clearTimeout(ringTimer);
    if (retryTimer) clearTimeout(retryTimer);
    document.removeEventListener("visibilitychange", onVisible);
  };
  return engine;
}

/**
 * Повесить вид. `onMissing` — таблицы нет (SQL не накатан): вызывающий
 * переходит на Firestore. Возвращает отписку.
 */
export function watchSbDocs(
  cfg: DocFeedConfig,
  workspaceId: string,
  view: DocView,
  onData: (docs: SbDoc[], fromServer: boolean) => void,
  handlers: { onError?: (error: Error) => void; onMissing?: () => void } = {}
): () => void {
  const key = `${cfg.table}|${workspaceId}`;
  let engine = engines.get(key);
  if (!engine || engine.missing) {
    engine?.stop();
    engine = startEngine(cfg, workspaceId);
    engines.set(key, engine);
  }
  const current = engine;
  if (current.linger) {
    clearTimeout(current.linger);
    current.linger = null;
  }
  const entry: ViewEntry = { view, synced: false, onData, onError: handlers.onError, onMissing: handlers.onMissing, last: "\u0000" };
  current.views.add(entry);
  current.load(entry);
  return () => {
    current.views.delete(entry);
    if (current.views.size > 0 || current.linger) return;
    current.linger = setTimeout(() => {
      current.linger = null;
      if (current.views.size > 0) return;
      current.stop();
      if (engines.get(key) === current) engines.delete(key);
    }, LINGER_MS);
  };
}

/** Своя запись легла — показать сразу во всех видах вкладки и позвонить остальным. */
export function applySbDocs(cfg: DocFeedConfig, workspaceId: string, docs: SbDoc[]) {
  const engine = engines.get(`${cfg.table}|${workspaceId}`);
  if (engine) {
    let changed = false;
    for (const doc of docs) {
      const key = docKey(doc.kind, doc.id);
      const known = engine.docs.get(key);
      if (known && known.rev >= doc.rev) continue;
      engine.docs.set(key, doc);
      changed = true;
    }
    if (changed) emitAll(engine);
  }
  ringTopic(`nova:${workspaceId}:${cfg.topic}`);
}

/** Разовая выборка с сервера (мимо памяти движка): решения «по свежему». */
export async function fetchSbDocs(cfg: DocFeedConfig, workspaceId: string, filter: Filter): Promise<SbDoc[] | null> {
  const { data, error } = await filter(baseQuery(cfg.table, workspaceId).eq("deleted", false)).limit(5000);
  if (error) {
    if (isSbMissingError(error)) {
      markSbTableMissing(cfg.collection);
      return null;
    }
    throw sbFail(error);
  }
  return ((data ?? []) as Row[]).map(toDoc);
}

/** Для проверок. */
export function resetDocFeedsForTest() {
  for (const engine of engines.values()) engine.stop();
  engines.clear();
}
