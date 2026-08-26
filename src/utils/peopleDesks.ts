import type { Role, ViewRequest, WorkspaceMember, WorkspacePage } from "@/types";

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

export function isApprovedViewRequest(request: ViewRequest | null | undefined): boolean {
  return request?.status === "approved";
}

/**
 * Whether this user may OPEN the table (navigate to /page/:id), not merely see the cover.
 * Owner: every desk. Responsible: always their own (even if hidden).
 * Технар/viewer: own desk, OR — for a HIDDEN desk specifically — only an
 * approved view-request (allowedUsers is deliberately not enough there, see
 * WorkspacePage.hiddenByResponsible: hidden must stay hidden from everyone
 * but Owner/responsible until the responsible person explicitly approves a
 * request, even if their uid still lingers in allowedUsers from before it
 * was hidden). For a desk that ISN'T hidden, an explicit allowedUsers grant
 * (e.g. the Owner toggling a member on in "Доступ") is real access on its
 * own and must open it without forcing a request first — the previous
 * version ignored allowedUsers entirely for Технар/viewer, so anyone added
 * straight to allowedUsers on a visible (non-hidden) desk still saw
 * "Запросить доступ" forever, since only an approved request ever counted.
 */
export function canOpenDesk(opts: {
  page: WorkspacePage;
  uid?: string | null;
  isOwner: boolean;
  role: Role;
  latestRequest?: ViewRequest | null;
}): boolean {
  const uid = opts.uid ?? "";
  if (!uid) return false;
  if (opts.isOwner) return true;
  if (opts.page.responsibleUserId === uid) return true;
  if (isRestrictedDeskRole(opts.role)) {
    if (opts.page.hiddenByResponsible) return isApprovedViewRequest(opts.latestRequest);
    return Boolean(opts.page.allowedUsers?.includes(uid)) || isApprovedViewRequest(opts.latestRequest);
  }
  return Boolean(opts.page.allowedUsers?.includes(uid));
}

