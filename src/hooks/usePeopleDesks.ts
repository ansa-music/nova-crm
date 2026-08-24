import { useEffect, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useUiStore } from "@/store/uiStore";
import { isResponsibleForPage } from "@/utils/permissions";
import { groupDesksByPerson, type PersonDeskGroup } from "@/utils/peopleDesks";

export function usePeopleDesks() {
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
      return visiblePages.filter((p) => isResponsibleForPage(p, profile.uid));
    }
    return visiblePages;
  }, [visiblePages, isPersonalLanding, profile]);

  const groups = useMemo(() => groupDesksByPerson(studioPages, members), [studioPages, members]);

  useEffect(() => {
    if (groups.length === 0) {
      if (selectedPersonKey !== null) setSelectedPersonKey(null);
      return;
    }
    if (selectedPersonKey && groups.some((g) => g.key === selectedPersonKey)) return;
    if (profile && groups.some((g) => g.key === profile.uid)) {
      setSelectedPersonKey(profile.uid);
      return;
    }
    setSelectedPersonKey(groups[0].key);
  }, [groups, profile, selectedPersonKey, setSelectedPersonKey]);

  const activeGroup: PersonDeskGroup | null =
    groups.find((g) => g.key === selectedPersonKey) ?? groups[0] ?? null;

  const ownerUid = members.find((m) => m.role === "owner")?.uid ?? null;

  return {
    groups,
    activeGroup,
    studioPages,
    visiblePages,
    isPersonalLanding,
    isLoadingWorkspaceData,
    ownerUid,
    selectPerson: setSelectedPersonKey,
  };
}
