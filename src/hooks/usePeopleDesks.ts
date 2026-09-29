import { useEffect, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useUiStore } from "@/store/uiStore";
import { isOwnerOnlyPage, isResponsibleForPage } from "@/utils/permissions";
import { dropPageRowSnapshots } from "@/services/rows/rowSnapshotCache";

/** Столы «только для Owner», чьи снимки строк на этом устройстве уже стёрты. */
const purgedOwnerOnly = new Set<string>();
import {
  findMyDesk,
  groupAllPeople,
  groupDesksByPerson,
  type PersonDeskGroup,
} from "@/utils/peopleDesks";

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
    // Тимлид reads no desk rows — nothing to chart or count for them.
    if (permissions.deskBlocked) return [];
    if (isPersonalLanding && profile) {
      // Только столы, которые человек реально откроет: стол «только для
      // Owner» остаётся его (квота, «Новый стол»), но строки его не читаются.
      // Решает флаг, а не полные права: пока права грузятся, свой обычный
      // стол не должен пропадать.
      return pages.filter(
        (p) => isResponsibleForPage(p, profile.uid) && (!isOwnerOnlyPage(p) || permissions.canAccessPage(p))
      );
    }
    return visiblePages;
  }, [pages, visiblePages, isPersonalLanding, profile, permissions]);

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
  // Свой стол есть, но открыть его нельзя (стол «только для Owner»).
  // По флагу, а не по полным правам: пока права грузятся (медленная сеть),
  // главная иначе увела бы каждого технаря на «Столы».
  const myDeskOpen = Boolean(myDesk && (!isOwnerOnlyPage(myDesk) || permissions.canAccessPage(myDesk)));

  // Снимки строк закрытого стола, сохранённые на этом устройстве до закрытия,
  // стираем — иначе они лежали бы в IndexedDB до выхода из аккаунта.
  const closedKey = permissions.isResolved
    ? pages
        .filter((p) => isOwnerOnlyPage(p) && !permissions.canAccessPage(p))
        .map((p) => `${p.workspaceId}:${p.id}`)
        .join("|")
    : "";
  useEffect(() => {
    if (!closedKey) return;
    for (const key of closedKey.split("|")) {
      if (purgedOwnerOnly.has(key)) continue;
      purgedOwnerOnly.add(key);
      const [ws, pageId] = key.split(":");
      if (ws && pageId) dropPageRowSnapshots(ws, pageId);
    }
  }, [closedKey]);

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
    myDeskOpen,
    selectPerson: setSelectedPersonKey,
  };
}
