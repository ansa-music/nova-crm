import { useEffect } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { migrationStartMillis, primeRowsBackendState, setRowsBackendState } from "@/services/rows/rowsBackend";

/**
 * Перенос строк, брошенный на середине (закрыли вкладку, пропала связь),
 * не должен запирать правку у всех навсегда: флаг старше этого — считается
 * мёртвым, а на экране «Строки таблиц» Owner видит, что перенос завис.
 */
export const ROWS_MIGRATION_STALE_MS = 15 * 60 * 1000;

/**
 * Где живут строки — из документа workspace (он и так живой у каждой
 * сессии) в модуль `rowsBackend`, откуда его читают сервисы строк.
 */
export function useRowsBackendBridge() {
  const { activeWorkspace } = useWorkspace();
  const id = activeWorkspace?.id ?? null;
  const backend = activeWorkspace?.rowsBackend;
  const migrationAt = migrationStartMillis(activeWorkspace?.rowsMigrationAt);

  if (id) {
    primeRowsBackendState(
      id,
      backend,
      typeof migrationAt === "number" && Date.now() - migrationAt < ROWS_MIGRATION_STALE_MS
    );
  }

  useEffect(() => {
    if (!id) return;
    const apply = () => {
      const migrating = typeof migrationAt === "number" && Date.now() - migrationAt < ROWS_MIGRATION_STALE_MS;
      setRowsBackendState(id, backend, migrating);
    };
    apply();
    if (typeof migrationAt !== "number") return;
    // Флаг сам «протухает» — перепроверяем, когда истечёт.
    const left = migrationAt + ROWS_MIGRATION_STALE_MS - Date.now();
    if (left <= 0) return;
    const timer = window.setTimeout(apply, left + 1000);
    return () => window.clearTimeout(timer);
  }, [id, backend, migrationAt]);
}
