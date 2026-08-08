export type ColumnType = "text" | "number" | "currency" | "status" | "date" | "email" | "phone";

export interface StatusOption {
  value: string;
  label: string;
  color: string; // hex or hsl token used for the badge
}

export interface PageColumn {
  id: string;
  key: string;
  label: string;
  type: ColumnType;
  width: number;
  order: number;
  statusOptions?: StatusOption[];
}

export type PageIconName =
  | "Users"
  | "Briefcase"
  | "Wallet"
  | "UserCog"
  | "LayoutGrid"
  | "Building2"
  | "Target"
  | "ClipboardList"
  | "Rocket"
  | "Star";

export interface WorkspacePage {
  id: string;
  workspaceId: string;
  name: string;
  icon: PageIconName;
  color: string;
  order: number;
  /**
   * Explicit allow-list of member uids who may see/open this page. The
   * workspace Owner always has access regardless of this list (enforced in
   * both client permission checks and Firestore rules) — everyone else,
   * including Admins, sees a page only if their uid is listed here.
   */
  allowedUsers: string[];
  /**
   * Subset of `allowedUsers` who may also EDIT the page's data (not just
   * view it). Being in `allowedUsers` alone now only grants read access —
   * edit rights are a separate, explicit grant on top of that, managed by
   * the Owner or this page's responsible person. Owner and the responsible
   * person can always edit regardless of this list.
   */
  editableUsers?: string[];
  /**
   * The one member (besides Owner) responsible for this page. Only the
   * Owner may assign/change who this is (via EditPageDialog). The
   * responsible person — and only them, besides the Owner — may then flip
   * `hiddenByResponsible` themselves, controlling whether everyone else in
   * `allowedUsers` can currently see the page. Owner and the responsible
   * person can always see it regardless of this flag.
   */
  responsibleUserId?: string | null;
  /**
   * When true, the page is hidden from everyone except the Owner and
   * `responsibleUserId`, even if their uid is in `allowedUsers`. Toggled
   * exclusively by the responsible person, not the Owner.
   */
  hiddenByResponsible?: boolean;
  /** Reserved for a future public/private page toggle. Not yet enforced anywhere — always treat as "public" until wired up. */
  visibility?: "public" | "private";
  /** Uids explicitly allowed into this page's Personal Space (Reports/Finance/Notes), beyond the Owner and responsibleUserId who always have it. */
  personalZoneAllowedUsers?: string[];
  columns: PageColumn[];
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  isDashboard?: boolean;
}

export interface PageRow {
  id: string;
  pageId: string;
  cells: Record<string, string | number | null>;
  order: number;
  height?: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * An independent inner tab inside a WorkspacePage — e.g. "Финка" can have
 * subpages "Январь", "Февраль", etc. Purely additive to the existing model:
 * the page's own original table/rows/columns are untouched and keep working
 * exactly as before; subpages are extra, optional, nested tables under it.
 * Access follows the parent page's allowedUsers — there's no separate
 * per-subpage permission list.
 */
export interface SubPage {
  id: string;
  pageId: string;
  workspaceId: string;
  name: string;
  color: string;
  icon: PageIconName;
  order: number;
  isArchived?: boolean;
  /**
   * When set, this subpage is a Personal Space monthly report — NOT an
   * ordinary shared subpage. It must never be visible to a regular page
   * viewer just because they can see the parent page; see
   * `canAccessSubPage` in firestore.rules and the personalOwnerUid /
   * personalAllowedUsers checks there.
   */
  personalOwnerUid?: string;
  personalAllowedUsers?: string[];
  columns: PageColumn[];
  createdAt: number;
  updatedAt: number;
  createdBy: string;
}
