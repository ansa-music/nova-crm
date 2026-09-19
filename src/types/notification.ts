export type NotificationTargetKind = "all" | "selected" | "role" | "responsible";

export interface Notification {
  id: string;
  workspaceId: string;
  targetUid: string;
  title: string;
  body: string;
  priority: "normal" | "important" | "urgent";
  fromUid: string;
  fromName: string;
  read: boolean;
  createdAt: number;
  relatedAnnouncementId?: string | null;
  pageId?: string | null;
  href?: string | null;
  kind?: "view-request" | "view-request-result" | "owner-request" | "owner-request-result" | null;
  viewRequestId?: string | null;
  /** id заявки на права Owner (совпадает с uid заявителя) — для кнопок в колокольчике. */
  ownerRequestId?: string | null;
}

