import { useCallback } from "react";
import { usePolledData } from "@/hooks/usePolledData";
import { listMyDispatchRequests } from "@/services/dailyDispatchService";
import type { DailyDispatch } from "@/types";

export function useMyDispatchRequests(workspaceId: string | null, uid: string | null, enabled: boolean) {
  const load = useCallback(async () => {
    if (!workspaceId || !uid) return [] as DailyDispatch[];
    return listMyDispatchRequests(workspaceId, uid);
  }, [workspaceId, uid]);

  return usePolledData<DailyDispatch[]>(Boolean(enabled && workspaceId && uid), load, [], [workspaceId, uid]);
}
