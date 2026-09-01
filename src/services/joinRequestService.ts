import { getDoc, getDocs, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths, subscribeToDoc } from "@/firebase/firestore";
import { deleteInvitedStubIfPresent } from "@/services/memberService";
import type { JoinRequest, Role, Workspace, WorkspaceMember } from "@/types";

/** New accepted joiners become Технар so they can create exactly one own desk. Owner can still reassign. */
export const DEFAULT_JOIN_ROLE: Role = "manager";

/** Minimal public info shown on the /join/:workspaceId page before the person is a member. */
export async function getPublicWorkspaceInfo(workspaceId: string): Promise<Workspace | null> {
  if (!db) return null;
  try {
    const snap = await getDoc(paths.workspace(workspaceId));
    return snap.exists() ? ({ id: snap.id, ...snap.data() } as Workspace) : null;
  } catch (error) {
    console.error("getPublicWorkspaceInfo failed:", error);
    return null;
  }
}

export function subscribeToPublicWorkspaceInfo(
  workspaceId: string,
  onData: (workspace: Workspace | null) => void
) {
  return subscribeToDoc<Workspace>(paths.workspace(workspaceId), onData);
}

/** The requester creates their own request doc — this is what a "join link" click does. */
export async function submitJoinRequest(
  workspaceId: string,
  uid: string,
  email: string,
  name: string,
  photoURL?: string | null
): Promise<JoinRequest> {
  if (!db) throw new Error("Firebase не настроен");
  const request: JoinRequest = {
    id: uid,
    uid,
    email: email.trim().toLowerCase(),
    name,
    photoURL: photoURL ?? null,
    workspaceId,
    status: "pending",
    requestedAt: Date.now(),
  };
  await setDoc(paths.joinRequest(workspaceId, uid), request);
  return request;
}

/** So the requester's own UI can show "your request is pending / was rejected". */
export function subscribeToOwnJoinRequest(
  workspaceId: string,
  uid: string,
  onData: (request: JoinRequest | null) => void
) {
  return subscribeToDoc<JoinRequest>(paths.joinRequest(workspaceId, uid), onData);
}

/** Owner-only: list of everyone currently waiting to be let in. */
export async function fetchJoinRequests(workspaceId: string): Promise<JoinRequest[]> {
  const snap = await getDocs(paths.joinRequests(workspaceId));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as unknown as JoinRequest)
    .filter((r) => r.status === "pending")
    .sort((a, b) => a.requestedAt - b.requestedAt);
}


export function subscribeJoinRequests(workspaceId: string, cb: (rows: JoinRequest[]) => void) {
  if (!db) {
    cb([]);
    return () => {};
  }
  return onSnapshot(paths.joinRequests(workspaceId), (snap) => {
    cb(
      snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as unknown as JoinRequest)
        .filter((r) => r.status === "pending")
        .sort((a, b) => a.requestedAt - b.requestedAt)
    );
  });
}

/**
 * Owner approves: creates a real member record, then marks the request
 * approved (kept for the requester's own UI + audit trail).
 *
 * Defensive check: refuses outright if the requester already has a member
 * doc (most importantly if they're the Owner). This should never normally
 * happen — JoinWorkspacePage redirects existing members away from the
 * request flow before a request can even be submitted — but this exists as
 * a second, independent line of defense so a stray/duplicate request can
 * never silently downgrade someone's existing role again.
 */
export async function approveJoinRequest(workspaceId: string, request: JoinRequest, role: Role, approvedBy: string) {
  if (!db) return;
  const existing = await getDoc(paths.member(workspaceId, request.uid));
  if (existing.exists()) {
    await deleteInvitedStubIfPresent(workspaceId, request.email, request.uid);
    throw new Error(
      `${request.name} уже состоит в этом workspace (роль: ${(existing.data() as WorkspaceMember).role}). Заявка отклонена автоматически — обновите список участников.`
    );
  }
  const member: WorkspaceMember = {
    uid: request.uid,
    email: request.email,
    name: request.name,
    photoURL: request.photoURL ?? null,
    role,
    status: "active",
    invitedAt: request.requestedAt,
    invitedBy: approvedBy,
    joinedAt: Date.now(),
  };
  await setDoc(paths.member(workspaceId, request.uid), member);
  await deleteInvitedStubIfPresent(workspaceId, request.email, request.uid);
  await setDoc(paths.joinRequest(workspaceId, request.uid), { status: "approved" }, { merge: true });
}

/** Owner rejects: marks the request rejected, no member is created. */
export async function rejectJoinRequest(workspaceId: string, uid: string) {
  if (!db) return;
  await setDoc(paths.joinRequest(workspaceId, uid), { status: "rejected" }, { merge: true });
}

/**
 * The instant-join counterpart to approveJoinRequest — used only when the
 * workspace has `autoApproveJoins` on (see JoinWorkspacePage). Creates the
 * real member record directly, with no pending request and no Owner click
 * in between. Role/status are hard-coded here AND re-enforced by the
 * Firestore rule that actually authorizes this write (a signed-in user may
 * only ever create their OWN member doc this way, and only as
 * role: 'manager', status: 'active') — this function can't be tricked into
 * granting more than that even if called with different arguments.
 *
 * Same defensive re-check as approveJoinRequest: refuses if a member doc
 * already exists for this uid (e.g. a stale tab racing a second attempt).
 */
export async function selfJoinWorkspace(
  workspaceId: string,
  uid: string,
  email: string,
  name: string,
  photoURL?: string | null
): Promise<WorkspaceMember> {
  if (!db) throw new Error("Firebase не настроен");
  const existing = await getDoc(paths.member(workspaceId, uid));
  if (existing.exists()) {
    return existing.data() as WorkspaceMember;
  }
  const member: WorkspaceMember = {
    uid,
    email: email.trim().toLowerCase(),
    name,
    photoURL: photoURL ?? null,
    role: DEFAULT_JOIN_ROLE,
    status: "active",
    invitedAt: Date.now(),
    invitedBy: uid,
    joinedAt: Date.now(),
  };
  await setDoc(paths.member(workspaceId, uid), member);
  await deleteInvitedStubIfPresent(workspaceId, member.email, uid);
  return member;
}
