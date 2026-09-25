import { supabaseRows } from "@/lib/supabaseRows";
import { isSbMissingError } from "@/services/sb/sbCollections";

/**
 * Какой SQL стоит в базе Supabase — `nova_schema_version()` (заводит
 * миграция 20261002 и каждая следующая, которой нужен клиент).
 *
 * Таблицы коллекций («нет таблицы — идём в Firestore») плашка Owner видит и
 * так, а новые ФУНКЦИИ молча выключаются, пока SQL не вставлен: статус от ОС
 * к технарю в той же записи (`desk_rows_os_status_push`) и забор заказов
 * технарей с ником ОС (`rows_os_claim_order`). Деплой SQL не накатывает —
 * вставляет Nurba, — поэтому о свежем SQL он должен узнать плашкой, а не
 * жалобой «статус не доходит».
 */

/** Самый свежий SQL, без которого эта сборка работает не целиком. */
export const REQUIRED_SQL_VERSION = "20261010";

export type SchemaVersionState = "unknown" | "ok" | "old";

const RECHECK_MS = 10 * 60_000;
let state: SchemaVersionState = "unknown";
let checkedAt = 0;
let tick = 0;
const listeners = new Set<() => void>();
let running: Promise<SchemaVersionState> | null = null;

function setState(next: SchemaVersionState) {
  checkedAt = Date.now();
  if (next === state) return;
  state = next;
  tick += 1;
  listeners.forEach((fn) => fn());
}

/** Версия из ответа функции — строка '20261002' (или обёртка, число). null — не разобрать. */
export function schemaVersionOf(data: unknown): string | null {
  let value = Array.isArray(data) ? data[0] : data;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    value = record.nova_schema_version ?? record.version ?? null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Версия базы не старше нужной этой сборке. Версии — даты `YYYYMMDD[буква]`, сравниваются строкой. */
export function isSchemaVersionOk(version: string | null, required = REQUIRED_SQL_VERSION): boolean {
  return Boolean(version && version >= required);
}

export function schemaVersionState(): SchemaVersionState {
  return state;
}

/** «Старый SQL» сказано давно — пора переспросить (SQL могли вставить). */
export function schemaVersionRecheckDue(): boolean {
  return state === "old" && Date.now() - checkedAt >= RECHECK_MS;
}

/**
 * Спросить базу. Функции нет (PGRST202 / 42883) — SQL старее 20261002.
 * Сеть и прочие ошибки состояние не меняют: «нет связи» не значит «старый SQL».
 */
export function probeSchemaVersion(): Promise<SchemaVersionState> {
  if (running) return running;
  running = (async (): Promise<SchemaVersionState> => {
    try {
      const { data, error } = await supabaseRows.rpc("nova_schema_version");
      if (!error) setState(isSchemaVersionOk(schemaVersionOf(data)) ? "ok" : "old");
      else if (isSbMissingError(error)) setState("old");
    } catch {
      /* сеть — ответа нет */
    }
    return state;
  })().finally(() => {
    running = null;
  });
  return running;
}

export function subscribeSchemaVersion(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Растёт при каждой смене состояния — для useSyncExternalStore. */
export function schemaVersionTick(): number {
  return tick;
}
