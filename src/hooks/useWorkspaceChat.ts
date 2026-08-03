import { useEffect, useState } from "react";
import { paths } from "@/firebase/firestore";
import { subscribeToChat } from "@/services/chatService";
import type { ChatMessage } from "@/types";

export function useWorkspaceChat(workspaceId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    if (!workspaceId) {
      setMessages([]);
      return;
    }
    return subscribeToChat(paths.workspaceChat(workspaceId), setMessages, (error) =>
      console.error("subscribeToChat(workspaceChat) denied:", error.code, error.message)
    );
  }, [workspaceId]);

  return messages;
}
