import { deleteDoc, getDocs, onSnapshot, query, setDoc, where } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths, withErrorReporting } from "@/firebase/firestore";
import { generateId } from "@/utils/id";
import { addOwnWorkspaceId } from "@/services/authService";
import type { Role, WorkspaceMember } from "@/types";

function sortMembers(members: WorkspaceMember[]) {
  return members.sort((a, b) => a.invitedAt - b.invitedAt);
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
    withErrorReporting(onError)
  );

  return () => {
    cancelled = true;
    unsubscribe();
  };
}

export function mergeOwnMember(members: WorkspaceMember[], own: WorkspaceMember | null): WorkspaceMember[] {
  if (!own) return members;
  const idx = members.findIndex(
    (m) => (own.uid && m.uid === own.uid) || (own.email && m.email?.trim().toLowerCase() === own.email.trim().toLowerCase())
  );
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
  const member: WorkspaceMember = {
    uid: "",
    email: normalizedEmail,
    name: normalizedEmail.split("@")[0],
    role,
    status: "invited",
    invitedAt: Date.now(),
    invitedBy,
    inviteToken: generateId("inv"),
  };
  await setDoc(paths.member(workspaceId, normalizedEmail), member);
  return member;
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
