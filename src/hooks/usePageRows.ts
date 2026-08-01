import { useEffect, useState } from "react";
import { subscribeToRows } from "@/services/pageService";
import type { PageRow } from "@/types";

export function usePageRows(workspaceId: string | null, pageId: string | null) {
  const [rows, setRows] = useState<PageRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId || !pageId) {
      setRows([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const unsubscribe = subscribeToRows(workspaceId, pageId, (data) => {
      setRows(data);
      setIsLoading(false);
    });
    return unsubscribe;
  }, [workspaceId, pageId]);

  return { rows, isLoading };
}
