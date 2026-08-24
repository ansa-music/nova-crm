// PATH: src/hooks/useWorkspace.ts  (REPLACES EXISTING)
import { useEffect, useRef } from "react";
import { subscribeToUserWorkspaces } from "@/services/workspaceService";
import { fetchMembers, findOwnMembership, mergeOwnMember, subscribeToOwnMember } from "@/services/memberService";
import { subscribeToPages } from "@/services/pageService";
import { useAuthStore } from "@/store/authStore";
import { useBootstrapStore } from "@/store/bootstrapStore";
import { useWorkspaceStore } from "@/store/workspaceStore";

/** Subscribes to the list of workspaces the current user belongs to. Call once near the app root. */
export function useWorkspaceListBootstrap() {
  const uid = useAuthStore((s) => s.firebaseUser?.uid);
  const profileResolved = useBootstrapStore((s) => s.profileResolved);
  const setWorkspaces = useWorkspaceStore((s) => s.setWorkspaces);
  const setLoadingWorkspaces = useWorkspaceStore((s) => s.setLoadingWorkspaces);
  const setActiveWorkspaceId = useWorkspaceStore((s) => s.setActiveWorkspaceId);

  useEffect(() => {
    const { setWorkspaceListResolved } = useBootstrapStore.getState();

    if (!uid) {
      setWorkspaces([]);
      setLoadingWorkspaces(false);
      setWorkspaceListResolved(false);
      return;
    }

    // Wait for the profile before subscribing: subscribeToUserWorkspaces reads
    // users/{uid}.workspaceIds, and firing it before ensureUserProfile() has
    // created that doc is one of the ways the list came back empty on a first
    // ever sign-in and never self-corrected without a reload.
    if (!profileResolved) return;

    setLoadingWorkspaces(true);
    setWorkspaceListResolved(false);

    const unsubscribe = subscribeToUserWorkspaces(uid, (workspaces) => {
      setWorkspaces(workspaces);
      setLoadingWorkspaces(false);

      // Read activeWorkspaceId from the store at callback time instead of
      // closing over a render-time value — the old closure captured a stale id
      // and could "correct" a perfectly valid selection to workspaces[0],
      // which is the "opens the wrong workspace" bug.
      const currentActiveId = useWorkspaceStore.getState().activeWorkspaceId;
      const stillValid = workspaces.some((w) => w.id === currentActiveId);
      if (!stillValid) setActiveWorkspaceId(workspaces.length > 0 ? workspaces[0].id : null);

      // Only NOW is "do I have any workspaces" a real answer.
      setWorkspaceListResolved(true);
    });

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, profileResolved]);
}

/** Subscribes to members + pages of whichever workspace is currently active. Call once in the app layout. */
export function useActiveWorkspaceDataBootstrap() {
  const uid = useAuthStore((s) => s.firebaseUser?.uid);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const workspaceListResolved = useBootstrapStore((s) => s.workspaceListResolved);
  const setResolvedDataWorkspaceId = useBootstrapStore((s) => s.setResolvedDataWorkspaceId);
  const setMembers = useWorkspaceStore((s) => s.setMembers);
  const setPages = useWorkspaceStore((s) => s.setPages);
  const setLoadingWorkspaceData = useWorkspaceStore((s) => s.setLoadingWorkspaceData);
  const setMembersLoadState = useWorkspaceStore((s) => s.setMembersLoadState);

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? null;
  const isConfirmedActive = Boolean(activeWorkspaceId && activeWorkspace);
  const isOwnerOfActive = Boolean(activeWorkspace && uid && activeWorkspace.ownerId === uid);

  // Guards against a late snapshot from a workspace we already switched away
  // from marking the NEW workspace as resolved.
  const generationRef = useRef(0);

  useEffect(() => {
    if (!workspaceListResolved) return;

    const generation = ++generationRef.current;

    if (!isConfirmedActive || !activeWorkspaceId) {
      setMembers([]);
      setPages([]);
      setMembersLoadState("loading");
      setLoadingWorkspaceData(false);
      setResolvedDataWorkspaceId(null);
      return;
    }

    setLoadingWorkspaceData(true);
    setMembersLoadState("loading");
    // Clear immediately so the phase drops back to "workspace-data" the moment
    // a switch starts, instead of briefly reporting ready with stale members.
    setResolvedDataWorkspaceId(null);

    let membersLoaded = false;
    let pagesLoaded = false;

    function maybeDone() {
      if (generation !== generationRef.current) return; // superseded
      if (membersLoaded && pagesLoaded) {
        setLoadingWorkspaceData(false);
        // Members carry the ROLE and pages carry ACCESS — permissions are only
        // meaningful once both have landed. This is the single gate that stops
        // "нет доступа" from rendering against an empty members array.
        setResolvedDataWorkspaceId(activeWorkspaceId);
      }
    }

    const hangTimer = window.setTimeout(() => {
      if (generation !== generationRef.current) return;
      if (!membersLoaded) {
        // Boot must not sit on «Проверяем вход…» / workspace-data forever.
        // An unconfirmed empty list is NOT "not a member" — permissions stay unresolved.
        setMembersLoadState("unconfirmed");
        membersLoaded = true;
      }
      if (!pagesLoaded) pagesLoaded = true;
      maybeDone();
    }, 10000);

    // Full roster is a one-shot read (presence lastActiveAt lives on these docs).
    // Live listener is only the current user's member doc — needed for access/role.
    let roster: import("@/types").WorkspaceMember[] = [];
    let ownMember: import("@/types").WorkspaceMember | null = null;
    function publishMembers() {
      setMembers(mergeOwnMember(roster, ownMember));
    }

    void fetchMembers(activeWorkspaceId)
      .then((list) => {
        if (generation !== generationRef.current) return;
        roster = list;
        publishMembers();
      })
      .catch((error) => {
        if (generation !== generationRef.current) return;
        console.error(`fetchMembers failed for workspace ${activeWorkspaceId}:`, error);
      });

    const unsubMembers = uid
      ? subscribeToOwnMember(
          activeWorkspaceId,
          uid,
          (own) => {
            if (generation !== generationRef.current) return;
            ownMember = own;
            publishMembers();
            setMembersLoadState("ready");
            membersLoaded = true;
            maybeDone();
          },
          (error) => {
            if (generation !== generationRef.current) return;
            console.error(`subscribeToOwnMember denied for workspace ${activeWorkspaceId}:`, error.code, error.message);
          }
        )
      : () => {};

    const unsubPages = subscribeToPages(
      activeWorkspaceId,
      (pages) => {
        if (generation !== generationRef.current) return;
        setPages(pages);
        pagesLoaded = true;
        maybeDone();
      },
      (error) => {
        if (generation !== generationRef.current) return;
        console.error(`subscribeToPages denied for workspace ${activeWorkspaceId}:`, error.code, error.message);
        setPages([]);
        pagesLoaded = true;
        maybeDone();
      },
      uid,
      isOwnerOfActive
    );

    return () => {
      window.clearTimeout(hangTimer);
      unsubMembers();
      unsubPages();
    };
  }, [
    activeWorkspaceId,
    isConfirmedActive,
    isOwnerOfActive,
    workspaceListResolved,
    uid,
    setMembers,
    setPages,
    setLoadingWorkspaceData,
    setMembersLoadState,
    setResolvedDataWorkspaceId,
  ]);
}

export function useWorkspace() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setActiveWorkspaceId = useWorkspaceStore((s) => s.setActiveWorkspaceId);
  const members = useWorkspaceStore((s) => s.members);
  const pages = useWorkspaceStore((s) => s.pages);
  const isLoadingWorkspaces = useWorkspaceStore((s) => s.isLoadingWorkspaces);
  const isLoadingWorkspaceData = useWorkspaceStore((s) => s.isLoadingWorkspaceData);
  const membersLoadState = useWorkspaceStore((s) => s.membersLoadState);

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
    membersLoadState,
  };
}

export async function refreshWorkspaceMembers(workspaceId: string) {
  const list = await fetchMembers(workspaceId);
  const uid = useAuthStore.getState().firebaseUser?.uid;
  const email = useAuthStore.getState().profile?.email;
  const own =
    findOwnMembership(useWorkspaceStore.getState().members, uid, email) ??
    findOwnMembership(list, uid, email);
  useWorkspaceStore.getState().setMembers(mergeOwnMember(list, own));
}
