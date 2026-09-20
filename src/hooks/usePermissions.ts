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
  canRetireDesks,
  canDeleteWorkspace,
  canExportWorkspace,
  canEditPageData,
  canEditPageStructure,
  canInviteMembers,
  canManageAnnouncements,
  canManagePage,
  canManagePagePermissions,
  canManageStatusVariants,
  canManageWorkspace,
  canRemoveMembers,
  canRestoreHistory,
  canSeeTechnicians,
  canSendNotifications,
  canSimulateRole,
  canViewHistory,
  hasFullAccess,
  isDeskBlockedFor,
  isResponsibleForPage,
} from "@/utils/permissions";
import { findOwnMembership } from "@/services/memberService";
import { managerHasReachedPageQuota } from "@/services/managerPageQuota";
import { EXTRA_ROLES, type Role, type WorkspacePage } from "@/types";

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
  const { members, activeWorkspace, membersLoadState, pages } = useWorkspace();
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
  // Add-on roles (Технарь, ОС) count only with the real main role — a
  // simulation previews exactly one role.
  const extraRolesKey = (membership?.extraRoles ?? []).join(",");
  const roles = useMemo<Role[]>(() => {
    if (isSimulating) return [effectiveRole];
    const all: Role[] = [effectiveRole];
    for (const role of extraRolesKey ? (extraRolesKey.split(",") as Role[]) : []) {
      if (EXTRA_ROLES.includes(role) && !all.includes(role)) all.push(role);
    }
    return all;
  }, [effectiveRole, isSimulating, extraRolesKey]);
  const deskBlocked = isDeskBlockedFor(roles);
  const deskCreatorRole: Role | null = roles.includes("owner")
    ? "owner"
    : roles.includes("admin")
      ? "admin"
      : roles.includes("manager")
        ? "manager"
        : null;
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
      /** Every role in effect: the main one plus add-ons (Технарь, ОС). Rights add up. */
      roles,
      hasRole: (role: Role) => roles.includes(role),
      /** A Тимлид who isn't also a Технарь: no desk tables. */
      deskBlocked,
      /** Which create path a new desk takes (quota for a Технарь), or null when this person can't create one. */
      deskCreatorRole,
      canSeeTechnicians: isResolved && roles.some((role) => canSeeTechnicians(role)),
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
      /** Delete the workspace — the Owner only, never a Тимлид. */
      canDeleteWorkspace: isResolved && canDeleteWorkspace(effectiveRole),
      /** Full backup of every desk — the Owner only. */
      canExportWorkspace: isResolved && canExportWorkspace(effectiveRole),
      // Users admin follows the REAL role, not RoleSwitcher preview — otherwise
      // Owner/Тимлид can lose accept/roles UI while simulating Технарь/Viewer.
      canManageUsers: isResolved && (isOwnerOfWorkspace || hasFullAccess(realRole)),
      canManageStatusVariants: isResolved && canManageStatusVariants(effectiveRole),
      canInviteMembers: isResolved && canInviteMembers(effectiveRole),
      canChangeRoles: isResolved && canChangeRoles(effectiveRole),
      canRemoveMembers: isResolved && canRemoveMembers(effectiveRole),
      canCreatePages:
        isResolved &&
        roles.some((role) => canCreatePages(role)) &&
        (deskCreatorRole === "owner" ||
          deskCreatorRole === "admin" ||
          (deskCreatorRole === "manager" && !managerHasReachedPageQuota(pages, uid))),
      canEditPageStructure: isResolved && !deskBlocked && roles.some((role) => canEditPageStructure(role)),
      canManagePagePermissions: isResolved && canManagePagePermissions(effectiveRole),
      canViewHistory: isResolved && canViewHistory(effectiveRole),
      canRestoreHistory: isResolved && canRestoreHistory(effectiveRole),
      canAssignResponsible: isResolved && canAssignResponsible(effectiveRole),
      canManageAnnouncements: isResolved && canManageAnnouncements(effectiveRole),
      canSendNotifications: isResolved && canSendNotifications(effectiveRole),
      /** Owner/Admin create pages freely; a plain Manager is limited to one owned page (see managerPageQuota.ts). */
      hasElevatedCreatePermission: isResolved && (deskCreatorRole === "owner" || deskCreatorRole === "admin"),

      /** Workspace doc owner — true even if the members roster has a stale invite stub. */
      isWorkspaceOwner: isOwnerOfWorkspace,
      /**
       * Owner by REAL role — every desk opens, background upkeep (month tabs,
       * «Технари» recounts) runs. Like isWorkspaceOwner, not narrowed by a
       * role simulation. A Тимлид never has it: no desk tables for them.
       */
      hasFullDeskAccess: isOwnerOfWorkspace || realRole === "owner",

      canAccessPage: (page: WorkspacePage) => {
        if (!isResolved || !uid) return false;
        if (isOwnerOfWorkspace) return true;
        if (deskBlocked) return false;
        if (isResponsibleForPage(page, uid)) return true;
        return roles.some((role) => canAccessPage(page, role, uid, activeWorkspace?.ownerId));
      },
      canEditPageData: (page: WorkspacePage) =>
        isResolved && !deskBlocked && roles.some((role) => canEditPageData(page, role, uid)),
      isResponsibleForPage: (page: WorkspacePage) => Boolean(uid) && isResponsibleForPage(page, uid),
      canManagePage: (page: WorkspacePage) =>
        isResolved && !deskBlocked && roles.some((role) => canManagePage(page, role, uid)),
      canDeletePage: (page: WorkspacePage) =>
        isResolved && !deskBlocked && roles.some((role) => canDeletePage(page, role, uid)),
      /** Move desks to «Неактуальные» and back — Owner and Тимлид (by real role, like users admin). */
      canRetireDesks: isResolved && (isOwnerOfWorkspace || canRetireDesks(realRole)),
    }),
    [effectiveRole, realRole, activeRole, isSimulating, roles, deskBlocked, deskCreatorRole, uid, isResolved, hasMembership, isOwnerOfWorkspace, activeWorkspace?.ownerId, pages]
  );
}
