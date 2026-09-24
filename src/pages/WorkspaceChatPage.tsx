import { useEffect, useMemo } from "react";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { ChatModeSwitch } from "@/components/chat/ChatModeSwitch";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceChat } from "@/hooks/useWorkspaceChat";
import { paths } from "@/firebase/firestore";
import { deleteChatMessage, editChatMessage, sendChatMessage } from "@/services/chatService";
import { notifyMentions } from "@/services/notificationService";
import { markContextRead } from "@/services/inboxService";
import { displayNameOf } from "@/utils/displayName";
import type { ChatMessage } from "@/types";

export default function WorkspaceChatPage() {
  const { activeWorkspaceId, members } = useWorkspace();
  const { profile } = useAuth();
  const { messages, hasEarlier, loadEarlier } = useWorkspaceChat(activeWorkspaceId);

  const mentionableUsers = useMemo(
    () => members.filter((m) => m.status === "active").map((m) => ({ uid: m.uid, name: displayNameOf(m) })),
    [members]
  );

  // Время самого свежего ЧУЖОГО сообщения: отметка «прочитано» пишется, только
  // когда оно новее уже записанной (и не чаще раза в 30 с — см.
  // markContextRead). Раньше запись уходила на каждое изменение списка, в том
  // числе на собственные сообщения и догрузку ранних.
  const uid = profile?.uid;
  const latestForeignAt = useMemo(() => {
    let latest: number | null = null;
    for (const m of messages) {
      if (m.authorUid === uid || m.deleted) continue;
      if (latest === null || m.createdAt > latest) latest = m.createdAt;
    }
    return latest;
  }, [messages, uid]);

  useEffect(() => {
    if (!activeWorkspaceId || !uid) return;
    markContextRead(activeWorkspaceId, uid, "workspaceChat", { latestForeignAt }).catch((error) =>
      console.error("Не удалось отметить чат прочитанным:", error)
    );
  }, [activeWorkspaceId, uid, latestForeignAt]);

  if (!activeWorkspaceId || !profile) return null;

  const chatRef = paths.workspaceChat(activeWorkspaceId);

  async function handleSend(text: string, replyTo: ChatMessage | null, mentionedUids: string[]) {
    await sendChatMessage(chatRef, {
      authorUid: profile!.uid,
      authorName: profile!.nickname || profile!.name,
      authorPhotoURL: profile!.photoURL,
      text,
      replyTo,
    });
    await notifyMentions(activeWorkspaceId!, profile!.uid, profile!.nickname || profile!.name, mentionedUids, text);
  }

  return (
    <div className="flex h-full flex-col">
      {/* Одна страница «Чат»: сверху переключатель «Общий / Личные». */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3 sm:px-6">
        <h1 className="sr-only">Чат — общий</h1>
        <ChatModeSwitch />
        <p className="hidden truncate text-[12px] text-muted-foreground sm:block">Общий чат всей команды</p>
      </div>
      <div className="flex-1 overflow-hidden">
        <ChatPanel
          messages={messages}
          currentUid={profile.uid}
          onSend={handleSend}
          onEdit={(id, text) => editChatMessage(chatRef, id, text)}
          onDelete={(id) => deleteChatMessage(chatRef, id)}
          emptyMessage="Пока никто ничего не написал — начните обсуждение первым"
          mentionableUsers={mentionableUsers}
          hasEarlier={hasEarlier}
          onLoadEarlier={loadEarlier}
        />
      </div>
    </div>
  );
}
