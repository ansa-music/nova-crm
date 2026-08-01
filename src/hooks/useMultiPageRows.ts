import { useEffect, useState } from "react";
import { subscribeToRows } from "@/services/pageService";
import type { PageRow } from "@/types";

export function useMultiPageRows(workspaceId: string | null, pageIds: string[]) {
  const [rowsByPage, setRowsByPage] = useState<Record<string, PageRow[]>>({});
  const key = pageIds.join(",");

  useEffect(() => {
    if (!workspaceId || pageIds.length === 0) {
      setRowsByPage({});
      return;
    }
    const unsubscribes = pageIds.map((pageId) =>
      subscribeToRows(workspaceId, pageId, (rows) => {
        setRowsByPage((prev) => ({ ...prev, [pageId]: rows }));
      })
    );
    return () => unsubscribes.forEach((unsub) => unsub());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, key]);

  return rowsByPage;
}
