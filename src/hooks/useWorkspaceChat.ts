import { useEffect, useState } from "react";
import { paths } from "@/firebase/firestore";
import { subscribeToRecentChat } from "@/services/chatService";
import type { ChatMessage } from "@/types";

/**
 * Сколько последних сообщений чат грузит сразу. Было 300: на стенде открытие
 * «Чата» стоило ~290 чтений у каждого человека (первое за ~30 минут), это
 * больше, чем весь вход в приложение. 60 — это пара экранов переписки.
 */
export const CHAT_PAGE_WINDOW = 60;
/** «Показать ранние» добавляет столько — а не всю историю разом, как раньше. */
export const CHAT_PAGE_STEP = 100;

/**
 * Общий чат: сразу — последние сообщения, ранние — порциями по кнопке
 * «Показать ранние» (квота Spark: весь чат при каждом открытии читал каждое
 * сообщение за всё время).
 */
export function useWorkspaceChat(workspaceId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasEarlier, setHasEarlier] = useState(false);
  const [limit, setLimit] = useState(CHAT_PAGE_WINDOW);

  useEffect(() => {
    setLimit(CHAT_PAGE_WINDOW);
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) {
      setMessages([]);
      setHasEarlier(false);
      return;
    }
    const onError = (error: { code: string; message: string }) =>
      console.error("subscribeToChat(workspaceChat) denied:", error.code, error.message);
    return subscribeToRecentChat(
      paths.workspaceChat(workspaceId),
      limit,
      (items, more) => {
        setMessages(items);
        setHasEarlier(more);
      },
      onError
    );
  }, [workspaceId, limit]);

  return { messages, hasEarlier, loadEarlier: () => setLimit((n) => n + CHAT_PAGE_STEP) };
}
