import { useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useAppBootstrap } from "@/hooks/useAppBootstrap";
import {
  allowedSimulatedRoles,
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
  canSimulateRole,
  canViewHistory,
  isResponsibleForPage,
} from "@/utils/permissions";
import { findOwnMembership } from "@/services/memberService";
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
 *
 * "Переключение режима привилегий": every capability below is computed from
 * `effectiveRole`, NOT the real `role` — so simulating Manager genuinely
 * hides Owner-only UI and applies Manager-level client checks, exactly like
 * using the app as a real Manager would. `realRole` stays available
 * separately (for the switcher itself, and so a real Owner can always find
 * their way back). This is a UI/UX layer only: Firestore Rules never read
 * `activeRole` and continue to authorize every actual write using the
 * account's real, Owner-controlled `role` — simulating a lower role here
 * can only ever hide/restrict what the client attempts, never grant
 * anything beyond what the real role could already do at the Firestore
 * level, and can never grant anything ABOVE the real role either (a stray
 * or stale activeRole value that the current real role isn't allowed to
 * simulate is ignored below, falling back to the real role).
 */
export function usePermissions() {
  const { profile } = useAuth();
  const { members, activeWorkspace, membersLoadState } = useWorkspace();
  const { isReady } = useAppBootstrap();

  const uid = profile?.uid ?? "";
  const isOwnerOfWorkspace = Boolean(uid && activeWorkspace?.ownerId === uid);

  const membership = useMemo(
    () => findOwnMembership(members, profile?.uid, profile?.email),
    [members, profile?.uid, profile?.email]
  );

  // Workspace ownerId wins over a stale/wrong member row (invite stub, email match).
  const realRole: Role = isOwnerOfWorkspace ? "owner" : (membership?.role ?? "viewer");
  const storedActiveRole = membership?.activeRole ?? null;
  // Defensive clamp: only trust a stored activeRole if the CURRENT real role
  // is still allowed to simulate it (e.g. protects against a stale value if
  // this account was ever demoted by the Owner while a simulation was on).
  const activeRole: Role | null =
    storedActiveRole && canSimulateRole(realRole, storedActiveRole) ? storedActiveRole : null;
  const effectiveRole: Role = activeRole ?? realRole;
  const isSimulating = activeRole !== null && activeRole !== realRole;
  // Empty members before the first CONFIRMED snapshot is loading, not "not a member".
  const isResolved = isReady && (membersLoadState === "ready" || isOwnerOfWorkspace);
  const hasMembership = Boolean(membership) || isOwnerOfWorkspace;

  return useMemo(
    () => ({
      /** Effective role after simulation — use this for all normal UI permission checks (it's what everything below already does). */
      role: effectiveRole,
      /** The account's true, Owner-controlled role. Never affected by simulation. */
      realRole,
      /** Currently simulated role, or null if using the real role. */
      activeRole,
      /** True only when actively simulating a DIFFERENT role than the real one. */
      isSimulating,
      /** Which roles this account's REAL role is allowed to simulate — empty for Manager/Viewer. */
      allowedSimulatedRoles: allowedSimulatedRoles(realRole),
      uid,
      /** False while user/role/workspace/pages are still resolving. */
      isResolved,
      /** Resolved, but this account has no member record in the active workspace. */
      hasMembership,

      canManageWorkspace: isResolved && canManageWorkspace(effectiveRole),
      canInviteMembers: isResolved && canInviteMembers(effectiveRole),
      canChangeRoles: isResolved && canChangeRoles(effectiveRole),
      canRemoveMembers: isResolved && canRemoveMembers(effectiveRole),
      canCreatePages: isResolved && canCreatePages(effectiveRole),
      canEditPageStructure: isResolved && canEditPageStructure(effectiveRole),
      canManagePagePermissions: isResolved && canManagePagePermissions(effectiveRole),
      canViewHistory: isResolved && canViewHistory(effectiveRole),
      canRestoreHistory: isResolved && canRestoreHistory(effectiveRole),
      canAssignResponsible: isResolved && canAssignResponsible(effectiveRole),
      canManageAnnouncements: isResolved && canManageAnnouncements(effectiveRole),
      canSendNotifications: isResolved && canSendNotifications(effectiveRole),
      /** Owner/Admin create pages freely; a plain Manager is limited to one owned page (see managerPageQuota.ts). */
      hasElevatedCreatePermission: isResolved && (effectiveRole === "owner" || effectiveRole === "admin"),

      canAccessPage: (page: WorkspacePage) => isResolved && canAccessPage(page, effectiveRole, uid),
      canEditPageData: (page: WorkspacePage) => isResolved && canEditPageData(page, effectiveRole, uid),
      isResponsibleForPage: (page: WorkspacePage) => isResolved && isResponsibleForPage(page, uid),
      canManagePage: (page: WorkspacePage) => isResolved && canManagePage(page, effectiveRole, uid),
      canDeletePage: (page: WorkspacePage) => isResolved && canDeletePage(page, effectiveRole, uid),
    }),
    [effectiveRole, realRole, activeRole, isSimulating, uid, isResolved, hasMembership]
  );
}
