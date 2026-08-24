import { useEffect, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useUiStore } from "@/store/uiStore";
import { isResponsibleForPage } from "@/utils/permissions";
import { findMyDesk, groupAllPeople, groupDesksByPerson, type PersonDeskGroup } from "@/utils/peopleDesks";

/** `syncPersonSelection` is only for Люди. Never treat selected person as ACL. */
export function usePeopleDesks({ syncPersonSelection = false }: { syncPersonSelection?: boolean } = {}) {
  const { pages, members, isLoadingWorkspaceData } = useWorkspace();
  const permissions = usePermissions();
  const { profile } = useAuth();
  const selectedPersonKey = useUiStore((s) => s.selectedPersonKey);
  const setSelectedPersonKey = useUiStore((s) => s.setSelectedPersonKey);

  const visiblePages = useMemo(
    () => pages.filter((p) => permissions.canAccessPage(p)),
    [pages, permissions]
  );

  const isPersonalLanding = permissions.role !== "owner" && permissions.role !== "admin";

  const studioPages = useMemo(() => {
    if (isPersonalLanding && profile) {
      return pages.filter((p) => isResponsibleForPage(p, profile.uid));
    }
    return visiblePages;
  }, [pages, visiblePages, isPersonalLanding, profile]);

  const groups = useMemo(() => groupDesksByPerson(studioPages, members), [studioPages, members]);
  // People tab: every member, even if their desk is hidden / not in studioPages.
  const peopleGroups = useMemo(() => groupAllPeople(members, pages), [members, pages]);

  useEffect(() => {
    if (!syncPersonSelection) return;
    const list = peopleGroups;
    if (list.length === 0) {
      if (selectedPersonKey !== null) setSelectedPersonKey(null);
      return;
    }
    if (selectedPersonKey && list.some((g) => g.key === selectedPersonKey)) return;
    if (profile && list.some((g) => g.key === profile.uid)) {
      setSelectedPersonKey(profile.uid);
      return;
    }
    setSelectedPersonKey(list[0].key);
  }, [peopleGroups, profile, selectedPersonKey, setSelectedPersonKey, syncPersonSelection]);

  const activeGroup: PersonDeskGroup | null =
    groups.find((g) => g.key === selectedPersonKey) ?? groups[0] ?? null;

  const ownerUid = members.find((m) => m.role === "owner")?.uid ?? null;
  const myDesk = findMyDesk(profile?.uid, groups, pages);

  return {
    groups,
    peopleGroups,
    activeGroup,
    studioPages,
    visiblePages,
    isPersonalLanding,
    isLoadingWorkspaceData,
    ownerUid,
    myDesk,
    selectPerson: setSelectedPersonKey,
  };
}
