import { deleteDoc, getDoc, getDocs, onSnapshot, query, setDoc, where } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths, withErrorReporting } from "@/firebase/firestore";
import { generateId } from "@/utils/id";
import { addOwnWorkspaceId } from "@/services/authService";
import type { Role, WorkspaceMember } from "@/types";

function sortMembers(members: WorkspaceMember[]) {
  return members.sort((a, b) => a.invitedAt - b.invitedAt);
}

export function normalizeMemberEmail(email?: string | null): string {
  return email?.trim().toLowerCase() ?? "";
}

/** Hide invite stubs that already have an active member or a pending join on the same email. */
export function visibleMemberRoster(
  members: WorkspaceMember[],
  pendingJoinEmails: Iterable<string>
): WorkspaceMember[] {
  const joinEmails = new Set(Array.from(pendingJoinEmails, normalizeMemberEmail).filter(Boolean));
  const activeEmails = new Set(
    members
      .filter((m) => m.status === "active")
      .map((m) => normalizeMemberEmail(m.email))
      .filter(Boolean)
  );
  const seenInvited = new Set<string>();
  const out: WorkspaceMember[] = [];
  for (const member of members) {
    if (member.status !== "invited") {
      out.push(member);
      continue;
    }
    const email = normalizeMemberEmail(member.email);
    if (!email || seenInvited.has(email)) continue;
    if (joinEmails.has(email) || activeEmails.has(email)) continue;
    seenInvited.add(email);
    out.push(member);
  }
  return out;
}

export const QUIET_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** Active members silent for 7 days. lastActiveAt, else joinedAt. Not presence (10 min). */
export function quietActiveMembers(
  members: WorkspaceMember[],
  myUid?: string | null,
  now = Date.now()
): WorkspaceMember[] {
  return members
    .filter((m) => {
      if (m.status !== "active") return false;
      if (myUid && m.uid && m.uid === myUid) return false;
      const ts = m.lastActiveAt || m.joinedAt;
      if (!ts) return false;
      return now - ts > QUIET_AFTER_MS;
    })
    .sort((a, b) => (a.lastActiveAt || a.joinedAt || 0) - (b.lastActiveAt || b.joinedAt || 0));
}


export async function fetchMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  const snapshot = await getDocs(paths.members(workspaceId));
  return sortMembers(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as unknown as WorkspaceMember));
}

/**
 * Live listener for THIS user's membership only (role, hidden pages, simulation).
 * Does not listen to the rest of the members collection — presence heartbeats
 * on other docs would otherwise fan out a billed snapshot to every client.
 */
export function subscribeToOwnMember(
  workspaceId: string,
  uid: string,
  onData: (member: WorkspaceMember | null) => void,
  onError?: (error: import("firebase/firestore").FirestoreError) => void
) {
  let cancelled = false;
  let emittedOnce = false;

  const unsubscribe = onSnapshot(
    paths.member(workspaceId, uid),
    (snapshot) => {
      if (cancelled) return;
      // Same race as the old collection listener: a missing cache doc is not "not a member".
      if (snapshot.metadata.fromCache && !snapshot.exists() && !emittedOnce) {
        return;
      }
      emittedOnce = true;
      onData(snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as unknown as WorkspaceMember) : null);
    },
    (error) => {
      if (cancelled) return;
      // Missing members/{uid} is permission-denied under older rules (get of a
      // non-existent doc). Do not toast — treat as "no own member row" so
      // fetchMembers roster can still resolve the role.
      if (error.code === "permission-denied") {
        onData(null);
        return;
      }
      withErrorReporting(onError)(error);
    }
  );

  return () => {
    cancelled = true;
    unsubscribe();
  };
}

/**
 * Resolve THIS signed-in account's member row.
 * Must prefer uid. Matching any row with the same email (old `find` OR) lets an
 * email-keyed invite stub (uid "", role viewer) win over the real uid-keyed
 * owner/admin doc — after Users panel refetches the roster, canAccessPage then
 * treats the signed-in user as a Viewer and every table looks locked.
 */
export function findOwnMembership(
  members: WorkspaceMember[],
  uid?: string | null,
  email?: string | null
): WorkspaceMember | null {
  const normalizedEmail = email?.trim().toLowerCase() || "";
  if (uid) {
    const active = members.find((m) => m.uid === uid && m.status !== "invited");
    if (active) return active;
    const anyUid = members.find((m) => m.uid === uid);
    if (anyUid) return anyUid;
  }
  if (!normalizedEmail) return null;
  return (
    members.find(
      (m) =>
        m.email?.trim().toLowerCase() === normalizedEmail &&
        (!m.uid || m.uid === uid) &&
        m.status !== "invited"
    ) ??
    members.find(
      (m) => m.email?.trim().toLowerCase() === normalizedEmail && (!m.uid || m.uid === uid)
    ) ??
    null
  );
}

export function mergeOwnMember(members: WorkspaceMember[], own: WorkspaceMember | null): WorkspaceMember[] {
  if (!own) return members;
  let idx = own.uid ? members.findIndex((m) => m.uid === own.uid) : -1;
  if (idx === -1 && own.email) {
    const email = own.email.trim().toLowerCase();
    idx = members.findIndex((m) => !m.uid && m.email?.trim().toLowerCase() === email);
  }
  if (idx === -1) return sortMembers([...members, own]);
  const next = members.slice();
  next[idx] = { ...next[idx], ...own };
  return next;
}

/** Creates a pending invite, keyed temporarily by email until the user signs in. */
export async function inviteMember(
  workspaceId: string,
  email: string,
  role: Role,
  invitedBy: string
) {
  if (!db) throw new Error("Firebase не настроен");
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) throw new Error("Введите email");
  const existing = (await fetchMembers(workspaceId)).find(
    (m) => m.email?.trim().toLowerCase() === normalizedEmail
  );
  if (existing) {
    throw new Error(
      existing.status === "invited"
        ? "Этому email уже отправлено приглашение"
        : "Этот email уже в workspace"
    );
  }
  // Email-keyed stub: no uid field. Empty uid:"" made findOwnMembership treat
  // the invite as a real row and locked tables after claim.
  const member: Omit<WorkspaceMember, "uid"> = {
    email: normalizedEmail,
    name: normalizedEmail.split("@")[0],
    role,
    status: "invited",
    invitedAt: Date.now(),
    invitedBy,
    inviteToken: generateId("inv"),
  };
  await setDoc(paths.member(workspaceId, normalizedEmail), member);
  return member as WorkspaceMember;
}


/** Delete an email-keyed invite stub only. Never members/{uid} and never uid "". */
export async function cancelInvite(workspaceId: string, email: string) {
  if (!db) return;
  const normalized = email.trim().toLowerCase();
  if (!normalized) throw new Error("Нет email для отмены приглашения");
  const snap = await getDoc(paths.member(workspaceId, normalized));
  const data = snap.exists() ? (snap.data() as WorkspaceMember) : null;
  if (!data || data.status !== "invited") {
    throw new Error("Приглашение не найдено");
  }
  await deleteDoc(snap.ref);
}

/** After approve/claim: drop leftover members/{email} invite stub if it is still invited. */
export async function deleteInvitedStubIfPresent(workspaceId: string, email: string, keepUid?: string) {
  if (!db) return;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;
  if (keepUid && normalized === keepUid) return;
  const snap = await getDoc(paths.member(workspaceId, normalized));
  if (!snap.exists()) return;
  const data = snap.data() as WorkspaceMember;
  if (data.status !== "invited") return;
  await deleteDoc(snap.ref);
}

export async function resendInvite(workspaceId: string, email: string) {
  if (!db) return;
  await setDoc(
    paths.member(workspaceId, email),
    { invitedAt: Date.now(), inviteToken: generateId("inv") },
    { merge: true }
  );
}

export async function changeMemberRole(workspaceId: string, uid: string, role: Role) {
  if (!db) return;
  await setDoc(paths.member(workspaceId, uid), { role }, { merge: true });
}

/**
 * "Переключение режима привилегий" — self-service, changes only how THIS
 * person's own client behaves (effectiveRole), never their real `role`.
 * Firestore Rules independently cap which values are accepted based on the
 * caller's real role, so this can never be used to self-escalate even via a
 * raw write. Pass `null` to stop simulating and return to the real role.
 */
export async function setActiveRole(workspaceId: string, uid: string, activeRole: Role | null) {
  if (!db) return;
  await setDoc(paths.member(workspaceId, uid), { activeRole }, { merge: true });
}

/** Toggles a page in/out of this member's OWN "hidden from my sidebar" list — purely personal, never affects access. */
export async function toggleHiddenPage(workspaceId: string, uid: string, pageId: string, hide: boolean, currentHiddenPageIds: string[]) {
  if (!db) return;
  const hiddenPageIds = hide
    ? Array.from(new Set([...currentHiddenPageIds, pageId]))
    : currentHiddenPageIds.filter((id) => id !== pageId);
  await setDoc(paths.member(workspaceId, uid), { hiddenPageIds }, { merge: true });
}

export async function removeMember(workspaceId: string, uid: string) {
  if (!db) return;
  await deleteDoc(paths.member(workspaceId, uid));
}

/**
 * Called right after a successful sign-in: converts any pending
 * email-keyed invites that match this account into active memberships.
 */
export async function claimPendingInvites(
  uid: string,
  email: string,
  name: string,
  photoURL?: string | null,
  nickname?: string
) {
  if (!db) return;
  const normalizedEmail = email.trim().toLowerCase();
  const q = query(
    paths.memberGroup(),
    where("email", "==", normalizedEmail),
    where("status", "==", "invited")
  );
  const snapshot = await getDocs(q);
  await Promise.all(
    snapshot.docs.map(async (docSnap) => {
      const workspaceId = docSnap.ref.parent.parent?.id;
      if (!workspaceId) return;
      const data = docSnap.data() as WorkspaceMember;
      await setDoc(paths.member(workspaceId, uid), {
        ...data,
        uid,
        name: name || data.name,
        nickname: nickname ?? data.nickname ?? null,
        photoURL: photoURL ?? null,
        status: "active",
        joinedAt: Date.now(),
      });
      await addOwnWorkspaceId(uid, workspaceId);
      if (docSnap.id !== uid) {
        await deleteDoc(docSnap.ref);
      }
    })
  );
}
