import { useEffect, useMemo, useRef, useState } from "react";
import { subscribeToRows } from "@/services/pageService";
import { subscribeToSubPageRows } from "@/services/subPageService";
import {
  copyMissingRowRecords,
  mergeFirestoreAndSupabaseRows,
  subscribeToRowRecords,
} from "@/services/rowRecordsService";
import type { PageRow } from "@/types";

/**
 * Supabase `row_records` is the table query source when reachable.
 * Firestore is always subscribed: copy-on-open, dual-write fallback, and
 * existence (a UI delete removes that one row in both stores; this hook
 * never wipes Firestore).
 */
export function useSyncedTableRows(
  workspaceId: string | null,
  pageId: string | null,
  subPageId: string | null
) {
  const [firestoreRows, setFirestoreRows] = useState<PageRow[]>([]);
  const [supabaseRows, setSupabaseRows] = useState<PageRow[] | null>(null);
  const [supabaseOk, setSupabaseOk] = useState(false);
  const [fsReady, setFsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const copyKeyRef = useRef<string>("");

  useEffect(() => {
    if (!workspaceId || !pageId) {
      setFirestoreRows([]);
      setSupabaseRows(null);
      setSupabaseOk(false);
      setFsReady(false);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setFsReady(false);
    setSupabaseOk(false);
    setSupabaseRows(null);
    copyKeyRef.current = "";

    const onFs = (data: PageRow[]) => {
      setFirestoreRows(data);
      setFsReady(true);
      setIsLoading(false);
    };

    const unsubFs = subPageId
      ? subscribeToSubPageRows(workspaceId, pageId, subPageId, onFs)
      : subscribeToRows(workspaceId, pageId, onFs);

    const unsubSb = subscribeToRowRecords(
      pageId,
      subPageId,
      (data) => setSupabaseRows(data),
      (ok) => setSupabaseOk(ok)
    );

    return () => {
      unsubFs();
      unsubSb();
    };
  }, [workspaceId, pageId, subPageId]);

  useEffect(() => {
    if (!workspaceId || !pageId || !fsReady || !supabaseOk) return;
    const key = `${pageId}:${subPageId ?? "main"}:${firestoreRows.map((r) => `${r.id}:${r.updatedAt}`).join("|")}`;
    if (copyKeyRef.current === key) return;
    copyKeyRef.current = key;
    void copyMissingRowRecords(workspaceId, pageId, subPageId, firestoreRows).catch(() => undefined);
  }, [workspaceId, pageId, subPageId, firestoreRows, fsReady, supabaseOk]);

  const rows = useMemo(
    () => mergeFirestoreAndSupabaseRows(firestoreRows, supabaseOk ? supabaseRows : null),
    [firestoreRows, supabaseRows, supabaseOk]
  );

  return { rows, isLoading };
}

export function usePageRows(workspaceId: string | null, pageId: string | null) {
  return useSyncedTableRows(workspaceId, pageId, null);
}
