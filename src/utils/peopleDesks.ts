import type { WorkspaceMember, WorkspacePage } from "@/types";

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
  return group.pages[0]?.name ?? "";
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

export function findMyDesk(uid: string | null | undefined, groups: PersonDeskGroup[], studioPages: WorkspacePage[]) {
  if (!uid) return null;
  const mine = groups.find((g) => g.uid === uid) ?? null;
  return mine?.pages[0] ?? studioPages.find((p) => p.responsibleUserId === uid) ?? null;
}
