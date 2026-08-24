export type ColumnType = "text" | "number" | "currency" | "status" | "responsible" | "custom" | "date" | "email" | "phone" | "url";

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
  /**
   * Per-column option list — only meaningful for type "status". Set once at
   * column creation and editable via the type-change flow.
   * Columns of type "responsible" do NOT use this: their options come from
   * the single, workspace-wide `Workspace.responsibleOptions` list instead
   * (managed by the Owner in Настройки → Workspace), so every "Ответственный"
   * column on the site always shows the same shared, site-wide list. See
   * `src/utils/columnOptions.ts`.
   */
  statusOptions?: StatusOption[];
  /**
   * Only meaningful for type "custom" — which of the workspace's
   * Owner-defined custom fields (`Workspace.customFields`) this column
   * shows. Same shared-list pattern as "responsible": the options live on
   * the workspace, not the column.
   */
  customFieldId?: string;
  /** When true, the column stays in schema but is hidden in the table. */
  hidden?: boolean;
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
  /**
   * Which tab opens by default when someone navigates to this page —
   * a subpage id, or undefined/null for "Основная" (the page's own main
   * table). Set from the tab bar itself ("Сделать открываемой по
   * умолчанию") by whoever can manage the page.
   */
  defaultSubPageId?: string | null;
  /**
   * Personal monthly revenue target for whoever is responsible for this
   * page — purely a personal-motivation number shown as a progress bar on
   * their own Dashboard landing, editable by them or the Owner. Not used
   * anywhere else (grouping, filtering, aggregates).
   */
  monthlyGoal?: number;
  /**
   * Per-page accent color override (same HSL-triplet convention as the
   * site-wide Workspace.accentColor) — scoped ONLY to this page's own
   * view, so a manager can make "their" page feel distinct without
   * touching the site-wide accent everyone else sees. Settable by the
   * page's responsible person or the Owner.
   */
  accentColor?: string;
  /**
   * Optional dashboard cover photo for this desk (not a row attachment).
   * Stored in Supabase `row-files` under `{workspaceId}/covers/{pageId}/…`.
   */
  coverUrl?: string;
  coverPath?: string;
  columns: PageColumn[];
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  isDashboard?: boolean;
}

export interface RowAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  path: string;
  publicUrl: string;
  createdAt: number;
}

export interface PageRow {
  id: string;
  pageId: string;
  cells: Record<string, string | number | null>;
  /** Optional file list. Never stored inside cells. */
  attachments?: RowAttachment[];
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
