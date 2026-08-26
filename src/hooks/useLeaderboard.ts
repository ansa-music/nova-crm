import { useEffect, useState } from "react";
import { subscribeLeaderboard } from "@/services/leaderboardService";
import type { LeaderboardEntry } from "@/types";

export function useLeaderboard(workspaceId: string | null) {
  const [data, setData] = useState<LeaderboardEntry[]>([]);

  useEffect(() => {
    if (!workspaceId) {
      setData([]);
      return;
    }
    return subscribeLeaderboard(workspaceId, setData);
  }, [workspaceId]);

  return data;
}
