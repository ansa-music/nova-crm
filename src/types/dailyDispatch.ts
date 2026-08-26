export interface DailyDispatch {
  id: string;
  workspaceId: string;
  pageId: string;
  checkNo: string;
  technicianName: string;
  technicianUid: string | null;
  /** Order price, KZT. 0 when not filled in. */
  amount: number;
  /** Ordered video length in minutes. Null when not filled in — distinct from 0. */
  minutes: number | null;
  /** Free text — which character(s) the order is for. */
  character: string;
  /** "ОС" — same free-text-plus-shared-list convention as a "Ответственный" column elsewhere in the app. */
  os: string;
  /** Bound technician desk. Stored on this doc only — never mutates desk rows. */
  linkedPageId: string | null;
  linkedPageName: string | null;
  dayKey: string;
  marks: Record<string, true>;
  createdAt: number;
  createdBy: string;
}
