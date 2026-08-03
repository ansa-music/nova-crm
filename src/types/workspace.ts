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
