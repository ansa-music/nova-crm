import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { useViewRequests } from "@/hooks/useViewRequests";
import { useWorkspace } from "@/hooks/useWorkspace";

/**
 * If this person asked to view a desk and the owner hits «Принять»,
 * open that desk in the already-open tab. No extra Firestore listener:
 * useViewRequests polls faster while a request is pending.
 */
export function useOpenApprovedDesk() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const uid = profile?.uid ?? null;
  const { requests } = useViewRequests(activeWorkspaceId, uid);
  const pendingIds = useRef(new Set<string>());
  const openedIds = useRef(new Set<string>());

  useEffect(() => {
    if (!uid) return;
    for (const request of requests) {
      if (request.fromUid === uid && request.status === "pending") {
        pendingIds.current.add(request.id);
      }
    }
    for (const request of requests) {
      if (request.fromUid !== uid || request.status !== "approved") continue;
      if (!pendingIds.current.has(request.id) || openedIds.current.has(request.id)) continue;
      openedIds.current.add(request.id);
      pendingIds.current.delete(request.id);
      if (request.pageId) navigate(`/page/${request.pageId}`);
      break;
    }
  }, [requests, uid, navigate]);
}
