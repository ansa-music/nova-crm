import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { paths } from "@/firebase/firestore";
import { subscribeToChat, sendChatMessage, editChatMessage, deleteChatMessage } from "@/services/chatService";
import { notifyMentions } from "@/services/notificationService";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { displayNameOf } from "@/utils/displayName";
import type { ChatMessage } from "@/types";

interface PageChatPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  pageId: string;
  pageName: string;
}

export function PageChatPanel({ open, onOpenChange, workspaceId, pageId, pageName }: PageChatPanelProps) {
  const { profile } = useAuth();
  const { members } = useWorkspace();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const chatRef = paths.pageChat(workspaceId, pageId);
  const mentionableUsers = useMemo(
    () => members.filter((m) => m.status === "active").map((m) => ({ uid: m.uid, name: displayNameOf(m) })),
    [members]
  );

  useEffect(() => {
    if (!open) return;
    return subscribeToChat(chatRef, setMessages, (error) =>
      console.error("subscribeToChat(pageChat) denied:", error.code, error.message)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspaceId, pageId]);

  if (!profile) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border p-4">
          <SheetTitle>Чат страницы «{pageName}»</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-hidden">
          <ChatPanel
            messages={messages}
            currentUid={profile.uid}
            onSend={async (text, replyTo, mentionedUids) => {
              await sendChatMessage(chatRef, {
                authorUid: profile.uid,
                authorName: profile.nickname || profile.name,
                authorPhotoURL: profile.photoURL,
                text,
                replyTo,
              });
              await notifyMentions(workspaceId, profile.uid, profile.nickname || profile.name, mentionedUids, text);
            }}
            onEdit={(id, text) => editChatMessage(chatRef, id, text)}
            onDelete={(id) => deleteChatMessage(chatRef, id)}
            emptyMessage="Обсудите эту страницу прямо здесь"
            mentionableUsers={mentionableUsers}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
