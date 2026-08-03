export type AnnouncementPriority = "normal" | "important" | "urgent";

export interface Announcement {
  id: string;
  workspaceId: string;
  title: string;
  body: string;
  authorUid: string;
  authorName: string;
  authorPhotoURL?: string | null;
  priority: AnnouncementPriority;
  pinned: boolean;
  isArchived?: boolean;
  createdAt: number;
  updatedAt: number;
}
