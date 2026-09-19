import { useCallback, useEffect, useState } from "react";
import {
  fetchOwnerAccessRequests,
  resolveOwnerAccessRequest,
} from "@/services/ownerAccessService";
import type { OwnerAccessRequest } from "@/types";

/**
 * Заявки на права Owner для колокольчика. Живёт только у Owner (`enabled`),
 * читает разово и по требованию — колокольчик висит на каждом экране, а новый
 * постоянный `onSnapshot` на бесплатном плане Firebase лишний
 * (см. лимиты listener'ов в CLAUDE.md). Колокольчик и так дёргает reload при
 * открытии списка.
 */
export function useOwnerAccessRequests(workspaceId: string | null, enabled: boolean) {
  const [requests, setRequests] = useState<OwnerAccessRequest[]>([]);

  const reload = useCallback(async () => {
    if (!enabled || !workspaceId) {
      setRequests([]);
      return;
    }
    try {
      setRequests(await fetchOwnerAccessRequests(workspaceId));
    } catch {
      // Нет доступа/нет коллекции — просто не показываем кнопки.
    }
  }, [enabled, workspaceId]);

  useEffect(() => {
    // Чистим состояние при смене workspace, а не только когда он пропал —
    // иначе на новом workspace на секунду видны чужие заявки.
    setRequests([]);
    void reload();
  }, [reload]);

  const resolve = useCallback(
    async (request: OwnerAccessRequest, status: "approved" | "denied", actorUid: string, actorName: string) => {
      if (!workspaceId) return;
      await resolveOwnerAccessRequest({ workspaceId, request, status, actorUid, actorName });
      await reload();
    },
    [workspaceId, reload]
  );

  return { ownerRequests: requests, reloadOwnerRequests: reload, resolveOwnerRequest: resolve };
}
