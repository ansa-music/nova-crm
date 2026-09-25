import { useEffect, useState } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { subscribeToHistory } from "@/services/historyService";
import { useSbBackend } from "@/services/sb/sbCollections";
import type { HistoryEntry } from "@/types";

/**
 * Журнал изменений стола. Где он живёт (Firestore / Supabase), решает
 * документ workspace — `useSbBackend`; в Supabase-режиме фильтр по столу
 * стоит на сервере, в Firestore — по-прежнему в браузере.
 */
export function useHistoryLog(workspaceId: string | null, pageId?: string) {
  const { activeWorkspace } = useWorkspace();
  const sameWorkspace = Boolean(workspaceId && activeWorkspace?.id === workspaceId);
  const sbBackend = useSbBackend(sameWorkspace ? activeWorkspace : null, "history");
  const backend = !workspaceId ? null : sameWorkspace ? sbBackend : "firestore";
  const [data, setData] = useState<HistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(Boolean(workspaceId));

  useEffect(() => {
    if (!workspaceId || !backend) {
      setData([]);
      setIsLoading(Boolean(workspaceId));
      return;
    }
    setIsLoading(true);
    const unsubscribe = subscribeToHistory(
      workspaceId,
      (next) => {
        setData(next);
        setIsLoading(false);
      },
      200,
      { pageId, backend }
    );
    return unsubscribe;
  }, [workspaceId, pageId, backend]);

  const entries = pageId && backend !== "supabase" ? data.filter((e) => e.pageId === pageId) : data;

  return {
    entries,
    isLoading,
    reload: () => {
      /* live onSnapshot already feeds `data` */
    },
  };
}
