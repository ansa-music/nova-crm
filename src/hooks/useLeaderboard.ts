import { fetchLeaderboard } from "@/services/leaderboardService";
import { usePolledData } from "@/hooks/usePolledData";
import type { LeaderboardEntry } from "@/types";

export function useLeaderboard(workspaceId: string | null) {
  const { data } = usePolledData<LeaderboardEntry[]>(
    Boolean(workspaceId),
    () => fetchLeaderboard(workspaceId as string),
    [],
    [workspaceId]
  );
  return data;
}
