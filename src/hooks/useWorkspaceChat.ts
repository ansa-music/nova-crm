import { useEffect, useState } from "react";
import { paths } from "@/firebase/firestore";
import { subscribeToChat, subscribeToRecentChat } from "@/services/chatService";
import type { ChatMessage } from "@/types";

/** Сколько последних сообщений грузит чат сразу — остальное по «Показать ранние». */
export const CHAT_PAGE_WINDOW = 300;

/**
 * Общий чат: сразу — последние 300 сообщений, вся история — только по
 * кнопке «Показать ранние» (квота Spark: весь чат при каждом открытии
 * читал каждое сообщение за всё время).
 */
export function useWorkspaceChat(workspaceId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasEarlier, setHasEarlier] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    setShowAll(false);
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) {
      setMessages([]);
      setHasEarlier(false);
      return;
    }
    const onError = (error: { code: string; message: string }) =>
      console.error("subscribeToChat(workspaceChat) denied:", error.code, error.message);
    if (showAll) {
      setHasEarlier(false);
      return subscribeToChat(paths.workspaceChat(workspaceId), setMessages, onError);
    }
    return subscribeToRecentChat(
      paths.workspaceChat(workspaceId),
      CHAT_PAGE_WINDOW,
      (items, more) => {
        setMessages(items);
        setHasEarlier(more);
      },
      onError
    );
  }, [workspaceId, showAll]);

  return { messages, hasEarlier, loadEarlier: () => setShowAll(true) };
}
