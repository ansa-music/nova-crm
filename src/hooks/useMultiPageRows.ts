import { useEffect, useState } from "react";
import { fetchRows } from "@/services/pageService";
import type { PageRow } from "@/types";

const BATCH = 3;

function yieldPaint() {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

/**
 * Dashboard aggregate rows. One-shot getDocs in small batches — never an
 * onSnapshot per desk (Spark cannot afford N live row listeners).
 */
export function useMultiPageRows(workspaceId: string | null, pageIds: string[]) {
  const [rowsByPage, setRowsByPage] = useState<Record<string, PageRow[]>>({});
  const key = pageIds.join(",");

  useEffect(() => {
    if (!workspaceId || pageIds.length === 0) {
      setRowsByPage({});
      return;
    }

    let cancelled = false;
    setRowsByPage({});

    async function loadSlice(ids: string[]) {
      await Promise.all(
        ids.map(async (pageId) => {
          try {
            const rows = await fetchRows(workspaceId as string, pageId);
            if (!cancelled) setRowsByPage((prev) => ({ ...prev, [pageId]: rows }));
          } catch {
            if (!cancelled) setRowsByPage((prev) => ({ ...prev, [pageId]: prev[pageId] ?? [] }));
          }
        })
      );
    }

    void (async () => {
      await loadSlice(pageIds.slice(0, BATCH));
      for (let i = BATCH; i < pageIds.length; i += BATCH) {
        if (cancelled) return;
        await yieldPaint();
        if (cancelled) return;
        await loadSlice(pageIds.slice(i, i + BATCH));
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, key]);

  return rowsByPage;
}
