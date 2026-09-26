import { useEffect, useSyncExternalStore } from "react";
import { deleteField, getDoc, getDocs, query, where, writeBatch } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { supabaseRows } from "@/lib/supabaseRows";
import { applySbDocs, type DocFeedConfig, type SbDoc } from "@/services/sb/docFeed";
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
import { useWorkspaceStore } from "@/store/workspaceStore";
import { CUSTOM_SCHEDULE_GROUP_ID, WEEK_TEMPLATE_DOC_ID } from "@/types";

/**
 * Где живёт «График» (26.09.2026, SQL 20261011): таблица schedule_docs в
 * Supabase или Firestore, как раньше.
 *
 * В отличие от заказов и чатов, график НЕ читается из двух хранилищ сразу:
 * документ месяца правят по полям (merge), и половина дней в Firestore, а
 * половина в Supabase разъехались бы. Поэтому переезд — разовым переносом:
 * сессия руководства (автопилот недели) копирует документы Firestore в
 * Supabase и ставит отметку `meta/imported`; пока отметки нет, ВСЕ читают и
 * пишут Firestore. Ещё трое суток после переноса та же сессия дочитывает
 * документы, которые поменяли вкладки на старом коде (`schedule_import`
 * берёт только более свежие).
 */

export const SCHEDULE_FEED: DocFeedConfig = { table: "schedule_docs", topic: "schedule", collection: "schedule" };

export type ScheduleKind = "month" | "template" | "group" | "request";

/** Маркер «удалить поле» — deleteField() для Firestore, {"$del": true} для Supabase. */
export const SCHED_DEL = Object.freeze({ $del: true as const });

export interface ScheduleWrite {
  kind: ScheduleKind;
  id: string;
  op: "merge" | "set" | "delete";
  data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------
// Перенесено ли (отметка meta/imported).
// ---------------------------------------------------------------------

const IMPORTED_KEY = "nova:sched-imported:";
const imported = new Map<string, boolean>();
const importedListeners = new Set<() => void>();
let importedVersion = 0;

function readImported(workspaceId: string): boolean {
  if (imported.has(workspaceId)) return imported.get(workspaceId)!;
  try {
    if (window.localStorage.getItem(IMPORTED_KEY + workspaceId) === "1") {
      imported.set(workspaceId, true);
      return true;
    }
  } catch {
    /* без localStorage — только память вкладки */
  }
  return false;
}

function setImported(workspaceId: string, value: boolean) {
  const prev = readImported(workspaceId);
  imported.set(workspaceId, value);
  try {
    if (value) window.localStorage.setItem(IMPORTED_KEY + workspaceId, "1");
    else window.localStorage.removeItem(IMPORTED_KEY + workspaceId);
  } catch {
    /* см. readImported */
  }
  if (prev !== value) {
    importedVersion += 1;
    importedListeners.forEach((fn) => fn());
  }
}

const importedChecks = new Map<string, Promise<boolean>>();

/** Спросить базу, стоит ли отметка переноса. Сеть — «не знаем», прежнее значение. */
export function checkScheduleImported(workspaceId: string): Promise<boolean> {
  const running = importedChecks.get(workspaceId);
  if (running) return running;
  const run = (async () => {
    try {
      const { data, error } = await supabaseRows
        .from(SCHEDULE_FEED.table)
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("kind", "meta")
        .eq("id", "imported")
        .limit(1);
      if (error) {
        if (isSbMissingError(error)) {
          markSbTableMissing("schedule");
          setImported(workspaceId, false);
          return false;
        }
        return readImported(workspaceId);
      }
      markSbTablePresent("schedule");
      const done = (data ?? []).length > 0;
      setImported(workspaceId, done);
      return done;
    } catch {
      return readImported(workspaceId);
    }
  })().finally(() => importedChecks.delete(workspaceId));
  importedChecks.set(workspaceId, run);
  return run;
}

function workspaceDoc(workspaceId: string) {
  return useWorkspaceStore.getState().workspaces.find((w) => w.id === workspaceId) ?? null;
}

/** Где график этого workspace сейчас. */
export function scheduleBackendFor(workspaceId: string): SbBackend {
  const docWs = workspaceDoc(workspaceId);
  if (!docWs) return "firestore";
  let backend = sbBackendOf(docWs, "schedule");
  if (backend === "firestore" && sbTargetOf(docWs, "schedule") === "supabase" && sbTableRecheckDue("schedule")) backend = "supabase";
  if (backend === "supabase" && !readImported(workspaceId)) return "firestore";
  return backend;
}

function subscribeImported(fn: () => void) {
  importedListeners.add(fn);
  return () => {
    importedListeners.delete(fn);
  };
}

/**
 * То же для экрана: переподписка, когда перенос сделан (или таблица
 * пропала). Пока отметки нет, экран раз в минуту спрашивает её снова.
 */
export function useScheduleBackend(workspaceId: string | null): SbBackend | null {
  const workspace = useWorkspaceStore((s) => (workspaceId ? (s.workspaces.find((w) => w.id === workspaceId) ?? null) : null));
  const base = useSbBackend(workspace, "schedule");
  useSyncExternalStore(subscribeImported, () => importedVersion, () => importedVersion);
  const done = workspaceId ? readImported(workspaceId) : false;
  useEffect(() => {
    if (!workspaceId || base !== "supabase" || done) return;
    const check = () => {
      if (document.visibilityState === "visible") void checkScheduleImported(workspaceId);
    };
    check();
    const timer = window.setInterval(check, 60_000);
    return () => window.clearInterval(timer);
  }, [workspaceId, base, done]);
  if (!workspaceId || base === null) return null;
  return base === "supabase" && done ? "supabase" : "firestore";
}

// ---------------------------------------------------------------------
// Запись.
// ---------------------------------------------------------------------

function firestoreRef(workspaceId: string, write: ScheduleWrite) {
  switch (write.kind) {
    case "month":
      return paths.techSchedule(workspaceId, write.id);
    case "template":
      return paths.scheduleTemplate(workspaceId, write.id);
    case "group":
      return paths.scheduleGroup(workspaceId, write.id);
    case "request":
      return paths.scheduleRequest(workspaceId, write.id);
  }
}

/** Маркеры удаления → deleteField() (глубоко, только в простых объектах). */
function toFirestore(value: unknown): unknown {
  if (value === SCHED_DEL || (value && typeof value === "object" && !Array.isArray(value) && (value as { $del?: unknown }).$del === true && Object.keys(value).length === 1)) {
    return deleteField();
  }
  if (value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toFirestore(v)]));
  }
  return value;
}

/** Записи в пути (Supabase): «прошлую неделю» раскладка читает только после них. */
const pendingWrites = new Set<Promise<unknown>>();

export async function waitScheduleWrites(): Promise<void> {
  while (pendingWrites.size > 0) await Promise.allSettled([...pendingWrites]);
}

/**
 * Пачка записей графика — одной транзакцией в том хранилище, где график
 * сейчас (writeBatch в Firestore, schedule_write в Supabase).
 */
export async function commitScheduleWrites(workspaceId: string, writes: ScheduleWrite[], backend?: SbBackend): Promise<void> {
  if (writes.length === 0) return;
  if ((backend ?? scheduleBackendFor(workspaceId)) === "supabase") {
    const run = (async () => {
      const { data, error } = await supabaseRows.rpc("schedule_write", {
        p_workspace: workspaceId,
        p_ops: writes.map((w) => ({ kind: w.kind, id: w.id, op: w.op, data: w.data ?? null })),
      });
      if (error) throw Object.assign(new Error(error.message || "Supabase"), { code: error.code || "unavailable" });
      const docs = ((typeof data === "string" ? JSON.parse(data) : data) ?? []) as SbDoc[];
      applySbDocs(SCHEDULE_FEED, workspaceId, docs.map((d) => ({ ...d, rev: Number(d.rev) || 0, deleted: Boolean(d.deleted) })));
    })();
    pendingWrites.add(run);
    try {
      await run;
    } finally {
      pendingWrites.delete(run);
    }
    return;
  }
  if (!db) throw new Error("Firebase не настроен");
  const batch = writeBatch(db);
  for (const write of writes) {
    const ref = firestoreRef(workspaceId, write);
    if (write.op === "delete") batch.delete(ref);
    else if (write.op === "set") batch.set(ref, toFirestore(write.data ?? {}) as Record<string, unknown>);
    else batch.set(ref, toFirestore(write.data ?? {}) as Record<string, unknown>, { merge: true });
  }
  await batch.commit();
}

// ---------------------------------------------------------------------
// Редакторы графика — копия `scheduleSettings.editors` в Supabase (по ней
// schedule_write пускает назначенного Owner человека). Пишет только Owner:
// сразу при сохранении настройки и сверкой при загрузке его сессии.
// ---------------------------------------------------------------------

export async function pushScheduleEditors(workspaceId: string, editors: string[]): Promise<void> {
  const docWs = workspaceDoc(workspaceId);
  if (docWs?.rowsBackend !== "supabase") return;
  const { error } = await supabaseRows.rpc("rows_set_schedule_editors", { p_workspace: workspaceId, p_editors: editors });
  if (error && !isSbMissingError(error)) throw Object.assign(new Error(error.message || "Supabase"), { code: error.code });
}

/** Сверка копии с Firestore (сессия Owner). true — поправили. */
export async function reconcileScheduleEditors(workspaceId: string, wanted: string[]): Promise<boolean> {
  const { data, error } = await supabaseRows.rpc("rows_schedule_editors", { p_workspace: workspaceId });
  if (error) return false;
  const have = [...((data as string[] | null) ?? [])].sort().join(",");
  const want = [...new Set(wanted)].sort().join(",");
  if (have === want) return false;
  await pushScheduleEditors(workspaceId, wanted);
  return true;
}

// ---------------------------------------------------------------------
// Перенос Firestore → Supabase (сессия руководства).
// ---------------------------------------------------------------------

/** Сколько после переноса ещё дочитывать правки вкладок на старом коде. */
const TAIL_DAYS_MS = 3 * 24 * 60 * 60_000;
const IMPORT_CHUNK = 400;

async function sbImport(workspaceId: string, docs: Array<{ kind: ScheduleKind; id: string; data: unknown }>, done: boolean) {
  for (let i = 0; i < Math.max(docs.length, 1); i += IMPORT_CHUNK) {
    const chunk = docs.slice(i, i + IMPORT_CHUNK);
    const last = i + IMPORT_CHUNK >= docs.length;
    const { error } = await supabaseRows.rpc("schedule_import", { p_workspace: workspaceId, p_docs: chunk, p_done: done && last });
    if (error) throw Object.assign(new Error(error.message || "Supabase"), { code: error.code });
  }
}

/** Документ Firestore → простой JSON (Timestamp → мс). */
function plain(value: unknown): unknown {
  if (value && typeof value === "object") {
    const maybe = value as { toMillis?: () => number };
    if (typeof maybe.toMillis === "function") return maybe.toMillis();
    if (Array.isArray(value)) return value.map(plain);
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  }
  return value;
}

/**
 * Перенести график в Supabase, если пора: строки в Supabase, таблица есть,
 * отметки нет. После отметки трое суток дочитывает правки старых вкладок.
 * Возвращает, сколько документов отправлено (0 — ничего не делали).
 */
export async function ensureScheduleImported(workspaceId: string): Promise<number> {
  const docWs = workspaceDoc(workspaceId);
  if (!db || !docWs || sbTargetOf(docWs, "schedule") !== "supabase") return 0;
  const { data: metaRows, error } = await supabaseRows
    .from(SCHEDULE_FEED.table)
    .select("data")
    .eq("workspace_id", workspaceId)
    .eq("kind", "meta")
    .eq("id", "imported")
    .limit(1);
  if (error) {
    if (isSbMissingError(error)) markSbTableMissing("schedule");
    return 0;
  }
  markSbTablePresent("schedule");
  const meta = ((metaRows ?? [])[0] as { data?: { at?: number; tailAt?: number } } | undefined)?.data ?? null;
  const now = Date.now();
  if (meta && meta.at && now - meta.at > TAIL_DAYS_MS) {
    setImported(workspaceId, true);
    return 0;
  }

  const docs: Array<{ kind: ScheduleKind; id: string; data: unknown }> = [];
  // Правки после прошлой дочитки (с запасом на расхождение часов); полный
  // перенос — всё.
  const since = meta ? (meta.tailAt ?? meta.at ?? 0) - 10 * 60_000 : 0;
  const months = since
    ? await getDocs(query(paths.techSchedulesAll(workspaceId), where("updatedAt", ">", since)))
    : await getDocs(paths.techSchedulesAll(workspaceId));
  for (const d of months.docs) docs.push({ kind: "month", id: d.id, data: plain(d.data()) });
  const week = await getDoc(paths.scheduleTemplate(workspaceId, WEEK_TEMPLATE_DOC_ID));
  if (week.exists()) docs.push({ kind: "template", id: week.id, data: plain(week.data()) });
  const group = await getDoc(paths.scheduleGroup(workspaceId, CUSTOM_SCHEDULE_GROUP_ID));
  if (group.exists()) docs.push({ kind: "group", id: group.id, data: plain(group.data()) });
  const requests = since
    ? await getDocs(query(paths.scheduleRequestsAll(workspaceId), where("status", "==", "pending")))
    : await getDocs(paths.scheduleRequestsAll(workspaceId));
  for (const d of requests.docs) docs.push({ kind: "request", id: d.id, data: plain(d.data()) });

  await sbImport(workspaceId, docs, true);
  setImported(workspaceId, true);
  return docs.length;
}
