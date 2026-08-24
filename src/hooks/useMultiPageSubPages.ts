import { useEffect, useState } from "react";
import { fetchSubPages } from "@/services/subPageService";
import type { SubPage } from "@/types";

const BATCH = 4;

function yieldPaint() {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

export function useMultiPageSubPages(workspaceId: string | null, pageIds: string[]) {
  const [subPagesByPage, setSubPagesByPage] = useState<Record<string, SubPage[]>>({});
  const key = pageIds.join(",");

  useEffect(() => {
    if (!workspaceId || pageIds.length === 0) {
      setSubPagesByPage({});
      return;
    }

    let cancelled = false;
    setSubPagesByPage({});

    async function loadSlice(ids: string[]) {
      await Promise.all(
        ids.map(async (pageId) => {
          try {
            const subPages = await fetchSubPages(workspaceId as string, pageId);
            if (!cancelled) setSubPagesByPage((prev) => ({ ...prev, [pageId]: subPages }));
          } catch {
            if (!cancelled) setSubPagesByPage((prev) => ({ ...prev, [pageId]: prev[pageId] ?? [] }));
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

  return subPagesByPage;
}
