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
  /**
   * The one-tap status — this, not limitResetAt, is what the card's
   * Доступно/Недоступно button shows and toggles. Optional only because
   * accounts created before this field existed don't have it yet; treat a
   * missing value as available (see isGrokAccountAvailable in the page).
   */
  available?: boolean;
  /** When the account's limit refreshes — ms epoch, or null if unknown/not set. Supplementary info, shown alongside the status but doesn't drive it. */
  limitResetAt: number | null;
  updatedByUid: string;
  updatedByName: string;
  updatedAt: number;
  createdAt: number;
  createdBy: string;
}
