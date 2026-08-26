import { useEffect, useState } from "react";
import { subscribeToHistory } from "@/services/historyService";
import type { HistoryEntry } from "@/types";

export function useHistoryLog(workspaceId: string | null, pageId?: string) {
  const [data, setData] = useState<HistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(Boolean(workspaceId));

  useEffect(() => {
    if (!workspaceId) {
      setData([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const unsubscribe = subscribeToHistory(workspaceId, (next) => {
      setData(next);
      setIsLoading(false);
    });
    return unsubscribe;
  }, [workspaceId]);

  const entries = pageId ? data.filter((e) => e.pageId === pageId) : data;

  return {
    entries,
    isLoading,
    reload: () => {
      /* live onSnapshot already feeds `data` */
    },
  };
}
