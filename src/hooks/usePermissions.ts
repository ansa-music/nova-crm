import { useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  canAccessPage,
  canAssignResponsible,
  canChangeRoles,
  canCreatePages,
  canEditPageData,
  canEditPageStructure,
  canInviteMembers,
  canManagePage,
  canManagePagePermissions,
  canManageWorkspace,
  canRemoveMembers,
  canRestoreHistory,
  canViewHistory,
  isResponsibleForPage,
} from "@/utils/permissions";
import type { Role, WorkspacePage } from "@/types";

export function usePermissions() {
  const { profile } = useAuth();
  const { members } = useWorkspace();

  const role: Role = useMemo(() => {
    const me = members.find((m) => m.uid === profile?.uid);
    return me?.role ?? "viewer";
  }, [members, profile?.uid]);

  return useMemo(
    () => ({
      role,
      uid: profile?.uid ?? "",
      canManageWorkspace: canManageWorkspace(role),
      canInviteMembers: canInviteMembers(role),
      canChangeRoles: canChangeRoles(role),
      canRemoveMembers: canRemoveMembers(role),
      canCreatePages: canCreatePages(role),
      canEditPageStructure: canEditPageStructure(role),
      canManagePagePermissions: canManagePagePermissions(role),
      canViewHistory: canViewHistory(role),
      canRestoreHistory: canRestoreHistory(role),
      canAssignResponsible: canAssignResponsible(role),
      canAccessPage: (page: WorkspacePage) => canAccessPage(page, role, profile?.uid ?? ""),
      canEditPageData: (page: WorkspacePage) => canEditPageData(page, role, profile?.uid ?? ""),
      isResponsibleForPage: (page: WorkspacePage) => isResponsibleForPage(page, profile?.uid ?? ""),
      canManagePage: (page: WorkspacePage) => canManagePage(page, role, profile?.uid ?? ""),
    }),
    [role, profile?.uid]
  );
}
