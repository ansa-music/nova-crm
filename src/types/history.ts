export type HistoryAction = "create" | "update" | "delete" | "restore";

export interface HistoryEntry {
  id: string;
  workspaceId: string;
  pageId?: string;
  pageName?: string;
  rowId?: string;
  field?: string;
  fieldLabel?: string;
  oldValue: string | number | null;
  newValue: string | number | null;
  action: HistoryAction;
  userId: string;
  userName: string;
  timestamp: number;
}
