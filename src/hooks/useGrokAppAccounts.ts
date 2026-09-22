import { useEffect, useState } from "react";
import { subscribeToGrokAppAccounts } from "@/services/grokAppAccountService";
import type { GrokAppAccount, GrokAppProvider } from "@/types/grokAppAccount";

/**
 * Живой список на экране «Грок лимит». `seesAll` — Owner/Тимлид: они читают
 * коллекцию целиком; остальным сервис отдаёт открытые аккаунты, те, куда их
 * пустили, и все аккаунты провайдеров, которыми человек управляет.
 * `complete` — все запросы ответили с сервера (см. сервис).
 */
export function useGrokAppAccounts(
  workspaceId: string | null,
  viewer: { seesAll: boolean; uid: string; managedProviders?: GrokAppProvider[] }
) {
  const [accounts, setAccounts] = useState<GrokAppAccount[]>([]);
  const [isLoading, setIsLoading] = useState(Boolean(workspaceId));
  const [complete, setComplete] = useState(false);
  const { seesAll, uid } = viewer;
  const managedKey = (viewer.managedProviders ?? []).slice().sort().join(",");

  useEffect(() => {
    setComplete(false);
    if (!workspaceId || (!seesAll && !uid)) {
      setAccounts([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const unsubscribe = subscribeToGrokAppAccounts(
      workspaceId,
      (next, done) => {
        setAccounts(next);
        setIsLoading(false);
        setComplete(done);
      },
      { seesAll, uid, managedProviders: managedKey ? (managedKey.split(",") as GrokAppProvider[]) : [] }
    );
    return unsubscribe;
  }, [workspaceId, seesAll, uid, managedKey]);

  return { accounts, isLoading, complete };
}
