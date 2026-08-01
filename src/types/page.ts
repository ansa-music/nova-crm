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
