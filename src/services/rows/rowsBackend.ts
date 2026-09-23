import type { RowsBackend, RowsMigrationStamp } from "@/types/workspace";

/** Начало переноса в мс: серверное время (Timestamp) или старое число. */
export function migrationStartMillis(value: RowsMigrationStamp | undefined): number | null {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && typeof value.toMillis === "function") return value.toMillis();
  return null;
}

/**
 * Где сейчас живут строки таблиц этого workspace — Firestore или Supabase.
 *
 * Значение приходит из документа workspace (он и так живой у каждой сессии,
 * лишних чтений нет) и лежит на модуле: сервисы строк (`pageService`,
 * `subPageService` и др.) — обычные функции, React-контекста у них нет.
 * Пока документ не пришёл, значение НЕИЗВЕСТНО, и таблица ждёт: иначе при
 * включённом Supabase она успела бы подписаться на замёрзшие строки Firestore.
 */
interface BackendState {
  backend: RowsBackend;
  /** Идёт перенос строк — правки запрещены до конца. */
  migrating: boolean;
}

const states = new Map<string, BackendState>();
const listeners = new Set<() => void>();
let version = 0;

export function setRowsBackendState(workspaceId: string, backend: RowsBackend | undefined, migrating: boolean) {
  const next: BackendState = { backend: backend === "supabase" ? "supabase" : "firestore", migrating };
  const prev = states.get(workspaceId);
  if (prev && prev.backend === next.backend && prev.migrating === next.migrating) return;
  states.set(workspaceId, next);
  version += 1;
  listeners.forEach((fn) => fn());
}

/**
 * Первое значение — ещё при отрисовке `AppLayout`, ДО того как отрисуется
 * стол: эффекты дочерних компонентов идут раньше эффектов родителя, и таблица
 * иначе успела бы подписаться на строки не того хранилища. Без оповещения
 * подписчиков (обновлять чужие компоненты посреди отрисовки React не даёт);
 * только если значение ещё неизвестно — дальше работает `setRowsBackendState`.
 */
export function primeRowsBackendState(workspaceId: string, backend: RowsBackend | undefined, migrating: boolean) {
  if (states.has(workspaceId)) return;
  states.set(workspaceId, { backend: backend === "supabase" ? "supabase" : "firestore", migrating });
  version += 1;
}

export function rowsBackendKnown(workspaceId: string): boolean {
  return states.has(workspaceId);
}

export function rowsBackendOf(workspaceId: string): RowsBackend {
  return states.get(workspaceId)?.backend ?? "firestore";
}

export function usesSupabaseRows(workspaceId: string): boolean {
  return rowsBackendOf(workspaceId) === "supabase";
}

export function rowsMigrating(workspaceId: string): boolean {
  return states.get(workspaceId)?.migrating ?? false;
}

export class RowsMigratingError extends Error {
  code = "rows-migrating";
  constructor() {
    super("Идёт перенос строк таблиц — правки временно не сохраняются. Подождите пару минут.");
  }
}

/**
 * Бросает, если идёт перенос: правка в этот момент ушла бы не туда.
 *
 * «Хранилище ещё не известно» здесь НЕ проверяется: запись в Firestore, когда
 * строки уже в Supabase, отклоняют сами правила Firestore (`rowsOnSupabase`
 * в firestore.rules) — это граница и для вкладок со старым кодом.
 */
export function assertRowsWritable(workspaceId: string) {
  if (rowsMigrating(workspaceId)) throw new RowsMigratingError();
}

export function subscribeRowsBackend(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Для useSyncExternalStore: меняется только при настоящей смене. */
export function rowsBackendVersion(): number {
  return version;
}
