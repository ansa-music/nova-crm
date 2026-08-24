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

interface RowCommentsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  pageId: string;
  rowId: string | null;
}

export function RowCommentsPanel({ open, onOpenChange, workspaceId, pageId, rowId }: RowCommentsPanelProps) {
  const { profile } = useAuth();
  const { members } = useWorkspace();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const mentionableUsers = useMemo(
    () => members.filter((m) => m.status === "active").map((m) => ({ uid: m.uid, name: displayNameOf(m) })),
    [members]
  );

  useEffect(() => {
    if (!open || !rowId) return;
    return subscribeToChat(paths.rowComments(workspaceId, pageId, rowId), setMessages, (error) =>
      console.error("subscribeToChat(rowComments) denied:", error.code, error.message)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspaceId, pageId, rowId]);

  if (!profile || !rowId) return null;
  const ref = paths.rowComments(workspaceId, pageId, rowId);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex h-full w-full max-w-md flex-col p-0">
        <SheetHeader className="border-b border-border p-4">
          <SheetTitle>Комментарии к строке</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-hidden">
          <ChatPanel
            messages={messages}
            currentUid={profile.uid}
            onSend={async (text, replyTo, mentionedUids) => {
              await sendChatMessage(ref, {
                authorUid: profile.uid,
                authorName: profile.nickname || profile.name,
                authorPhotoURL: profile.photoURL,
                text,
                replyTo,
              });
              await notifyMentions(workspaceId, profile.uid, profile.nickname || profile.name, mentionedUids, text);
            }}
            onEdit={(id, text) => editChatMessage(ref, id, text)}
            onDelete={(id) => deleteChatMessage(ref, id)}
            emptyMessage="Обсудите эту строку с коллегами"
            mentionableUsers={mentionableUsers}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
