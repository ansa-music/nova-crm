import { useEffect, useState } from "react";
import { getGrokAccountStatus, subscribeToGrokAccounts } from "@/services/grokAccountService";
import { joinSharedSubscription } from "@/utils/sharedSubscription";
import { useGrokBackend } from "@/services/grokStore";
import type { GrokAccount } from "@/types";

export interface GrokPoolSignal {
  available: number;
  total: number;
}

/**
 * «Доступно N из M» аккаунтов Грока для пункта меню «Грок лимит» (просьба
 * Nurba 25.09.2026 — сделать пункт главнее и удобнее: цифра в меню
 * отвечает на вопрос «есть ли свободный аккаунт», не заходя на страницу).
 *
 * Одна подписка на приложение (`joinSharedSubscription`, живёт минуту после
 * ухода последнего читателя) — та же коллекция, что читает сама страница
 * «Грок лимит», так что при открытой странице документы не читаются дважды.
 * Только тем, у кого есть пункт (не чистый ОС): у ОС коллекции Grok закрыты
 * правилами, и подписка упёрлась бы в отказ.
 */
export function useGrokPoolSignal(workspaceId: string | null, enabled: boolean): GrokPoolSignal | null {
  const [pool, setPool] = useState<GrokPoolSignal | null>(null);
  const backend = useGrokBackend(enabled ? workspaceId : null);
  useEffect(() => {
    setPool(null);
    if (!workspaceId || !enabled || !backend) return;
    return joinSharedSubscription<GrokAccount[]>(
      `grok-accounts:${workspaceId}:${backend}`,
      (emit) => subscribeToGrokAccounts(workspaceId, emit, backend),
      (accounts) => {
        const now = Date.now();
        let available = 0;
        for (const a of accounts) if (getGrokAccountStatus(a, now) === "available") available += 1;
        setPool({ available, total: accounts.length });
      }
    );
  }, [workspaceId, enabled, backend]);
  return pool;
}
