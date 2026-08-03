import { deleteDoc, getDocs, onSnapshot, query, setDoc, where } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths, withErrorReporting } from "@/firebase/firestore";
import { generateId } from "@/utils/id";
import { addOwnWorkspaceId } from "@/services/authService";
import type { Role, WorkspaceMember } from "@/types";

export function subscribeToMembers(
  workspaceId: string,
  onData: (members: WorkspaceMember[]) => void,
  onError?: (error: import("firebase/firestore").FirestoreError) => void
) {
  let cancelled = false;
  let emittedOnce = false;
  let pendingEmptyCacheTimer: ReturnType<typeof setTimeout> | null = null;

  const unsubscribe = onSnapshot(
    paths.members(workspaceId),
    (snapshot) => {
      if (cancelled) return;
      const members = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as unknown as WorkspaceMember);

      if (pendingEmptyCacheTimer) {
        clearTimeout(pendingEmptyCacheTimer);
        pendingEmptyCacheTimer = null;
      }

      // Same fix as pages/workspace list: don't trust an empty result from
      // local cache on the very first snapshot — wait briefly for the real
      // server confirmation instead of flashing empty and requiring reload.
      if (snapshot.metadata.fromCache && members.length === 0 && !emittedOnce) {
        pendingEmptyCacheTimer = setTimeout(() => {
          if (!cancelled) {
            emittedOnce = true;
            onData([]);
          }
        }, 1200);
        return;
      }

      emittedOnce = true;
      onData(members.sort((a, b) => a.invitedAt - b.invitedAt));
    },
    withErrorReporting(onError)
  );

  return () => {
    cancelled = true;
    if (pendingEmptyCacheTimer) clearTimeout(pendingEmptyCacheTimer);
    unsubscribe();
  };
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
