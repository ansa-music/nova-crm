import { useSyncExternalStore } from "react";
import {
  rowsBackendKnown,
  rowsBackendOf,
  rowsBackendVersion,
  subscribeRowsBackend,
} from "@/services/rows/rowsBackend";
import type { RowsBackend } from "@/types/workspace";

/**
 * Где живут строки этого workspace — для хуков, которым при переключении
 * надо переподписаться. `null` — ещё неизвестно (документ workspace не пришёл).
 */
export function useRowsBackend(workspaceId: string | null): RowsBackend | null {
  useSyncExternalStore(subscribeRowsBackend, rowsBackendVersion, rowsBackendVersion);
  if (!workspaceId || !rowsBackendKnown(workspaceId)) return null;
  return rowsBackendOf(workspaceId);
}
