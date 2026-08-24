export type ViewRequestStatus = "pending" | "approved" | "denied";

export interface ViewRequest {
  id: string;
  workspaceId: string;
  pageId: string;
  pageName: string;
  fromUid: string;
  fromName: string;
  toUid: string;
  status: ViewRequestStatus;
  createdAt: number;
  updatedAt: number;
}
