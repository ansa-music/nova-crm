// PATH: src/hooks/usePermissions.ts  (REPLACES EXISTING — use THIS version)
import { useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useAppBootstrap } from "@/hooks/useAppBootstrap";
import {
  canAccessPage,
  canAssignResponsible,
  canChangeRoles,
  canCreatePages,
  canDeletePage,
  canEditPageData,
  canEditPageStructure,
  canInviteMembers,
  canManageAnnouncements,
  canManagePage,
  canManagePagePermissions,
  canManageWorkspace,
  canRemoveMembers,
  canRestoreHistory,
  canSendNotifications,
  canViewHistory,
  isResponsibleForPage,
} from "@/utils/permissions";
import type { Role, WorkspacePage } from "@/types";

/**
 * ALWAYS check `isResolved` before rendering any denial UI.
 *
 * Previously `role` fell back to "viewer" whenever `members` hadn't loaded,
 * which is indistinguishable from a genuine Viewer — the root cause of
 * "нет доступа" / "только просмотр" showing for an Owner on a cold load until
 * F5. That fallback now only applies once workspace data is genuinely
 * resolved; before that `isResolved` is false and every capability is false,
 * so callers must render a loading state, not a denial.
 */
export function usePermissions() {
  const { profile } = useAuth();
  const { members } = useWorkspace();
  const { isReady } = useAppBootstrap();

  const membership = useMemo(
    () => members.find((m) => m.uid === profile?.uid) ?? null,
    [members, profile?.uid]
  );

  const role: Role = membership?.role ?? "viewer";
  const isResolved = isReady;
  const hasMembership = Boolean(membership);

  return useMemo(
    () => ({
      role,
      uid: profile?.uid ?? "",
      /** False while user/role/workspace/pages are still resolving. */
      isResolved,
      /** Resolved, but this account has no member record in the active workspace. */
      hasMembership,

      canManageWorkspace: isResolved && canManageWorkspace(role),
      canInviteMembers: isResolved && canInviteMembers(role),
      canChangeRoles: isResolved && canChangeRoles(role),
      canRemoveMembers: isResolved && canRemoveMembers(role),
      canCreatePages: isResolved && canCreatePages(role),
      canEditPageStructure: isResolved && canEditPageStructure(role),
      canManagePagePermissions: isResolved && canManagePagePermissions(role),
      canViewHistory: isResolved && canViewHistory(role),
      canRestoreHistory: isResolved && canRestoreHistory(role),
      canAssignResponsible: isResolved && canAssignResponsible(role),
      canManageAnnouncements: isResolved && canManageAnnouncements(role),
      canSendNotifications: isResolved && canSendNotifications(role),

      canAccessPage: (page: WorkspacePage) =>
        isResolved && canAccessPage(page, role, profile?.uid ?? ""),
      canEditPageData: (page: WorkspacePage) =>
        isResolved && canEditPageData(page, role, profile?.uid ?? ""),
      isResponsibleForPage: (page: WorkspacePage) =>
        isResolved && isResponsibleForPage(page, profile?.uid ?? ""),
      canManagePage: (page: WorkspacePage) =>
        isResolved && canManagePage(page, role, profile?.uid ?? ""),
      canDeletePage: (page: WorkspacePage) =>
        isResolved && canDeletePage(page, role, profile?.uid ?? ""),
    }),
    [role, profile?.uid, isResolved, hasMembership]
  );
}
