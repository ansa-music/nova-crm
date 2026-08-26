import { useCallback, useEffect, useState } from "react";
import {
  latestRequestForPage,
  requestDeskView,
  resolveDeskViewRequest,
  subscribeToMyViewRequests,
} from "@/services/viewRequestService";
import type { ViewRequest, WorkspacePage } from "@/types";

export function useViewRequests(workspaceId: string | null, uid: string | null) {
  const [data, setData] = useState<ViewRequest[]>([]);
  const [isLoading, setIsLoading] = useState(Boolean(workspaceId && uid));

  useEffect(() => {
    if (!workspaceId || !uid) {
      setData([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const unsubscribe = subscribeToMyViewRequests(workspaceId, uid, (next) => {
      setData(next);
      setIsLoading(false);
    });
    return unsubscribe;
  }, [workspaceId, uid]);

  const requestView = useCallback(
    async (page: WorkspacePage, fromName: string, toUid: string) => {
      if (!workspaceId || !uid) return null;
      const row = await requestDeskView({
        workspaceId,
        page,
        fromUid: uid,
        fromName,
        toUid,
        existing: data,
      });
      if (row) {
        setData((prev) => (prev.some((r) => r.id === row.id) ? prev : [...prev, row]));
      }
      return row;
    },
    [workspaceId, uid, data]
  );

  const resolveRequest = useCallback(
    async (request: ViewRequest, page: WorkspacePage | undefined, status: "approved" | "denied", actorName: string) => {
      if (!workspaceId || !uid) return;
      await resolveDeskViewRequest({
        workspaceId,
        request,
        page,
        status,
        actorUid: uid,
        actorName,
      });
    },
    [workspaceId, uid]
  );

  return {
    requests: data,
    isLoading,
    reload: () => {
      /* live onSnapshot already feeds `data`; requestView also optimistic-inserts */
    },
    requestView,
    resolveRequest,
    latestForPage: (pageId: string) => (uid ? latestRequestForPage(data, pageId, uid) : null),
  };
}
