import { useEffect, useSyncExternalStore } from "react";
import { deleteField, writeBatch, type DocumentReference } from "firebase/firestore";
import { db } from "@/firebase/firebase";
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
  type CollectionKey,
  type SbBackend,
} from "@/services/sb/sbCollections";
import { useWorkspaceStore } from "@/store/workspaceStore";

/**
 * Общая механика коллекций, которые переезжают из Firestore в таблицу
 * «документов» Supabase РАЗОВЫМ ПЕРЕНОСОМ (график, Грок, объявления, личная
 * зона; 26.09.2026).
 *
 * Такие коллекции не читаются из двух хранилищ сразу: документы правят по
 * полям (merge), и половина в Firestore, половина в Supabase разъехались бы.
 * Пока в таблице нет отметки `meta/{метка}` («перенос сделан»), ВСЕ читают и
 * пишут Firestore; отметку ставит сессия, которая перенесла документы.
 *
 * Пишут все коллекции одинаково: пачка `{kind, id, op: merge|set|delete,
 * data}` — writeBatch в Firestore или одна RPC `*_write` в Supabase (одна
 * транзакция). Маркер `SB_DEL` в данных = `deleteField()`.
 */

/** Маркер «удалить поле» — deleteField() для Firestore, {"$del": true} для Supabase. */
export const SB_DEL = Object.freeze({ $del: true as const });

export interface DocWrite<K extends string = string> {
  kind: K;
  id: string;
  op: "merge" | "set" | "delete";
  data?: Record<string, unknown>;
  /** Дополнительные поля операции для RPC (например, стол и зона личной зоны). */
  extra?: Record<string, unknown>;
}

export interface DocStoreConfig<K extends string> {
  feed: DocFeedConfig;
  collection: CollectionKey;
  /** RPC записи: (p_workspace, p_ops) → записанные документы. */
  writeRpc: string;
  /** Ключ localStorage для памяти «перенос сделан» (к нему дописывается ws|метка). */
  importedStorageKey: string;
  /** Свой вид ключа localStorage (график хранил `префикс + ws` до общего модуля). */
  storageKeyOf?: (workspaceId: string, mark: string) => string;
  firestoreRef: (workspaceId: string, write: DocWrite<K>) => DocumentReference;
}

/** Маркеры удаления → deleteField() (глубоко, только в простых объектах). */
export function toFirestoreData(value: unknown): unknown {
  if (
    value === SB_DEL ||
    (value && typeof value === "object" && !Array.isArray(value) && (value as { $del?: unknown }).$del === true && Object.keys(value).length === 1)
  ) {
    return deleteField();
  }
  if (value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toFirestoreData(v)]));
  }
  return value;
}

/** Документ Firestore → простой JSON (Timestamp → мс). */
export function plainFirestoreData(value: unknown): unknown {
  if (value && typeof value === "object") {
    const maybe = value as { toMillis?: () => number };
    if (typeof maybe.toMillis === "function") return maybe.toMillis();
    if (Array.isArray(value)) return value.map(plainFirestoreData);
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plainFirestoreData(v)]));
  }
  return value;
}

export function sbError(error: { code?: string; message?: string }): Error {
  return Object.assign(new Error(error.message || "Supabase"), { code: error.code || "unavailable" });
}

function workspaceDoc(workspaceId: string) {
  return useWorkspaceStore.getState().workspaces.find((w) => w.id === workspaceId) ?? null;
}

export function createDocStore<K extends string>(cfg: DocStoreConfig<K>) {
  const imported = new Map<string, boolean>();
  const listeners = new Set<() => void>();
  let version = 0;
  const checks = new Map<string, Promise<boolean>>();
  const pendingWrites = new Set<Promise<unknown>>();

  const flagKey = (workspaceId: string, mark: string) => `${workspaceId}|${mark}`;
  const storageKey = (workspaceId: string, mark: string) =>
    cfg.storageKeyOf ? cfg.storageKeyOf(workspaceId, mark) : cfg.importedStorageKey + flagKey(workspaceId, mark);

  function readImported(workspaceId: string, mark = "imported"): boolean {
    const key = flagKey(workspaceId, mark);
    if (imported.has(key)) return imported.get(key)!;
    try {
      if (window.localStorage.getItem(storageKey(workspaceId, mark)) === "1") {
        imported.set(key, true);
        return true;
      }
    } catch {
      /* без localStorage — только память вкладки */
    }
    return false;
  }

  function setImported(workspaceId: string, value: boolean, mark = "imported") {
    const key = flagKey(workspaceId, mark);
    const prev = readImported(workspaceId, mark);
    imported.set(key, value);
    try {
      if (value) window.localStorage.setItem(storageKey(workspaceId, mark), "1");
      else window.localStorage.removeItem(storageKey(workspaceId, mark));
    } catch {
      /* см. readImported */
    }
    if (prev !== value) {
      version += 1;
      listeners.forEach((fn) => fn());
    }
  }

  /** Строка отметки переноса (или null — нет). Нет таблицы — undefined. */
  async function readImportMeta(workspaceId: string, mark = "imported"): Promise<Record<string, unknown> | null | undefined> {
    const { data, error } = await supabaseRows
      .from(cfg.feed.table)
      .select("data")
      .eq("workspace_id", workspaceId)
      .eq("kind", "meta")
      .eq("id", mark)
      .limit(1);
    if (error) {
      if (isSbMissingError(error)) {
        markSbTableMissing(cfg.collection);
        return undefined;
      }
      throw sbError(error);
    }
    markSbTablePresent(cfg.collection);
    const row = (data ?? [])[0] as { data?: Record<string, unknown> } | undefined;
    return row ? (row.data ?? {}) : null;
  }

  /** Спросить базу, стоит ли отметка переноса. Сеть — «не знаем», прежнее значение. */
  function checkImported(workspaceId: string, mark = "imported"): Promise<boolean> {
    const key = flagKey(workspaceId, mark);
    const running = checks.get(key);
    if (running) return running;
    const run = (async () => {
      try {
        const meta = await readImportMeta(workspaceId, mark);
        if (meta === undefined) {
          setImported(workspaceId, false, mark);
          return false;
        }
        setImported(workspaceId, meta !== null, mark);
        return meta !== null;
      } catch {
        return readImported(workspaceId, mark);
      }
    })().finally(() => checks.delete(key));
    checks.set(key, run);
    return run;
  }

  /** Куда коллекция этого workspace смотрит по настройке (без учёта переноса). */
  function targetFor(workspaceId: string): SbBackend {
    const docWs = workspaceDoc(workspaceId);
    if (!docWs) return "firestore";
    let backend = sbBackendOf(docWs, cfg.collection);
    if (backend === "firestore" && sbTargetOf(docWs, cfg.collection) === "supabase" && sbTableRecheckDue(cfg.collection)) backend = "supabase";
    return backend;
  }

  /** Где коллекция сейчас: Supabase — только после отметки переноса. */
  function backendFor(workspaceId: string, mark = "imported"): SbBackend {
    const backend = targetFor(workspaceId);
    if (backend === "supabase" && !readImported(workspaceId, mark)) return "firestore";
    return backend;
  }

  function subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }

  /**
   * То же для экрана: переподписка, когда перенос сделан (или таблица
   * пропала). Пока отметки нет, экран раз в минуту спрашивает её снова.
   */
  function useBackend(workspaceId: string | null, mark = "imported"): SbBackend | null {
    const workspace = useWorkspaceStore((s) => (workspaceId ? (s.workspaces.find((w) => w.id === workspaceId) ?? null) : null));
    const base = useSbBackend(workspace, cfg.collection);
    useSyncExternalStore(subscribe, () => version, () => version);
    const done = workspaceId ? readImported(workspaceId, mark) : false;
    useEffect(() => {
      if (!workspaceId || base !== "supabase" || done) return;
      const check = () => {
        if (document.visibilityState === "visible") void checkImported(workspaceId, mark);
      };
      check();
      const timer = window.setInterval(check, 60_000);
      return () => window.clearInterval(timer);
    }, [workspaceId, base, done, mark]);
    if (!workspaceId || base === null) return null;
    return base === "supabase" && done ? "supabase" : "firestore";
  }

  async function waitWrites(): Promise<void> {
    while (pendingWrites.size > 0) await Promise.allSettled([...pendingWrites]);
  }

  function parseDocs(data: unknown): SbDoc[] {
    const docs = ((typeof data === "string" ? JSON.parse(data) : data) ?? []) as SbDoc[];
    return docs.map((d) => ({ ...d, data: d.data ?? {}, rev: Number(d.rev) || 0, deleted: Boolean(d.deleted) }));
  }

  /**
   * Пачка записей — одной транзакцией в том хранилище, где коллекция сейчас.
   * Возвращает записанные документы (Supabase) или null (Firestore).
   */
  async function commit(workspaceId: string, writes: DocWrite<K>[], backend?: SbBackend, mark = "imported"): Promise<SbDoc[] | null> {
    if (writes.length === 0) return null;
    if ((backend ?? backendFor(workspaceId, mark)) === "supabase") {
      const run = (async () => {
        const { data, error } = await supabaseRows.rpc(cfg.writeRpc, {
          p_workspace: workspaceId,
          p_ops: writes.map((w) => ({ ...(w.extra ?? {}), kind: w.kind, id: w.id, op: w.op, data: w.data ?? null })),
        });
        if (error) throw sbError(error);
        const docs = parseDocs(data);
        applySbDocs(cfg.feed, workspaceId, docs);
        return docs;
      })();
      pendingWrites.add(run);
      try {
        return await run;
      } finally {
        pendingWrites.delete(run);
      }
    }
    if (!db) throw new Error("Firebase не настроен");
    const batch = writeBatch(db);
    for (const write of writes) {
      const ref = cfg.firestoreRef(workspaceId, write);
      if (write.op === "delete") batch.delete(ref);
      else if (write.op === "set") batch.set(ref, toFirestoreData(write.data ?? {}) as Record<string, unknown>);
      else batch.set(ref, toFirestoreData(write.data ?? {}) as Record<string, unknown>, { merge: true });
    }
    await batch.commit();
    return null;
  }

  return { readImported, setImported, readImportMeta, checkImported, targetFor, backendFor, useBackend, waitWrites, commit, parseDocs };
}

export type DocStore<K extends string> = ReturnType<typeof createDocStore<K>>;
