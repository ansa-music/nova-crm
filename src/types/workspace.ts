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
  photoURL?: string | null;
  role: Role;
  status: MemberStatus;
  invitedAt: number;
  invitedBy: string;
  joinedAt?: number;
  /** Present only while status === 'invited'; used as the accept-invite token. */
  inviteToken?: string;
}
