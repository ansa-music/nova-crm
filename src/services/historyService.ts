import { deleteDoc, getDocs, onSnapshot, orderBy, query, setDoc, limit as fsLimit } from "firebase/firestore";
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
  type SbBackend,
} from "@/services/sb/sbCollections";
import { listenTopic, ringTopic } from "@/services/sb/topicDoorbell";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { generateId } from "@/utils/id";
import { expandHistoryDoc, sortHistoryDesc } from "@/utils/historyDocs";
import type { HistoryAction, HistoryEntry } from "@/types";

export interface LogChangeInput {
  workspaceId: string;
  pageId?: string;
  pageName?: string;
  rowId?: string;
  field?: string;
  fieldLabel?: string;
  oldValue: string | number | null;
  newValue: string | number | null;
  action: HistoryAction;
  userId: string;
  userName: string;
}

/**
 * Записи истории копятся в памяти и уезжают ПАЧКОЙ: в Firestore — одним
 * документом, в Supabase — одним вызовом `log_history` (20261008).
 *
 * Зачем: на бесплатном Firebase (Spark) 20 000 записей в сутки, а каждая
 * правка ячейки стоила ДВЕ — саму строку и запись истории. То есть половину
 * дневной квоты съедал журнал. Квота считается по документам, поэтому
 * writeBatch тут не помог бы вовсе: тридцать записей одной пачкой стоят
 * тридцать записей. Помогает только один документ на несколько изменений.
 *
 * Цена решения — окно в {@link FLUSH_MS}: если вкладку убьют жёстко (не
 * закроют, а оборвут), последние секунды журнала пропадут. Для аудит-лога
 * это приемлемо, для строк таблицы было бы нет — строки пишутся как и
 * раньше, сразу.
 *
 * Где живёт журнал — `workspace.sbCollections.history` (sbCollections.ts):
 * пока SQL не вставлен, всё по-старому в Firestore; читатель и писатель
 * решают одинаково (`historyBackendFor`), а «нет таблицы» уводит в Firestore
 * молча. Тема звонка `nova:{ws}:history` — открытая панель истории
 * перечитывает журнал после чужой пачки.
 */
const FLUSH_MS = 10_000;
/** Больше полусотни в документ не кладём — 1 МиБ на документ никто не отменял. */
const MAX_ENTRIES = 50;

const HISTORY_TABLE = "history_log";
const HISTORY_COLUMNS = "workspace_id,id,page_id,page_name,row_id,field,field_label,old_value,new_value,action,user_id,user_name,ts,created_at";

interface HistoryRow {
  workspace_id: string;
  id: string;
  page_id: string | null;
  page_name: string | null;
  row_id: string | null;
  field: string | null;
  field_label: string | null;
  old_value: unknown;
  new_value: unknown;
  action: string;
  user_id: string;
  user_name: string | null;
  ts: number | string;
  created_at: number | string;
}

export function historyTopic(workspaceId: string) {
  return `nova:${workspaceId}:history`;
}

/**
 * Куда писать и откуда читать журнал этого workspace — по документу
 * workspace из стора (как `notificationsBackendFor`). Нет документа —
 * Firestore. Память «таблицы нет» пора переспросить — пробуем Supabase.
 */
export function historyBackendFor(workspaceId: string): SbBackend {
  const doc = useWorkspaceStore.getState().workspaces.find((w) => w.id === workspaceId);
  if (!doc) return "firestore";
  const backend = sbBackendOf(doc, "history");
  if (backend === "firestore" && sbTargetOf(doc, "history") === "supabase" && sbTableRecheckDue("history")) {
    return "supabase";
  }
  return backend;
}

function sbError(error: { code?: string; message?: string }): Error {
  return Object.assign(new Error(error.message || "Supabase"), { code: error.code });
}

let buffer = new Map<string, HistoryEntry[]>();
let timer: ReturnType<typeof setTimeout> | null = null;
/** Последняя запись пачки — `reloadSafely` ждёт её перед перезагрузкой. */
let inflight: Promise<void> = Promise.resolve();

async function writeBatchDoc(workspaceId: string, entries: HistoryEntry[]) {
  const id = generateId("hist");
  const last = entries[entries.length - 1];
  await setDoc(paths.historyEntry(workspaceId, id), {
    id,
    workspaceId,
    // Документы сортируются по этому полю, внутри пачки порядок восстанавливает
    // читающая сторона (sortHistoryDesc).
    timestamp: last?.timestamp ?? Date.now(),
    entries,
  });
}

function toPayload(entry: HistoryEntry) {
  return {
    id: entry.id,
    pageId: entry.pageId ?? null,
    pageName: entry.pageName ?? null,
    rowId: entry.rowId ?? null,
    field: entry.field ?? null,
    fieldLabel: entry.fieldLabel ?? null,
    oldValue: entry.oldValue ?? null,
    newValue: entry.newValue ?? null,
    action: entry.action,
    userName: entry.userName,
    timestamp: entry.timestamp,
  };
}

async function sbLogHistory(workspaceId: string, entries: HistoryEntry[]) {
  const { error } = await supabaseRows.rpc("log_history", { p_workspace: workspaceId, p_entries: entries.map(toPayload) });
  if (error) throw sbError(error);
  markSbTablePresent("history");
}

async function writePending(workspaceId: string, entries: HistoryEntry[]) {
  if (historyBackendFor(workspaceId) === "supabase") {
    try {
      await sbLogHistory(workspaceId, entries);
      ringTopic(historyTopic(workspaceId));
      return;
    } catch (error) {
      if (!isSbMissingError(error)) {
        console.warn("[history] пачка не записалась в Supabase", error);
        return;
      }
      // SQL 20261008 ещё не вставлен — по-старому, документом Firestore.
      markSbTableMissing("history");
    }
  }
  try {
    await writeBatchDoc(workspaceId, entries);
  } catch (error) {
    console.warn("[history] пачка не записалась", error);
  }
}

/**
 * Отдать накопленное в базу. Зовётся по таймеру, при уходе со вкладки и перед
 * перезагрузкой на новую версию (та ждёт возвращённый промис). Отказ НЕ
 * возвращает записи в буфер: самая частая причина отказа — кончившаяся
 * квота, и вечный повтор только добавил бы отказов к уже случившимся.
 */
export function flushHistory(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (buffer.size === 0) return inflight;
  const pending = buffer;
  buffer = new Map();
  const run = Promise.all([...pending].map(([workspaceId, entries]) => writePending(workspaceId, entries))).then(() => undefined);
  inflight = inflight.then(
    () => run,
    () => run
  );
  return run;
}

export async function logChange(input: LogChangeInput) {
  if (!db) return;
  const entry: HistoryEntry = { id: generateId("hist"), timestamp: Date.now(), ...input };
  const list = buffer.get(input.workspaceId) ?? [];
  list.push(entry);
  buffer.set(input.workspaceId, list);
  if (list.length >= MAX_ENTRIES) {
    void flushHistory();
    return;
  }
  if (!timer) {
    timer = setTimeout(() => {
      timer = null;
      void flushHistory();
    }, FLUSH_MS);
  }
}

if (typeof window !== "undefined") {
  // `visibilitychange` — основной путь: он срабатывает и при переключении
  // вкладки, и когда телефон уводит браузер в фон, то есть пока страница ещё
  // жива и запись успевает уйти. `pagehide` — последний шанс перед закрытием.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushHistory();
  });
  window.addEventListener("pagehide", () => {
    void flushHistory();
  });
}

function jsonValue(value: unknown): string | number | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function rowToEntry(row: HistoryRow): HistoryEntry {
  const entry: HistoryEntry = {
    id: row.id,
    workspaceId: row.workspace_id,
    oldValue: jsonValue(row.old_value),
    newValue: jsonValue(row.new_value),
    action: row.action as HistoryAction,
    userId: row.user_id,
    userName: row.user_name ?? "",
    timestamp: Number(row.ts),
  };
  if (row.page_id) entry.pageId = row.page_id;
  if (row.page_name) entry.pageName = row.page_name;
  if (row.row_id) entry.rowId = row.row_id;
  if (row.field) entry.field = row.field;
  if (row.field_label) entry.fieldLabel = row.field_label;
  return entry;
}

export async function fetchHistory(workspaceId: string, max = 200): Promise<HistoryEntry[]> {
  const q = query(paths.history(workspaceId), orderBy("timestamp", "desc"), fsLimit(max));
  const snap = await getDocs(q);
  return sortHistoryDesc(
    snap.docs.flatMap((d) => expandHistoryDoc(d.id, d.data() as Record<string, unknown>)),
    max
  );
}

export async function deleteHistoryEntry(workspaceId: string, entryId: string) {
  if (!db) return;
  await deleteDoc(paths.historyEntry(workspaceId, entryId));
}

/**
 * Удаление стола: его журнал в Supabase убирается одним DELETE (право —
 * Owner, как и само удаление). Нет таблицы — нечего удалять.
 */
export async function deleteHistoryForPage(workspaceId: string, pageId: string): Promise<void> {
  if (historyBackendFor(workspaceId) !== "supabase") return;
  const { error } = await supabaseRows.from(HISTORY_TABLE).delete().eq("workspace_id", workspaceId).eq("page_id", pageId);
  if (error && !isSbMissingError(error)) throw sbError(error);
}

function fsSubscribeHistory(workspaceId: string, cb: (rows: HistoryEntry[]) => void, max: number) {
  // Свои последние правки ещё лежат в буфере — без этого Owner открывал бы
  // журнал и не видел того, что сделал десять секунд назад.
  void flushHistory();
  const q = query(paths.history(workspaceId), orderBy("timestamp", "desc"), fsLimit(max));
  return onSnapshot(q, (snap) => {
    cb(sortHistoryDesc(snap.docs.flatMap((d) => expandHistoryDoc(d.id, d.data() as Record<string, unknown>)), max));
  });
}

/**
 * Supabase: разовая выборка (по столу — фильтр на сервере, а не 200 записей
 * всего workspace с фильтром в браузере), перечитка по звонку чужой пачки
 * и после своей. Нет таблицы — молча Firestore.
 */
function sbSubscribeHistory(workspaceId: string, cb: (rows: HistoryEntry[]) => void, max: number, pageId?: string) {
  let active = true;
  let stopFs: (() => void) | null = null;
  let stopRing: (() => void) | null = null;
  const load = async () => {
    if (!active) return;
    let q = supabaseRows.from(HISTORY_TABLE).select(HISTORY_COLUMNS).eq("workspace_id", workspaceId);
    if (pageId) q = q.eq("page_id", pageId);
    const { data, error } = await q.order("ts", { ascending: false }).limit(max);
    if (!active) return;
    if (error) {
      if (isSbMissingError(error)) {
        markSbTableMissing("history");
        stopRing?.();
        stopRing = null;
        stopFs = fsSubscribeHistory(workspaceId, cb, max);
        return;
      }
      console.warn("[history] журнал не прочитался", error);
      cb([]);
      return;
    }
    markSbTablePresent("history");
    cb(sortHistoryDesc(((data ?? []) as HistoryRow[]).map(rowToEntry), max));
  };
  stopRing = listenTopic(historyTopic(workspaceId), () => void load());
  void flushHistory().then(load, load);
  return () => {
    active = false;
    stopRing?.();
    stopFs?.();
  };
}

export function subscribeToHistory(
  workspaceId: string,
  cb: (rows: HistoryEntry[]) => void,
  max = 200,
  opts: { pageId?: string; backend?: SbBackend } = {}
) {
  if (!db) {
    cb([]);
    return () => {};
  }
  const backend = opts.backend ?? historyBackendFor(workspaceId);
  if (backend === "supabase") return sbSubscribeHistory(workspaceId, cb, max, opts.pageId);
  return fsSubscribeHistory(workspaceId, cb, max);
}
