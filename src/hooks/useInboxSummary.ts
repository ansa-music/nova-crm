import { useEffect, useMemo, useState } from "react";
import { paths } from "@/firebase/firestore";
import { fetchChat } from "@/services/chatService";
import { fetchMyConversations, fetchReadMarkers } from "@/services/inboxService";
import { usePolledData } from "@/hooks/usePolledData";
import { INBOX_CHANGED_EVENT } from "@/utils/inboxEvents";
import type { ChatMessage, PrivateChatMeta } from "@/types";

export function useInboxSummary(
  workspaceId: string | null,
  uid: string | null,
  opts: { enabled?: boolean; includeWorkspaceChat?: boolean } = {}
) {
  const enabled = opts.enabled !== false;
  const includeWorkspaceChat = opts.includeWorkspaceChat === true;
  const active = Boolean(enabled && workspaceId && uid);
  const [optimisticReads, setOptimisticReads] = useState<Record<string, number>>({});

  const { data, reload } = usePolledData(
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

  useEffect(() => {
    setOptimisticReads({});
  }, [workspaceId, uid]);

  useEffect(() => {
    function onChanged() {
      void reload();
    }
    window.addEventListener(INBOX_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(INBOX_CHANGED_EVENT, onChanged);
  }, [reload]);

  const { workspaceMessages, conversations, readMarkers } = data;

  const mergedReads = useMemo(
    () => ({ ...readMarkers, ...optimisticReads }),
    [readMarkers, optimisticReads]
  );

  const workspaceChatUnread = useMemo(() => {
    const lastRead = mergedReads["workspaceChat"] ?? 0;
    return workspaceMessages.filter((m) => m.authorUid !== uid && m.createdAt > lastRead && !m.deleted).length;
  }, [workspaceMessages, mergedReads, uid]);

  const conversationsWithUnread = useMemo(
    () =>
      conversations.map((c) => {
        const lastRead = mergedReads[`private:${c.id}`] ?? 0;
        const unread = c.lastMessageFromUid !== uid && c.lastMessageAt > lastRead;
        return { ...c, unread };
      }),
    [conversations, mergedReads, uid]
  );

  const privateUnreadTotal = conversationsWithUnread.filter((c) => c.unread).length;

  function markReadLocal(context: string) {
    setOptimisticReads((prev) => ({ ...prev, [context]: Date.now() }));
  }

  return {
    workspaceChatUnread,
    conversations: conversationsWithUnread,
    privateUnreadTotal,
    reload,
    markReadLocal,
  };
}
