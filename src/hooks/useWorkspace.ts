import { useEffect } from "react";
import { subscribeToUserWorkspaces } from "@/services/workspaceService";
import { subscribeToMembers } from "@/services/memberService";
import { subscribeToPages } from "@/services/pageService";
import { useAuthStore } from "@/store/authStore";
import { useWorkspaceStore } from "@/store/workspaceStore";

/** Subscribes to the list of workspaces the current user belongs to. Call once near the app root. */
export function useWorkspaceListBootstrap() {
  const uid = useAuthStore((s) => s.firebaseUser?.uid);
  const setWorkspaces = useWorkspaceStore((s) => s.setWorkspaces);
  const setLoadingWorkspaces = useWorkspaceStore((s) => s.setLoadingWorkspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setActiveWorkspaceId = useWorkspaceStore((s) => s.setActiveWorkspaceId);

  useEffect(() => {
    if (!uid) {
      setWorkspaces([]);
      setLoadingWorkspaces(false);
      return;
    }
    setLoadingWorkspaces(true);
    const unsubscribe = subscribeToUserWorkspaces(uid, (workspaces) => {
      setWorkspaces(workspaces);
      setLoadingWorkspaces(false);
      const stillValid = workspaces.some((w) => w.id === activeWorkspaceId);
      if (!stillValid && workspaces.length > 0) {
        setActiveWorkspaceId(workspaces[0].id);
      }
      if (workspaces.length === 0) {
        setActiveWorkspaceId(null);
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);
}

/** Subscribes to members + pages of whichever workspace is currently active. Call once in the app layout. */
export function useActiveWorkspaceDataBootstrap() {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const isLoadingWorkspaces = useWorkspaceStore((s) => s.isLoadingWorkspaces);
  const setMembers = useWorkspaceStore((s) => s.setMembers);
  const setPages = useWorkspaceStore((s) => s.setPages);
  const setLoadingWorkspaceData = useWorkspaceStore((s) => s.setLoadingWorkspaceData);

  // Don't trust a persisted (localStorage) activeWorkspaceId until the live
  // workspace list has confirmed it's actually one we belong to — otherwise
  // a stale id from a previous account/session fires a real, correctly-
  // denied read against a workspace we're not a member of, surfacing a
  // confusing permission-denied toast for something that isn't a bug.
  const isConfirmedActive = Boolean(activeWorkspaceId && workspaces.some((w) => w.id === activeWorkspaceId));

  useEffect(() => {
    if (isLoadingWorkspaces) return;
    if (!isConfirmedActive || !activeWorkspaceId) {
      setMembers([]);
      setPages([]);
      setLoadingWorkspaceData(false);
      return;
    }
    setLoadingWorkspaceData(true);
    let membersLoaded = false;
    let pagesLoaded = false;
    function maybeDone() {
      if (membersLoaded && pagesLoaded) setLoadingWorkspaceData(false);
    }
    const unsubMembers = subscribeToMembers(
      activeWorkspaceId,
      (members) => {
        setMembers(members);
        membersLoaded = true;
        maybeDone();
      },
      (error) => {
        // Never leave the app stuck on a skeleton just because this one
        // read was denied — surface an empty list instead of hanging, but
        // log the real error so it's actually diagnosable.
        console.error(`subscribeToMembers denied for workspace ${activeWorkspaceId}:`, error.code, error.message);
        setMembers([]);
        membersLoaded = true;
        maybeDone();
      }
    );
    const unsubPages = subscribeToPages(
      activeWorkspaceId,
      (pages) => {
        setPages(pages);
        pagesLoaded = true;
        maybeDone();
      },
      (error) => {
        console.error(`subscribeToPages denied for workspace ${activeWorkspaceId}:`, error.code, error.message);
        setPages([]);
        pagesLoaded = true;
        maybeDone();
      }
    );
    return () => {
      unsubMembers();
      unsubPages();
    };
  }, [activeWorkspaceId, isConfirmedActive, isLoadingWorkspaces, setMembers, setPages, setLoadingWorkspaceData]);
}

export function useWorkspace() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setActiveWorkspaceId = useWorkspaceStore((s) => s.setActiveWorkspaceId);
  const members = useWorkspaceStore((s) => s.members);
  const pages = useWorkspaceStore((s) => s.pages);
  const isLoadingWorkspaces = useWorkspaceStore((s) => s.isLoadingWorkspaces);
  const isLoadingWorkspaceData = useWorkspaceStore((s) => s.isLoadingWorkspaceData);

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? null;

  return {
    workspaces,
    activeWorkspace,
    activeWorkspaceId,
    setActiveWorkspaceId,
    members,
    pages,
    isLoadingWorkspaces,
    isLoadingWorkspaceData,
  };
}
