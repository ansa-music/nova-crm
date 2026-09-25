import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { subscribeToRecentThread, sendChatMessage, editChatMessage, deleteChatMessage } from "@/services/chatService";
import { CHAT_PAGE_STEP, CHAT_PAGE_WINDOW } from "@/hooks/useWorkspaceChat";
import { notifyMentions } from "@/services/notificationService";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { displayNameOf, myDisplayName } from "@/utils/displayName";
import type { ChatMessage, ChatThread } from "@/types";

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
  const [hasEarlier, setHasEarlier] = useState(false);
  // Окно последних комментариев, как в общем чате: вся нить читалась при
  // каждом открытии. «Показать ранние» расширяет окно порцией.
  // Размер окна привязан к нити: у другой строки — снова 60, без лишней
  // подписки на прежнее расширенное окно.
  const threadKey = `${workspaceId}/${pageId}/${rowId ?? ""}`;
  const [expanded, setExpanded] = useState({ key: threadKey, size: CHAT_PAGE_WINDOW });
  const windowSize = expanded.key === threadKey ? expanded.size : CHAT_PAGE_WINDOW;
  const mentionableUsers = useMemo(
    () => members.filter((m) => m.status === "active").map((m) => ({ uid: m.uid, name: displayNameOf(m) })),
    [members]
  );

  useEffect(() => {
    // Clear on every rowId change, not just when the sheet closes — the
    // context menu can pick a DIFFERENT row's "Комментарии" while this
    // sheet is already open for another row (it's always mounted, `open`/
    // `rowId` just toggle), which otherwise briefly shows the previous
    // row's comments under the new row's title.
    setMessages([]);
    setHasEarlier(false);
  }, [open, workspaceId, pageId, rowId]);

  useEffect(() => {
    if (!open || !rowId) return;
    return subscribeToRecentThread(
      { workspaceId, kind: "row", pageId, rowId },
      windowSize,
      (items, more) => {
        setMessages(items);
        setHasEarlier(more);
      },
      (error) => console.error("subscribeToChat(rowComments) denied:", error.code, error.message)
    );
  }, [open, workspaceId, pageId, rowId, windowSize]);

  if (!profile || !rowId) return null;
  const ref: ChatThread = { workspaceId, kind: "row", pageId, rowId };

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
                authorName: myDisplayName(profile, members),
                authorPhotoURL: profile.photoURL,
                text,
                replyTo,
              });
              await notifyMentions(
                workspaceId,
                profile.uid,
                myDisplayName(profile, members),
                mentionedUids,
                text,
                `/page/${pageId}`
              );
            }}
            onEdit={(id, text) => editChatMessage(ref, id, text)}
            onDelete={(id) => deleteChatMessage(ref, id)}
            emptyMessage="Обсудите эту строку с коллегами"
            mentionableUsers={mentionableUsers}
            hasEarlier={hasEarlier}
            onLoadEarlier={() => setExpanded({ key: threadKey, size: windowSize + CHAT_PAGE_STEP })}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
