import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useAccessBackend } from "@/services/accessStore";
import { loadDeskObserver } from "@/services/deskObserverService";

/**
 * Один раз за сессию читает СВОЙ документ наблюдателя — тихое право Owner
 * «видит все столы на чтение». Постоянного слушателя намеренно нет: право
 * выдают редко, а слушателей на Spark и так впритык. Дальше значение лежит
 * на модуле, и его читает `usePermissions`.
 *
 * Где документ — решает `useAccessBackend` (Firestore, пока доступы не
 * перенесены в Supabase; он же держит проверку отметки переноса для всей
 * вкладки — разовые действия сервисов читают её из памяти).
 */
export function useDeskObserverLoad() {
  const { activeWorkspaceId } = useWorkspace();
  const { profile } = useAuth();
  const uid = profile?.uid ?? null;
  const backend = useAccessBackend(activeWorkspaceId);
  useEffect(() => {
    if (!activeWorkspaceId || !uid) {
      void loadDeskObserver(null, null);
      return;
    }
    if (!backend) return;
    void loadDeskObserver(activeWorkspaceId, uid, backend);
  }, [activeWorkspaceId, uid, backend]);
}
