import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { paths } from "@/firebase/firestore";
import { subscribeToRecentThread, sendChatMessage, editChatMessage, deleteChatMessage } from "@/services/chatService";
import { CHAT_PAGE_STEP, CHAT_PAGE_WINDOW } from "@/hooks/useWorkspaceChat";
import { notifyMentions } from "@/services/notificationService";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { displayNameOf, myDisplayName } from "@/utils/displayName";
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
  const [hasEarlier, setHasEarlier] = useState(false);
  // Окно последних сообщений, как в общем чате: вся история стола читалась
  // при каждом открытии панели. «Показать ранние» расширяет окно порцией.
  // Размер окна привязан к нити: у другого стола — снова 60, без лишней
  // подписки на прежнее расширенное окно.
  const threadKey = `${workspaceId}/${pageId}`;
  const [expanded, setExpanded] = useState({ key: threadKey, size: CHAT_PAGE_WINDOW });
  const windowSize = expanded.key === threadKey ? expanded.size : CHAT_PAGE_WINDOW;
  const chatRef = paths.pageChat(workspaceId, pageId);
  const mentionableUsers = useMemo(
    () => members.filter((m) => m.status === "active").map((m) => ({ uid: m.uid, name: displayNameOf(m) })),
    [members]
  );

  useEffect(() => {
    // Clear on every pageId change too — DynamicTablePage is mounted once
    // at the /page/:pageId route with no key, so React Router reuses this
    // same component instance across desk navigations. If the chat sheet
    // is open while the user switches desks, `open` stays true and only
    // `pageId` changes, which otherwise left the PREVIOUS desk's chat
    // messages on screen under the new desk's title.
    setMessages([]);
    setHasEarlier(false);
  }, [open, workspaceId, pageId]);

  useEffect(() => {
    if (!open) return;
    return subscribeToRecentThread(
      chatRef,
      windowSize,
      (items, more) => {
        setMessages(items);
        setHasEarlier(more);
      },
      (error) => console.error("subscribeToChat(pageChat) denied:", error.code, error.message)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspaceId, pageId, windowSize]);

  if (!profile) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex h-full w-full max-w-md flex-col p-0">
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
                authorName: myDisplayName(profile, members),
                authorPhotoURL: profile.photoURL,
                text,
                replyTo,
              });
              await notifyMentions(workspaceId, profile.uid, myDisplayName(profile, members), mentionedUids, text, `/page/${pageId}`);
            }}
            onEdit={(id, text) => editChatMessage(chatRef, id, text)}
            onDelete={(id) => deleteChatMessage(chatRef, id)}
            emptyMessage="Обсудите эту страницу прямо здесь"
            mentionableUsers={mentionableUsers}
            hasEarlier={hasEarlier}
            onLoadEarlier={() => setExpanded({ key: threadKey, size: windowSize + CHAT_PAGE_STEP })}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
