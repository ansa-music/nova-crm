import { useCallback, useEffect } from "react";
import { usePolledData } from "@/hooks/usePolledData";
import { INBOX_CHANGED_EVENT } from "@/utils/inboxEvents";
import {
  fetchMyViewRequests,
  latestRequestForPage,
  requestDeskView,
  resolveDeskViewRequest,
} from "@/services/viewRequestService";
import type { ViewRequest, WorkspacePage } from "@/types";

export function useViewRequests(workspaceId: string | null, uid: string | null) {
  const { data, isLoading, reload } = usePolledData<ViewRequest[]>(
    Boolean(workspaceId && uid),
    () => fetchMyViewRequests(workspaceId as string, uid as string),
    [],
    [workspaceId, uid]
  );

  useEffect(() => {
    function onChanged() {
      void reload();
    }
    window.addEventListener(INBOX_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(INBOX_CHANGED_EVENT, onChanged);
  }, [reload]);

  // Spark-safe: no extra onSnapshot. While *this* user has a pending
  // view-request, poll every 4s so «Принять» opens their desk without a reload.
  useEffect(() => {
    if (!uid) return;
    const minePending = data.some((row) => row.fromUid === uid && row.status === "pending");
    if (!minePending) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [data, uid, reload]);

  const requestView = useCallback(
    async (page: WorkspacePage, fromName: string, toUid: string) => {
      if (!workspaceId || !uid) return null;
      return requestDeskView({
        workspaceId,
        page,
        fromUid: uid,
        fromName,
        toUid,
        existing: data,
      });
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
      await reload();
    },
    [workspaceId, uid, reload]
  );

  return {
    requests: data,
    isLoading,
    reload,
    requestView,
    resolveRequest,
    latestForPage: (pageId: string) => (uid ? latestRequestForPage(data, pageId, uid) : null),
  };
}
