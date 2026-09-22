import { useEffect, useState } from "react";
import { paths } from "@/firebase/firestore";
import { subscribeToChat, subscribeToRecentChat } from "@/services/chatService";
import { CHAT_PAGE_WINDOW } from "@/hooks/useWorkspaceChat";
import type { ChatMessage } from "@/types";

/** Deterministic chat id for a pair of uids — same regardless of who opens the chat first. */
export function privateChatId(uidA: string, uidB: string): string {
  return [uidA, uidB].sort().join("_");
}

export function usePrivateChat(workspaceId: string | null, myUid: string | null, otherUid: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasEarlier, setHasEarlier] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const chatId = myUid && otherUid ? privateChatId(myUid, otherUid) : null;

  useEffect(() => {
    setShowAll(false);
  }, [chatId]);

  useEffect(() => {
    // Clear immediately on every chatId change, not just when it goes away
    // — otherwise switching straight from one conversation to another
    // (ChatPanel is keyed by chatId in MessagesPage, but that key change
    // doesn't retroactively un-render what was already painted) leaves the
    // PREVIOUS peer's messages on screen under the new peer's header until
    // the new onSnapshot delivers, which is a real network round trip for
    // any conversation not already cached.
    setMessages([]);
    setHasEarlier(false);
    if (!workspaceId || !chatId) return;
    const onError = (error: { code: string; message: string }) =>
      console.error("subscribeToChat(privateChat) denied:", error.code, error.message);
    // Сразу — последние сообщения, вся переписка — по «Показать ранние».
    if (showAll) return subscribeToChat(paths.privateChatMessages(workspaceId, chatId), setMessages, onError);
    return subscribeToRecentChat(
      paths.privateChatMessages(workspaceId, chatId),
      CHAT_PAGE_WINDOW,
      (items, more) => {
        setMessages(items);
        setHasEarlier(more);
      },
      onError
    );
  }, [workspaceId, chatId, showAll]);

  return { messages, chatId, hasEarlier, loadEarlier: () => setShowAll(true) };
}
