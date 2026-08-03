import { useEffect, useMemo, useState } from "react";
import { paths } from "@/firebase/firestore";
import { subscribeToChat } from "@/services/chatService";
import { subscribeToMyConversations, subscribeToReadMarkers } from "@/services/inboxService";
import type { ChatMessage, PrivateChatMeta } from "@/types";

export function useInboxSummary(workspaceId: string | null, uid: string | null) {
  const [workspaceMessages, setWorkspaceMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<PrivateChatMeta[]>([]);
  const [readMarkers, setReadMarkers] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!workspaceId || !uid) {
      setWorkspaceMessages([]);
      setConversations([]);
      setReadMarkers({});
      return;
    }
    const unsubMessages = subscribeToChat(paths.workspaceChat(workspaceId), setWorkspaceMessages);
    const unsubConversations = subscribeToMyConversations(workspaceId, uid, setConversations);
    const unsubMarkers = subscribeToReadMarkers(workspaceId, uid, setReadMarkers);
    return () => {
      unsubMessages();
      unsubConversations();
      unsubMarkers();
    };
  }, [workspaceId, uid]);

  const workspaceChatUnread = useMemo(() => {
    const lastRead = readMarkers["workspaceChat"] ?? 0;
    return workspaceMessages.filter((m) => m.authorUid !== uid && m.createdAt > lastRead && !m.deleted).length;
  }, [workspaceMessages, readMarkers, uid]);

  const conversationsWithUnread = useMemo(
    () =>
      conversations.map((c) => {
        const lastRead = readMarkers[`private:${c.id}`] ?? 0;
        const unread = c.lastMessageFromUid !== uid && c.lastMessageAt > lastRead;
        return { ...c, unread };
      }),
    [conversations, readMarkers, uid]
  );

  const privateUnreadTotal = conversationsWithUnread.filter((c) => c.unread).length;

  return { workspaceChatUnread, conversations: conversationsWithUnread, privateUnreadTotal };
}
