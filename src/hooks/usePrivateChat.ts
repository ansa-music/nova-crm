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
    // Clear immediately on every chatId change, not just when it goes away
    // — otherwise switching straight from one conversation to another
    // (ChatPanel is keyed by chatId in MessagesPage, but that key change
    // doesn't retroactively un-render what was already painted) leaves the
    // PREVIOUS peer's messages on screen under the new peer's header until
    // the new onSnapshot delivers, which is a real network round trip for
    // any conversation not already cached.
    setMessages([]);
    if (!workspaceId || !chatId) return;
    return subscribeToChat(paths.privateChatMessages(workspaceId, chatId), setMessages, (error) =>
      console.error("subscribeToChat(privateChat) denied:", error.code, error.message)
    );
  }, [workspaceId, chatId]);

  return { messages, chatId };
}
