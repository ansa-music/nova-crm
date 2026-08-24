import { fetchHistory } from "@/services/historyService";
import { usePolledData } from "@/hooks/usePolledData";
import type { HistoryEntry } from "@/types";

export function useHistoryLog(workspaceId: string | null, pageId?: string) {
  const { data, isLoading } = usePolledData<HistoryEntry[]>(
    Boolean(workspaceId),
    () => fetchHistory(workspaceId as string),
    [],
    [workspaceId]
  );

  const entries = pageId ? data.filter((e) => e.pageId === pageId) : data;

  return { entries, isLoading };
}
