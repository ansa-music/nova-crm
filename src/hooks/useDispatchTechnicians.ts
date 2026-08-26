import { useCallback } from "react";
import { usePolledData } from "@/hooks/usePolledData";
import { listDispatchTechnicians } from "@/services/dispatchTechnicianService";
import type { DispatchTechnician } from "@/types";

export function useDispatchTechnicians(workspaceId: string | null, enabled: boolean) {
  const load = useCallback(async () => {
    if (!workspaceId) return [] as DispatchTechnician[];
    return listDispatchTechnicians(workspaceId);
  }, [workspaceId]);

  return usePolledData<DispatchTechnician[]>(Boolean(enabled && workspaceId), load, [], [workspaceId]);
}
