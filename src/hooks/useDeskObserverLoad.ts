import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { loadDeskObserver } from "@/services/deskObserverService";

/**
 * Один раз за сессию читает СВОЙ документ `deskObservers/{uid}` — тихое право
 * Owner «видит все столы на чтение». Постоянного слушателя намеренно нет:
 * право выдают редко, а слушателей на Spark и так впритык. Дальше значение
 * лежит на модуле, и его читает `usePermissions`.
 */
export function useDeskObserverLoad() {
  const { activeWorkspaceId } = useWorkspace();
  const { profile } = useAuth();
  const uid = profile?.uid ?? null;
  useEffect(() => {
    void loadDeskObserver(activeWorkspaceId, uid);
  }, [activeWorkspaceId, uid]);
}
