import type { Role } from "@/types/role";

export interface Workspace {
  id: string;
  name: string;
  icon: string;
  color: string;
  ownerId: string;
  createdAt: number;
}

export type MemberStatus = "active" | "invited";

export interface WorkspaceMember {
  uid: string;
  email: string;
  name: string;
  nickname?: string;
  photoURL?: string | null;
  role: Role;
  status: MemberStatus;
  invitedAt: number;
  invitedBy: string;
  joinedAt?: number;
  /** Present only while status === 'invited'; used as the accept-invite token. */
  inviteToken?: string;
  /** Self-reported heartbeat timestamp, refreshed periodically while the app is open. Drives the online/away/offline indicator. */
  lastActiveAt?: number;
  /**
   * Optional simulated role for testing/UX purposes ONLY — see
   * "Переключение режима привилегий". This is a self-writable, client-
   * visible field and MUST NEVER be trusted by Firestore Rules or any
   * server-side permission check: those always read `role` (above), which
   * only the Owner can change. `activeRole` only affects what the CLIENT
   * shows/attempts; the real Firestore-level access for this account is
   * always governed by `role`. Firestore Rules additionally cap which
   * values a member may set here to those their real `role` is allowed to
   * simulate (Owner: any; Admin: admin/manager/viewer; Manager/Viewer: not
   * allowed to set this field at all) — see the self-service member update
   * rule. Absent/null means "not simulating — use my real role".
   */
  activeRole?: Role | null;
}

export type JoinRequestStatus = "pending" | "approved" | "rejected";

/**
 * Someone who followed a workspace's shareable join link and asked to be let
 * in, before an Owner has approved them as an actual member. Anyone signed
 * in may create their own request doc; only the workspace Owner can read the
 * list, approve (which creates a real WorkspaceMember), or reject it.
 */
export interface JoinRequest {
  id: string;
  uid: string;
  email: string;
  name: string;
  photoURL?: string | null;
  workspaceId: string;
  status: JoinRequestStatus;
  requestedAt: number;
}
