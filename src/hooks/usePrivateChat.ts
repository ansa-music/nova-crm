import { useEffect, useRef, useState } from "react";
import { subscribeToRecentChat } from "@/services/chatService";
import { CHAT_PAGE_STEP, CHAT_PAGE_WINDOW } from "@/hooks/useWorkspaceChat";
import type { ChatMessage } from "@/types";

/** Deterministic chat id for a pair of uids — same regardless of who opens the chat first. */
export function privateChatId(uidA: string, uidB: string): string {
  return [uidA, uidB].sort().join("_");
}

export function usePrivateChat(workspaceId: string | null, myUid: string | null, otherUid: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasEarlier, setHasEarlier] = useState(false);
  const [limit, setLimit] = useState(CHAT_PAGE_WINDOW);
  const chatId = myUid && otherUid ? privateChatId(myUid, otherUid) : null;
  // Окно сбрасываем и экран чистим только при смене переписки, а не когда
  // «Показать ранние» расширило окно: иначе переписка мигала пустой.
  const shownChatRef = useRef<string | null>(null);

  useEffect(() => {
    setLimit(CHAT_PAGE_WINDOW);
  }, [chatId]);

  useEffect(() => {
    // Clear immediately on every chatId change, not just when it goes away
    // — otherwise switching straight from one conversation to another
    // (ChatPanel is keyed by chatId in MessagesPage, but that key change
    // doesn't retroactively un-render what was already painted) leaves the
    // PREVIOUS peer's messages on screen under the new peer's header until
    // the new onSnapshot delivers, which is a real network round trip for
    // any conversation not already cached.
    if (shownChatRef.current !== chatId) {
      shownChatRef.current = chatId;
      setMessages([]);
      setHasEarlier(false);
    }
    if (!workspaceId || !chatId || !otherUid) return;
    const onError = (error: { code: string; message: string }) =>
      console.error("subscribeToChat(privateChat) denied:", error.code, error.message);
    // Сразу — последние сообщения, ранние — порциями по «Показать ранние».
    return subscribeToRecentChat(
      { workspaceId, kind: "dm", chatId, peerUid: otherUid },
      limit,
      (items, more) => {
        setMessages(items);
        setHasEarlier(more);
      },
      onError
    );
  }, [workspaceId, chatId, limit]);

  return { messages, chatId, hasEarlier, loadEarlier: () => setLimit((n) => n + CHAT_PAGE_STEP) };
}
