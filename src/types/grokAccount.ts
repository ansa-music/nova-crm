/**
 * A shared company Grok account — how to sign in, plus when its usage limit
 * refreshes, so the team can grab a working account at a glance.
 * Credentials and status are editable by every member; nickname is Owner/Admin only.
 */
export type GrokLoginMethod = "google" | "x" | "apple" | "email" | "phone";

export const GROK_LOGIN_METHODS: { id: GrokLoginMethod; label: string }[] = [
  { id: "google", label: "Google" },
  { id: "x", label: "X" },
  { id: "apple", label: "Apple" },
  { id: "email", label: "Почта" },
  { id: "phone", label: "Телефон" },
];

export function grokLoginMethodOf(value: unknown): GrokLoginMethod {
  return GROK_LOGIN_METHODS.some((m) => m.id === value) ? (value as GrokLoginMethod) : "email";
}

export function grokLoginMethodLabel(method: GrokLoginMethod): string {
  return GROK_LOGIN_METHODS.find((m) => m.id === method)?.label ?? "Почта";
}

export interface GrokAccount {
  id: string;
  workspaceId: string;
  email: string;
  password: string;
  /**
   * Human label on the card so the team can tell accounts apart at a glance.
   * Optional on older rows. Only Owner/Admin may set it.
   */
  nickname?: string;
  /** How this Grok account is actually signed in — shown on the card as the first thing you need. */
  loginMethod?: GrokLoginMethod;
  /** Phone used for login / 2FA. Optional; empty on older rows. */
  phone?: string;
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
