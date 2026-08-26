import { useEffect, useState } from "react";
import { subscribeToGrokAppAccounts } from "@/services/grokAppAccountService";
import type { GrokAppAccount } from "@/types/grokAppAccount";

/** Live listener for the Grok Limit → Подписки page only. Unsubscribes on leave. */
export function useGrokAppAccounts(workspaceId: string | null) {
  const [accounts, setAccounts] = useState<GrokAppAccount[]>([]);
  const [isLoading, setIsLoading] = useState(Boolean(workspaceId));

  useEffect(() => {
    if (!workspaceId) {
      setAccounts([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const unsubscribe = subscribeToGrokAppAccounts(workspaceId, (next) => {
      setAccounts(next);
      setIsLoading(false);
    });
    return unsubscribe;
  }, [workspaceId]);

  return { accounts, isLoading };
}
