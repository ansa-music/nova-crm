import { useCallback, useEffect, useMemo, useState } from "react";
import { cachedElevenLabsUsage, fetchElevenLabsUsage, type ElevenLabsUsageState } from "@/services/elevenLabsUsageService";
import type { GrokAppAccount } from "@/types/grokAppAccount";

export type ElevenLabsUsageMap = Record<string, ElevenLabsUsageState | { kind: "loading" }>;

/**
 * Живое использование аккаунтов ElevenLabs с ключом: по одному запросу на
 * аккаунт при открытии страницы (мимо памяти — только «Обновить»), результат
 * по id аккаунта. Аккаунты без ключа и других сервисов не трогаются.
 */
export function useElevenLabsUsage(accounts: GrokAppAccount[]): {
  byId: ElevenLabsUsageMap;
  refresh: (accountId?: string) => void;
} {
  const targets = useMemo(
    () => accounts.filter((a) => a.provider === "elevenlabs" && Boolean(a.apiKey?.trim())).map((a) => ({ id: a.id, apiKey: a.apiKey!.trim() })),
    [accounts]
  );
  // Ключ эффекта — набор аккаунтов и их ключей; сам список пересобирается на
  // каждый снимок, и без ключа мы бы дёргали сервис на любую правку статуса.
  const targetsKey = targets.map((t) => `${t.id}:${t.apiKey.length}:${t.apiKey.slice(-4)}`).join("|");
  const [byId, setById] = useState<ElevenLabsUsageMap>({});

  const load = useCallback(
    (items: { id: string; apiKey: string }[], force: boolean) => {
      if (items.length === 0) return;
      setById((prev) => {
        const next = { ...prev };
        for (const t of items) {
          const cached = force ? null : cachedElevenLabsUsage(t.id, t.apiKey);
          next[t.id] = cached ?? { kind: "loading" };
        }
        return next;
      });
      for (const t of items) {
        if (!force && cachedElevenLabsUsage(t.id, t.apiKey)) continue;
        void fetchElevenLabsUsage(t.id, t.apiKey, { force }).then((state) => setById((prev) => ({ ...prev, [t.id]: state })));
      }
    },
    []
  );

  useEffect(() => {
    load(targets, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetsKey, load]);

  const refresh = useCallback(
    (accountId?: string) => load(accountId ? targets.filter((t) => t.id === accountId) : targets, true),
    [targets, load]
  );

  return { byId, refresh };
}
