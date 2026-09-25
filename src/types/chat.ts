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

/**
 * Нить чата (26.09.2026): общий чат workspace, чат стола, комментарии к
 * строке или личка. Один тип на Firestore и Supabase — где нить живёт,
 * решает chatService по документу workspace.
 */
export type ChatThread =
  | { workspaceId: string; kind: "ws" }
  | { workspaceId: string; kind: "page"; pageId: string }
  | { workspaceId: string; kind: "row"; pageId: string; rowId: string }
  | { workspaceId: string; kind: "dm"; chatId: string; peerUid: string };
