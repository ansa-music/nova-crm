import type { Role, WorkspacePage } from "@/types";

/**
 * Access model: the Owner is the only role with blanket, implicit access to
 * everything in the workspace. Every other member — regardless of role —
 * only sees/opens a page if their uid is explicitly listed in that page's
 * `allowedUsers`. This is enforced identically on the server in
 * firestore.rules; these client-side checks exist purely for UX (hiding nav
 * items, showing "Access denied") and must never be the only line of defense.
 */

export function canManageWorkspace(role: Role): boolean {
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

export function canCreatePages(role: Role): boolean {
  return role === "owner";
}

export function canEditPageStructure(role: Role): boolean {
  return role === "owner";
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

/** Whether a given user (role + uid) may open a specific workspace page at all. */
export function canAccessPage(page: WorkspacePage, role: Role, uid: string): boolean {
  if (role === "owner") return true;
  if (page.hiddenByResponsible && page.responsibleUserId !== uid) return false;
  return page.allowedUsers.includes(uid);
}

/**
 * Whether a user may edit row data on a specific page (not just view it).
 * Being in `allowedUsers` alone is no longer enough — edit rights are now a
 * separate, explicit grant (`editableUsers`) on top of view access, managed
 * by the Owner or this page's responsible person. Owner and the responsible
 * person can always edit regardless of this list.
 */
export function canEditPageData(page: WorkspacePage, role: Role, uid: string): boolean {
  if (role === "owner") return true;
  if (isResponsibleForPage(page, uid)) return true;
  if (!canAccessPage(page, role, uid)) return false;
  return Boolean(page.editableUsers?.includes(uid));
}

/** Only the person the Owner assigned as responsible for this page may toggle its visibility to others. */
export function isResponsibleForPage(page: WorkspacePage, uid: string): boolean {
  return Boolean(page.responsibleUserId) && page.responsibleUserId === uid;
}

/**
 * Page-scoped "administrator" rights: full control over THIS ONE page
 * (rename, colour/icon, columns, subpages, who has access) without any of
 * the workspace-wide Owner powers (roles, billing, other pages, deleting
 * the workspace). Owner always qualifies; otherwise only the person
 * explicitly assigned as this page's responsible.
 */
export function canManagePage(page: WorkspacePage, role: Role, uid: string): boolean {
  return role === "owner" || isResponsibleForPage(page, uid);
}

/** Only Owner or Admin may assign/change who is responsible for a page. */
export function canAssignResponsible(role: Role): boolean {
  return role === "owner" || role === "admin";
}
