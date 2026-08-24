import { useEffect, useState } from "react";
import { fetchSubPageRows } from "@/services/subPageService";
import type { PageRow } from "@/types";

export interface SubPagePair {
  pageId: string;
  subPageId: string;
}

const BATCH = 3;

function yieldPaint() {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

/** Keyed by subPageId. One-shot reads — no live listeners. */
export function useMultiSubPageRows(workspaceId: string | null, pairs: SubPagePair[]) {
  const [rowsBySubPage, setRowsBySubPage] = useState<Record<string, PageRow[]>>({});
  const key = pairs.map((p) => `${p.pageId}:${p.subPageId}`).join(",");

  useEffect(() => {
    if (!workspaceId || pairs.length === 0) {
      setRowsBySubPage({});
      return;
    }

    let cancelled = false;
    setRowsBySubPage({});

    async function loadSlice(slice: SubPagePair[]) {
      await Promise.all(
        slice.map(async (p) => {
          try {
            const rows = await fetchSubPageRows(workspaceId as string, p.pageId, p.subPageId);
            if (!cancelled) setRowsBySubPage((prev) => ({ ...prev, [p.subPageId]: rows }));
          } catch {
            if (!cancelled) setRowsBySubPage((prev) => ({ ...prev, [p.subPageId]: prev[p.subPageId] ?? [] }));
          }
        })
      );
    }

    void (async () => {
      await loadSlice(pairs.slice(0, BATCH));
      for (let i = BATCH; i < pairs.length; i += BATCH) {
        if (cancelled) return;
        await yieldPaint();
        if (cancelled) return;
        await loadSlice(pairs.slice(i, i + BATCH));
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, key]);

  return rowsBySubPage;
}
