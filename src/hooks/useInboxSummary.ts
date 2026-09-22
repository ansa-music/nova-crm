import { useEffect, useMemo, useState } from "react";
import { paths } from "@/firebase/firestore";
import { subscribeToRecentChat } from "@/services/chatService";
import { joinSharedSubscription } from "@/utils/sharedSubscription";
import { subscribeMyConversations, subscribeReadMarkers } from "@/services/inboxService";
import { INBOX_CHANGED_EVENT } from "@/utils/inboxEvents";
import type { ChatMessage, PrivateChatMeta } from "@/types";

/** Сколько последних сообщений общего чата смотрит счётчик непрочитанных. */
const UNREAD_WINDOW = 50;

export function useInboxSummary(
  workspaceId: string | null,
  uid: string | null,
  opts: { enabled?: boolean; includeWorkspaceChat?: boolean } = {}
) {
  const enabled = opts.enabled !== false;
  const includeWorkspaceChat = opts.includeWorkspaceChat === true;
  const active = Boolean(enabled && workspaceId && uid);
  const [optimisticReads, setOptimisticReads] = useState<Record<string, number>>({});
  const [workspaceMessages, setWorkspaceMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<PrivateChatMeta[]>([]);
  const [readMarkers, setReadMarkers] = useState<Record<string, number>>({});
  // conversations/readMarkers are two independent onSnapshot subscriptions
  // with no ordering guarantee — on a cold load, conversations can deliver
  // first while readMarkers is still empty, which would make lastRead
  // default to 0 and flash an already-read conversation as unread until
  // the readMarkers snapshot catches up a moment later. Gate unread
  // computation on this instead of trusting an empty readMarkers map.
  const [readMarkersLoaded, setReadMarkersLoaded] = useState(false);

  useEffect(() => {
    setOptimisticReads({});
  }, [workspaceId, uid]);

  useEffect(() => {
    if (!active || !workspaceId || !uid) {
      setWorkspaceMessages([]);
      setConversations([]);
      setReadMarkers({});
      setReadMarkersLoaded(false);
      return;
    }
    setReadMarkersLoaded(false);
    // Общие подписки (одна на приложение) — меню снимается и ставится
    // заново при полноэкранной таблице и на телефоне, и каждая новая
    // подписка перечитывала бы всё заново (квота Spark). Для счётчика
    // непрочитанных хватает последних 50 сообщений общего чата: больше
    // значок всё равно не покажет.
    const unsubs: Array<() => void> = [];
    if (includeWorkspaceChat) {
      unsubs.push(
        joinSharedSubscription<ChatMessage[]>(
          `inbox:wschat:${workspaceId}`,
          (emit) => subscribeToRecentChat(paths.workspaceChat(workspaceId), UNREAD_WINDOW, (items) => emit(items)),
          setWorkspaceMessages
        )
      );
    } else {
      setWorkspaceMessages([]);
    }
    unsubs.push(
      joinSharedSubscription<PrivateChatMeta[]>(
        `inbox:convs:${workspaceId}:${uid}`,
        (emit) => subscribeMyConversations(workspaceId, uid, emit),
        setConversations
      )
    );
    unsubs.push(
      joinSharedSubscription<Record<string, number>>(
        `inbox:marks:${workspaceId}:${uid}`,
        (emit) => subscribeReadMarkers(workspaceId, uid, emit),
        (map) => {
          setReadMarkers(map);
          setReadMarkersLoaded(true);
        }
      )
    );
    return () => unsubs.forEach((u) => u());
  }, [active, workspaceId, uid, includeWorkspaceChat]);

  useEffect(() => {
    function onChanged() {
      /* live onSnapshot already feeds inbox; ping stays for other listeners */
    }
    window.addEventListener(INBOX_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(INBOX_CHANGED_EVENT, onChanged);
  }, []);

  const mergedReads = useMemo(
    () => ({ ...readMarkers, ...optimisticReads }),
    [readMarkers, optimisticReads]
  );

  const workspaceChatUnread = useMemo(() => {
    if (!readMarkersLoaded) return 0;
    const lastRead = mergedReads["workspaceChat"] ?? 0;
    return workspaceMessages.filter((m) => m.authorUid !== uid && m.createdAt > lastRead && !m.deleted).length;
  }, [workspaceMessages, mergedReads, uid, readMarkersLoaded]);

  const conversationsWithUnread = useMemo(
    () =>
      conversations.map((c) => {
        if (!readMarkersLoaded) return { ...c, unread: false };
        const lastRead = mergedReads[`private:${c.id}`] ?? 0;
        const unread = c.lastMessageFromUid !== uid && c.lastMessageAt > lastRead;
        return { ...c, unread };
      }),
    [conversations, mergedReads, uid, readMarkersLoaded]
  );

  const privateUnreadTotal = conversationsWithUnread.filter((c) => c.unread).length;

  function markReadLocal(context: string) {
    setOptimisticReads((prev) => ({ ...prev, [context]: Date.now() }));
  }

  return {
    workspaceChatUnread,
    conversations: conversationsWithUnread,
    privateUnreadTotal,
    reload: () => {
      /* live onSnapshot already feeds inbox */
    },
    markReadLocal,
  };
}
