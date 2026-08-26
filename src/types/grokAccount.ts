/**
 * A shared company Grok account — email/password plus when its usage limit
 * refreshes, so the team can see at a glance which accounts are usable
 * right now instead of everyone hitting the same rate-limited one. Visible
 * and editable by every workspace member (not gated by role) — the whole
 * point is that whoever last checked an account can update it for everyone.
 */
export interface GrokAccount {
  id: string;
  workspaceId: string;
  email: string;
  password: string;
  /** When the account's limit refreshes — ms epoch, or null if unknown/not set. */
  limitResetAt: number | null;
  updatedByUid: string;
  updatedByName: string;
  updatedAt: number;
  createdAt: number;
  createdBy: string;
}
