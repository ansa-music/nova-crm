import { useCallback } from "react";
import { usePolledData } from "@/hooks/usePolledData";
import { listDailyDispatches } from "@/services/dailyDispatchService";
import type { DailyDispatch } from "@/types";

export function useDailyDispatch(workspaceId: string | null, pageId: string | null, enabled: boolean) {
  const load = useCallback(async () => {
    if (!workspaceId || !pageId) return [] as DailyDispatch[];
    return listDailyDispatches(workspaceId, pageId);
  }, [workspaceId, pageId]);

  return usePolledData<DailyDispatch[]>(
    Boolean(enabled && workspaceId && pageId),
    load,
    [],
    [workspaceId, pageId]
  );
}
