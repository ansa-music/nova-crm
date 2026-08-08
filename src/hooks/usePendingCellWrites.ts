import { useCallback, useRef, useState } from "react";

export type PendingCellState = "idle" | "saving" | "saved" | "error";
type CellValue = string | number | null;
interface PendingCell { value: CellValue; version: number; state: PendingCellState; }

/**
 * Local overlay and per-cell versioning for realtime tables. Consumers must
 * render resolve(rowId, field, snapshotValue), not snapshotValue directly.
 * A stale listener snapshot can therefore never erase a newer local value.
 */
export function usePendingCellWrites() {
  const [pending, setPending] = useState<Record<string, PendingCell>>({});
  const versions = useRef<Record<string, number>>({});
  const key = (rowId: string, field: string) => `${rowId}:${field}`;

  const begin = useCallback((rowId: string, field: string, value: CellValue) => {
    const cellKey = key(rowId, field);
    const version = (versions.current[cellKey] ?? 0) + 1;
    versions.current[cellKey] = version;
    setPending((current) => ({ ...current, [cellKey]: { value, version, state: "saving" } }));
    return version;
  }, []);

  const confirm = useCallback((rowId: string, field: string, version: number) => {
    const cellKey = key(rowId, field);
    if (versions.current[cellKey] !== version) return;
    setPending((current) => ({ ...current, [cellKey]: { ...current[cellKey], state: "saved" } }));
  }, []);

  const fail = useCallback((rowId: string, field: string, version: number) => {
    const cellKey = key(rowId, field);
    if (versions.current[cellKey] !== version) return;
    setPending((current) => ({ ...current, [cellKey]: { ...current[cellKey], state: "error" } }));
  }, []);

  const resolve = useCallback((rowId: string, field: string, snapshotValue: CellValue) => {
    return pending[key(rowId, field)]?.value ?? snapshotValue;
  }, [pending]);

  const state = useCallback((rowId: string, field: string): PendingCellState => {
    return pending[key(rowId, field)]?.state ?? "idle";
  }, [pending]);

  const retryValue = useCallback((rowId: string, field: string): CellValue | undefined => {
    return pending[key(rowId, field)]?.value;
  }, [pending]);

  return { begin, confirm, fail, resolve, state, retryValue };
}
