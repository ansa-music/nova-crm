import { useEffect, useState } from "react";
import { subscribeToHistory } from "@/services/historyService";
import type { HistoryEntry } from "@/types";

export function useHistoryLog(workspaceId: string | null, pageId?: string) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId) {
      setEntries([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const unsubscribe = subscribeToHistory(workspaceId, (data) => {
      setEntries(pageId ? data.filter((e) => e.pageId === pageId) : data);
      setIsLoading(false);
    });
    return unsubscribe;
  }, [workspaceId, pageId]);

  return { entries, isLoading };
}
