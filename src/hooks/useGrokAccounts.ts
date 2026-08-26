import { useEffect, useState } from "react";
import { subscribeToGrokAccounts } from "@/services/grokAccountService";
import type { GrokAccount } from "@/types";

/**
 * Live Firestore listener, not a poll — see the note on
 * subscribeToGrokAccounts for why this one screen is exempt from the
 * usual Spark-plan polling pattern.
 */
export function useGrokAccounts(workspaceId: string | null) {
  const [accounts, setAccounts] = useState<GrokAccount[]>([]);
  const [isLoading, setIsLoading] = useState(Boolean(workspaceId));

  useEffect(() => {
    if (!workspaceId) {
      setAccounts([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const unsubscribe = subscribeToGrokAccounts(workspaceId, (next) => {
      setAccounts(next);
      setIsLoading(false);
    });
    return unsubscribe;
  }, [workspaceId]);

  return { accounts, isLoading };
}
