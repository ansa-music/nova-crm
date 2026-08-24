// PATH: src/utils/permissions.ts  (REPLACES EXISTING)
import type { Role, WorkspacePage } from "@/types";

/**
 * Access model (kept intentionally close to the original — the only change is
 * that Manager is now a real author instead of a de-facto Viewer):
 *
 *  - Owner: blanket, implicit access to everything in the workspace.
 *  - Admin: workspace administration (assigning who's responsible for a page),
 *    but NO blanket page access. This is deliberate: the non-owner pages list
 *    query is `where("allowedUsers","array-contains",uid)`, and Firestore can
 *    only prove that query safe if the rule condition matches it exactly.
 *    Granting Admin blanket page reads would make the UI and the rules
 *    disagree — exactly the failure mode we're eliminating.
 *  - Manager: may CREATE pages. A page they create makes them its responsible
 *    person, which gives them full control over that page (structure, rows,
 *    subpages, access list) — and nothing outside it.
 *  - Viewer: read-only.
 *
 * Every function here is mirrored 1:1 in firestore.rules. These checks exist
 * for UX (hiding controls, rendering "Access denied") and must never be the
 * only line of defense.
 */

export function canManageWorkspace(role: Role): boolean {
  return role === "owner";
}

/** Status/select option lists (add/edit/delete/reorder «Готово» etc.) — Owner only. */
export function canManageStatusVariants(role: Role): boolean {
  return role === "owner";
}

export function canInviteMembers(role: Role): boolean {
  return role === "owner";
}

export function canChangeRoles(role: Role): boolean {
  return role === "owner";
}

export function canRemoveMembers(role: Role): boolean {
  return role === "owner";
}

/**
 * CHANGED: Manager (and Admin) may now create their own pages. Mirrored by the
 * `pages` create rule, which additionally forces a Manager to set themselves
 * as responsibleUserId and to be present in allowedUsers — so a Manager can
 * never create a page they don't own or that is invisible to them.
 */
export function canCreatePages(role: Role): boolean {
  return role === "owner" || role === "admin" || role === "manager";
}

/**
 * Role-level capability only. Whether structure may be edited on a SPECIFIC
 * page is `canManagePage(page, role, uid)` — always prefer that at call sites.
 */
export function canEditPageStructure(role: Role): boolean {
  return role === "owner" || role === "admin" || role === "manager";
}

export function canManagePagePermissions(role: Role): boolean {
  return role === "owner";
}

export function canViewHistory(role: Role): boolean {
  return role === "owner";
}

export function canRestoreHistory(role: Role): boolean {
  return role === "owner";
}

/** Owner and Admin may post/edit/pin/archive/delete announcements. */
export function canManageAnnouncements(role: Role): boolean {
  return role === "owner" || role === "admin";
}

/** Only the Owner may send notifications (as opposed to merely posting an announcement). */
export function canSendNotifications(role: Role): boolean {
  return role === "owner";
}

/**
 * Whether a given user may open a specific workspace page at all.
 * Owner (role or workspace.ownerId) always. The responsible person always —
 * hiddenByResponsible / view-requests must never lock them out of their own desk.
 */
export function canAccessPage(
  page: WorkspacePage,
  role: Role,
  uid: string,
  workspaceOwnerId?: string | null
): boolean {
  if (!uid) return false;
  if (workspaceOwnerId && uid === workspaceOwnerId) return true;
  if (role === "owner") return true;
  if (isResponsibleForPage(page, uid)) return true;
  return Boolean(page.allowedUsers?.includes(uid));
}

/**
 * Whether a user may edit row data on a specific page (not just view it).
 * Being in `allowedUsers` alone is not enough — edit rights are a separate,
 * explicit grant (`editableUsers`). Owner and the responsible person can
 * always edit regardless of that list.
 */
export function canEditPageData(page: WorkspacePage, role: Role, uid: string): boolean {
  if (role === "owner") return true;
  if (isResponsibleForPage(page, uid)) return true;
  if (!canAccessPage(page, role, uid)) return false;
  return Boolean(page.editableUsers?.includes(uid));
}

export function isResponsibleForPage(page: WorkspacePage, uid: string): boolean {
  return Boolean(uid) && page.responsibleUserId === uid;
}

/**
 * Page-scoped "administrator" rights: full control over THIS ONE page
 * (rename, colour/icon, columns, subpages, who has access) without any
 * workspace-wide Owner powers. Owner always qualifies; otherwise only the
 * person assigned as this page's responsible — which, for a page a Manager
 * created, is that Manager.
 */
export function canManagePage(page: WorkspacePage, role: Role, uid: string): boolean {
  // Use the *effective* role (RoleSwitcher preview). Owner uid must not keep
  // page-admin UI while simulating Viewer. A real/preview Manager still
  // manages desks they are responsible for — status *variants* stay Owner-only
  // via canManageStatusVariants(effectiveRole), never this check.
  if (role === "owner") return true;
  if (role === "viewer") return false;
  return isResponsibleForPage(page, uid);
}

/** Only Owner or Admin may assign/change who is responsible for a page. */
export function canAssignResponsible(role: Role): boolean {
  return role === "owner" || role === "admin";
}

/**
 * "Переключение режима привилегий" — which activeRole values a person's
 * REAL role is allowed to simulate. This is the single source of truth for
 * the escalation rules and is mirrored exactly in firestore.rules, since the
 * actual security boundary lives there, not here (this copy is for UI only —
 * hiding options the person couldn't set anyway).
 *
 *   Owner  -> owner, admin, manager, viewer
 *   Admin  -> admin, manager, viewer   (never owner)
 *   Manager, Viewer -> not allowed to simulate anything
 */
export function allowedSimulatedRoles(realRole: Role): Role[] {
  if (realRole === "owner") return ["owner", "admin", "manager", "viewer"];
  if (realRole === "admin") return ["admin", "manager", "viewer"];
  return [];
}

export function canSimulateRole(realRole: Role, targetRole: Role): boolean {
  return allowedSimulatedRoles(realRole).includes(targetRole);
}
/**
 * Whether a page created by `uid` may be deleted by them. Mirrors the rules:
 * Owner always; otherwise only the creator who is still its responsible person.
 */
export function canDeletePage(page: WorkspacePage, role: Role, uid: string): boolean {
  if (role === "owner") return true;
  return isResponsibleForPage(page, uid) && page.createdBy === uid;
}
