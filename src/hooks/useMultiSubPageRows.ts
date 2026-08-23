import { useEffect, useState } from "react";
import { subscribeToSubPageRows } from "@/services/subPageService";
import type { PageRow } from "@/types";

export interface SubPagePair {
  pageId: string;
  subPageId: string;
}

/** Keyed by subPageId (globally unique doc ids, so this is safe even across different parent pages). */
export function useMultiSubPageRows(workspaceId: string | null, pairs: SubPagePair[]) {
  const [rowsBySubPage, setRowsBySubPage] = useState<Record<string, PageRow[]>>({});
  const key = pairs.map((p) => `${p.pageId}:${p.subPageId}`).join(",");

  useEffect(() => {
    if (!workspaceId || pairs.length === 0) {
      setRowsBySubPage({});
      return;
    }
    const unsubscribes = pairs.map((p) =>
      subscribeToSubPageRows(workspaceId, p.pageId, p.subPageId, (rows) => {
        setRowsBySubPage((prev) => ({ ...prev, [p.subPageId]: rows }));
      })
    );
    return () => unsubscribes.forEach((unsub) => unsub());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, key]);

  return rowsBySubPage;
}
