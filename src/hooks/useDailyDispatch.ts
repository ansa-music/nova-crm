import { useCallback } from "react";
import { usePolledData } from "@/hooks/usePolledData";
import { listDailyDispatches } from "@/services/dailyDispatchService";
import type { DailyDispatch } from "@/types";

export function useDailyDispatch(workspaceId: string | null, enabled: boolean) {
  const load = useCallback(async () => {
    if (!workspaceId) return [] as DailyDispatch[];
    return listDailyDispatches(workspaceId);
  }, [workspaceId]);

  return usePolledData<DailyDispatch[]>(Boolean(enabled && workspaceId), load, [], [workspaceId]);
}
