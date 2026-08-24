import { useMemo } from "react";
import { paths } from "@/firebase/firestore";
import { fetchChat } from "@/services/chatService";
import { fetchMyConversations, fetchReadMarkers } from "@/services/inboxService";
import { usePolledData } from "@/hooks/usePolledData";
import type { ChatMessage, PrivateChatMeta } from "@/types";

export function useInboxSummary(
  workspaceId: string | null,
  uid: string | null,
  opts: { enabled?: boolean; includeWorkspaceChat?: boolean } = {}
) {
  const enabled = opts.enabled !== false;
  const includeWorkspaceChat = opts.includeWorkspaceChat === true;
  const active = Boolean(enabled && workspaceId && uid);

  const { data } = usePolledData(
    active,
    async () => {
      const ws = workspaceId as string;
      const user = uid as string;
      const [workspaceMessages, conversations, readMarkers] = await Promise.all([
        includeWorkspaceChat ? fetchChat(paths.workspaceChat(ws)) : Promise.resolve([] as ChatMessage[]),
        fetchMyConversations(ws, user),
        fetchReadMarkers(ws, user),
      ]);
      return { workspaceMessages, conversations, readMarkers };
    },
    {
      workspaceMessages: [] as ChatMessage[],
      conversations: [] as PrivateChatMeta[],
      readMarkers: {} as Record<string, number>,
    },
    [workspaceId, uid, includeWorkspaceChat]
  );

  const { workspaceMessages, conversations, readMarkers } = data;

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
