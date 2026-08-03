/** Denormalized summary doc per private chat — lets the inbox list conversations without discovering chatIds another way. */
export interface PrivateChatMeta {
  id: string;
  participants: [string, string];
  lastMessageText: string;
  lastMessageAt: number;
  lastMessageFromUid: string;
  lastMessageFromName: string;
}

/** "workspaceChat" or "private:<chatId>" — tracks when this user last read that conversation. */
export interface ReadMarker {
  id: string;
  uid: string;
  context: string;
  lastReadAt: number;
}
