import { useEffect, useState } from "react";
import { subscribeToGrokAppAccounts } from "@/services/grokAppAccountService";
import { useGrokBackend } from "@/services/grokStore";
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
  // «Полный» относится к КОНКРЕТНОЙ подписке: сменились права или workspace —
  // старый флаг в том же рендере сказал бы «полный» про старый список, и
  // сверка витрины удалила бы карточки аккаунтов, которых в нём нет.
  const [completeKey, setCompleteKey] = useState<string | null>(null);
  const { seesAll, uid } = viewer;
  const managedKey = (viewer.managedProviders ?? []).slice().sort().join(",");
  const backend = useGrokBackend(workspaceId);
  const subscriptionKey = `${workspaceId ?? ""}|${seesAll}|${uid}|${managedKey}|${backend ?? ""}`;

  useEffect(() => {
    setCompleteKey(null);
    if (!workspaceId || (!seesAll && !uid)) {
      setAccounts([]);
      setIsLoading(false);
      return;
    }
    if (!backend) return;
    setIsLoading(true);
    const unsubscribe = subscribeToGrokAppAccounts(
      workspaceId,
      (next, done) => {
        setAccounts(next);
        setIsLoading(false);
        setCompleteKey(done ? subscriptionKey : null);
      },
      { seesAll, uid, managedProviders: managedKey ? (managedKey.split(",") as GrokAppProvider[]) : [] },
      backend
    );
    return unsubscribe;
    // subscriptionKey собран из тех же зависимостей.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, seesAll, uid, managedKey, backend]);

  return { accounts, isLoading, complete: completeKey === subscriptionKey };
}
