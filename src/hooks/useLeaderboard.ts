import { useEffect, useState } from "react";
import { subscribeToLeaderboard } from "@/services/leaderboardService";
import type { LeaderboardEntry } from "@/types";

export function useLeaderboard(workspaceId: string | null) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);

  useEffect(() => {
    if (!workspaceId) {
      setEntries([]);
      return;
    }
    return subscribeToLeaderboard(workspaceId, setEntries);
  }, [workspaceId]);

  return entries;
}
