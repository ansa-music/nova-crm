export interface ChatMessage {
  id: string;
  authorUid: string;
  authorName: string;
  authorPhotoURL?: string | null;
  text: string;
  createdAt: number;
  editedAt?: number | null;
  deleted?: boolean;
  replyToId?: string | null;
  replyToAuthorName?: string | null;
  replyToText?: string | null;
}
