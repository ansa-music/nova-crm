import { getDoc, setDoc } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths, subscribe, subscribeToDoc } from "@/firebase/firestore";
import type { JoinRequest, Role, Workspace, WorkspaceMember } from "@/types";

/** Minimal public info shown on the /join/:workspaceId page before the person is a member. */
export async function getPublicWorkspaceInfo(workspaceId: string): Promise<Workspace | null> {
  if (!db) return null;
  const snap = await getDoc(paths.workspace(workspaceId));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as Workspace) : null;
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
    email,
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
export function subscribeToJoinRequests(
  workspaceId: string,
  onData: (requests: JoinRequest[]) => void
) {
  return subscribe<JoinRequest>(paths.joinRequests(workspaceId), (requests) =>
    onData(
      requests
        .filter((r) => r.status === "pending")
        .sort((a, b) => a.requestedAt - b.requestedAt)
    )
  );
}

/** Owner approves: creates a real member record, then marks the request approved (kept for the requester's own UI + audit trail). */
export async function approveJoinRequest(workspaceId: string, request: JoinRequest, role: Role, approvedBy: string) {
  if (!db) return;
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
  await setDoc(paths.joinRequest(workspaceId, request.uid), { status: "approved" }, { merge: true });
}

/** Owner rejects: marks the request rejected, no member is created. */
export async function rejectJoinRequest(workspaceId: string, uid: string) {
  if (!db) return;
  await setDoc(paths.joinRequest(workspaceId, uid), { status: "rejected" }, { merge: true });
}
