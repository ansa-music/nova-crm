import { useEffect, useState } from "react";
import { subscribeToGrokAppAccounts } from "@/services/grokAppAccountService";
import type { GrokAppAccount } from "@/types/grokAppAccount";

/**
 * Живой список на экране «Грок лимит». `seesAll` — Owner/Тимлид: они читают
 * коллекцию целиком, остальным сервис отдаёт открытые аккаунты плюс те, куда
 * их пустили (два запроса вместо одного, см. сервис).
 */
export function useGrokAppAccounts(workspaceId: string | null, viewer: { seesAll: boolean; uid: string }) {
  const [accounts, setAccounts] = useState<GrokAppAccount[]>([]);
  const [isLoading, setIsLoading] = useState(Boolean(workspaceId));
  const { seesAll, uid } = viewer;

  useEffect(() => {
    if (!workspaceId || (!seesAll && !uid)) {
      setAccounts([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const unsubscribe = subscribeToGrokAppAccounts(
      workspaceId,
      (next) => {
        setAccounts(next);
        setIsLoading(false);
      },
      { seesAll, uid }
    );
    return unsubscribe;
  }, [workspaceId, seesAll, uid]);

  return { accounts, isLoading };
}
