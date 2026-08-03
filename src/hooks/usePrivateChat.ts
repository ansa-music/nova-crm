import { useEffect, useState } from "react";
import { paths } from "@/firebase/firestore";
import { subscribeToChat } from "@/services/chatService";
import type { ChatMessage } from "@/types";

/** Deterministic chat id for a pair of uids — same regardless of who opens the chat first. */
export function privateChatId(uidA: string, uidB: string): string {
  return [uidA, uidB].sort().join("_");
}

export function usePrivateChat(workspaceId: string | null, myUid: string | null, otherUid: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const chatId = myUid && otherUid ? privateChatId(myUid, otherUid) : null;

  useEffect(() => {
    if (!workspaceId || !chatId) {
      setMessages([]);
      return;
    }
    return subscribeToChat(paths.privateChatMessages(workspaceId, chatId), setMessages, (error) =>
      console.error("subscribeToChat(privateChat) denied:", error.code, error.message)
    );
  }, [workspaceId, chatId]);

  return { messages, chatId };
}
