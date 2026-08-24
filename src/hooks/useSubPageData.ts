import { useEffect, useState } from "react";
import { subscribeToSubPages } from "@/services/subPageService";
import { useSyncedTableRows } from "@/hooks/usePageRows";
import type { SubPage } from "@/types";

export function useSubPages(workspaceId: string | null, pageId: string | null) {
  const [subPages, setSubPages] = useState<SubPage[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId || !pageId) {
      setSubPages([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const unsubscribe = subscribeToSubPages(workspaceId, pageId, (data) => {
      setSubPages(data);
      setIsLoading(false);
    });
    return unsubscribe;
  }, [workspaceId, pageId]);

  return { subPages, isLoading };
}

export function useSubPageRows(workspaceId: string | null, pageId: string | null, subPageId: string | null) {
  return useSyncedTableRows(workspaceId, subPageId ? pageId : null, subPageId);
}
