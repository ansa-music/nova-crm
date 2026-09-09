import type { Role, WorkspaceMember, WorkspacePage } from "@/types";

export function personLabel(member?: { name?: string; nickname?: string } | null) {
  if (!member) return "";
  return member.nickname || member.name || "";
}

export interface PersonDeskGroup {
  key: string;
  uid: string | null;
  member: WorkspaceMember | null;
  pages: WorkspacePage[];
  /** True when this person's desk is hidden from others (or not openable). */
  deskHidden?: boolean;
}

export function groupDesksByPerson(pages: WorkspacePage[], members: WorkspaceMember[]): PersonDeskGroup[] {
  const byUid = new Map<string, WorkspacePage[]>();
  const unassigned: WorkspacePage[] = [];
  for (const page of pages) {
    const uid = page.responsibleUserId;
    if (!uid) {
      unassigned.push(page);
      continue;
    }
    const list = byUid.get(uid) ?? [];
    list.push(page);
    byUid.set(uid, list);
  }
  const groups: PersonDeskGroup[] = [];
  for (const [uid, list] of byUid) {
    list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "ru"));
    const member = members.find((m) => m.uid === uid) ?? null;
    groups.push({ key: uid, uid, member, pages: list });
  }
  groups.sort((a, b) => personLabel(a.member).localeCompare(personLabel(b.member), "ru"));
  if (unassigned.length) {
    unassigned.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "ru"));
    groups.push({ key: "__none__", uid: null, member: null, pages: unassigned });
  }
  return groups;
}


/** Directory of every workspace member, even with no visible/openable desk. */
export function groupAllPeople(members: WorkspaceMember[], visiblePages: WorkspacePage[]): PersonDeskGroup[] {
  const byUid = new Map<string, WorkspacePage[]>();
  for (const page of visiblePages) {
    const uid = page.responsibleUserId;
    if (!uid) continue;
    const list = byUid.get(uid) ?? [];
    list.push(page);
    byUid.set(uid, list);
  }
  const groups: PersonDeskGroup[] = [];
  for (const member of members) {
    if (!member.uid) continue;
    const list = (byUid.get(member.uid) ?? []).slice();
    list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "ru"));
    const deskHidden = list.length > 0 && list.every((p) => p.hiddenByResponsible);
    groups.push({ key: member.uid, uid: member.uid, member, pages: list, deskHidden });
  }
  groups.sort((a, b) => personLabel(a.member).localeCompare(personLabel(b.member), "ru"));
  return groups;
}

export function groupDeskSubtitle(group: PersonDeskGroup) {
  if (group.pages[0]?.name) return group.pages[0].name;
  if (group.member?.role === "manager") return "стола нет";
  return "";
}

export const OWNER_FALLBACK_COVER = "/covers/nurba.png";
export const DESK_FALLBACK_COVER = "/covers/default.png";

export function resolvedCoverUrl(
  page: { coverUrl?: string | null; responsibleUserId?: string | null } | null | undefined,
  ownerUid?: string | null
) {
  if (page?.coverUrl) return page.coverUrl;
  if (ownerUid && page?.responsibleUserId === ownerUid) return OWNER_FALLBACK_COVER;
  return DESK_FALLBACK_COVER;
}

export function findMyDesk(uid: string | null | undefined, groups: PersonDeskGroup[], pages: WorkspacePage[]) {
  if (!uid) return null;
  // Prefer the page this person is responsible for, even if canAccessPage
  // filtered it out of studio groups (hidden desk / stale ACL).
  return (
    pages.find((p) => p.responsibleUserId === uid) ??
    groups.find((g) => g.uid === uid)?.pages[0] ??
    null
  );
}

export function deskOwnerName(members: WorkspaceMember[], page: WorkspacePage) {
  return personLabel(members.find((m) => m.uid === page.responsibleUserId) ?? null);
}

export function splitStudioDesks(
  pages: WorkspacePage[],
  opts: {
    uid?: string | null;
  }
): { visible: WorkspacePage[]; hidden: WorkspacePage[] } {
  const visible: WorkspacePage[] = [];
  const hidden: WorkspacePage[] = [];
  const uid = opts.uid ?? null;
  for (const page of pages) {
    const own = Boolean(uid && page.responsibleUserId === uid);
    // Main grid = non-hidden covers for everyone. Own desk stays here even if they hid it.
    // Others' hidden desks stay behind «Скрытые столы».
    if (!page.hiddenByResponsible || own) visible.push(page);
    else hidden.push(page);
  }
  return { visible, hidden };
}

/** Home / Dashboard cover grids: same as /desks main, hidden desks stay off. */
export function coverGridPages(
  pages: WorkspacePage[],
  opts: {
    uid?: string | null;
  }
): WorkspacePage[] {
  return splitStudioDesks(pages, opts).visible.filter((page) => !page.hiddenByResponsible);
}

export function isRestrictedDeskRole(role: Role): boolean {
  return role === "manager" || role === "viewer";
}

/**
 * Whether this user may OPEN the table (navigate to /page/:id), not merely see the cover.
 *
 * Deliberately the exact mirror of canAccessPage() in firestore.rules:
 * Owner, the desk's responsible person, or membership in `allowedUsers` —
 * nothing else. The view-request status is NOT part of this decision, and
 * `hiddenByResponsible` does not change it either.
 *
 * That is not a loosening: an approved view-request has never been access
 * by itself, it is only the mechanism that PUTS you in allowedUsers
 * (resolveDeskViewRequest calls toggleUserPageAccess on approval), and
 * hiding a desk (togglePageVisibility with show=false) empties
 * allowedUsers down to the responsible person, so "a stale allowedUsers
 * entry left over from before the desk was hidden" — the case earlier
 * versions tried to defend against by also requiring an approved request —
 * cannot actually occur through the product.
 *
 * Requiring both produced two real bugs instead. On a hidden desk the
 * Owner's «Доступ» toggle in /people writes allowedUsers and nothing else,
 * so with no request in existence (and no UI anywhere to create an
 * approved one on someone's behalf) the grantee stayed stuck on «Стол
 * скрыт — запросите просмотр»: the Owner could not grant access to a
 * hidden desk at all. And on a visible desk the old OR meant a request
 * that was approved once kept the desk open forever after the Owner
 * unticked «Доступ» — nothing ever clears an approved request — so the
 * client said "open" while Firestore denied the rows, landing the user on
 * an empty table plus a «Нет доступа к части данных» toast. Matching the
 * server rule exactly fixes both directions at once: adding someone to
 * allowedUsers grants, removing them revokes, hidden or not.
 */
export function canOpenDesk(opts: {
  page: WorkspacePage;
  uid?: string | null;
  isOwner: boolean;
  role: Role;
}): boolean {
  const uid = opts.uid ?? "";
  if (!uid) return false;
  if (opts.isOwner) return true;
  if (opts.page.responsibleUserId === uid) return true;
  return Boolean(opts.page.allowedUsers?.includes(uid));
}

