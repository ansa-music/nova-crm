export interface DailyDispatch {
  id: string;
  workspaceId: string;
  pageId: string;
  checkNo: string;
  technicianName: string;
  technicianUid: string | null;
  /** Bound technician desk. Stored on this doc only — never mutates desk rows. */
  linkedPageId: string | null;
  linkedPageName: string | null;
  dayKey: string;
  marks: Record<string, true>;
  createdAt: number;
  createdBy: string;
}
