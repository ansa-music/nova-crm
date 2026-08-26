import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { CheckCheck, MessageCircle, Search, UserPlus } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useAuth } from "@/hooks/useAuth";
import { usePrivateChat } from "@/hooks/usePrivateChat";
import { useInboxSummary } from "@/hooks/useInboxSummary";
import { paths } from "@/firebase/firestore";
import { deleteChatMessage, editChatMessage, sendChatMessage } from "@/services/chatService";
import { upsertPrivateChatMeta, markPrivateConversationRead } from "@/services/inboxService";
import { displayNameOf } from "@/utils/displayName";
import { getPresenceStatus, PRESENCE_DOT_COLOR, PRESENCE_LABEL } from "@/utils/presence";
import { formatMessageWrittenAt } from "@/utils/date";
import { cn } from "@/utils/cn";
import type { ChatMessage } from "@/types";

export default function MessagesPage() {
  const { peerUid } = useParams<{ peerUid: string }>();
  const navigate = useNavigate();
  const { activeWorkspaceId, members } = useWorkspace();
  const { profile } = useAuth();
  const [search, setSearch] = useState("");
  const { conversations, markReadLocal } = useInboxSummary(activeWorkspaceId, profile?.uid ?? null);

  const selectedUid = peerUid && profile && peerUid !== profile.uid ? peerUid : null;

  const otherMembers = useMemo(
    () => members.filter((m) => m.status === "active" && m.uid !== profile?.uid),
    [members, profile?.uid]
  );
  const memberByUid = useMemo(() => new Map(members.map((m) => [m.uid, m])), [members]);

  const filteredConversations = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations
      .map((c) => {
        const otherUid = c.participants.find((p) => p !== profile?.uid) ?? c.participants[0];
        return { ...c, otherUid, otherMember: memberByUid.get(otherUid) };
      })
      .filter((c) => !q || (c.otherMember && displayNameOf(c.otherMember).toLowerCase().includes(q)));
  }, [conversations, search, profile?.uid, memberByUid]);

  const conversationUids = new Set(conversations.map((c) => c.participants.find((p) => p !== profile?.uid)));
  const filteredNewContacts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return otherMembers.filter(
      (m) => !conversationUids.has(m.uid) && (!q || displayNameOf(m).toLowerCase().includes(q))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otherMembers, search, conversations]);

  const { messages, chatId } = usePrivateChat(activeWorkspaceId, profile?.uid ?? null, selectedUid);
  const selectedMember = selectedUid ? (memberByUid.get(selectedUid) ?? null) : null;
  const openMeta = chatId ? conversations.find((c) => c.id === chatId) : undefined;
  const threadUnread = Boolean(openMeta?.unread);

  function openThread(uid: string) {
    navigate(`/messages/${uid}`);
  }

  async function markThreadRead(otherUid: string, id: string) {
    if (!activeWorkspaceId || !profile?.uid) return;
    markReadLocal(`private:${id}`);
    await markPrivateConversationRead(activeWorkspaceId, profile.uid, otherUid, id);
  }

  // Auto-mark on open using existing readMarkers. Button still shows while unread.
  useEffect(() => {
    if (!activeWorkspaceId || !profile?.uid || !selectedUid || !chatId) return;
    markReadLocal(`private:${chatId}`);
    void markPrivateConversationRead(activeWorkspaceId, profile.uid, selectedUid, chatId);
    // markReadLocal is recreated each render — listing it loops the write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId, profile?.uid, selectedUid, chatId, messages.length]);

  if (!activeWorkspaceId || !profile) return null;

  const workspaceId = activeWorkspaceId;
  const me = profile;
  const chatRef = chatId ? paths.privateChatMessages(workspaceId, chatId) : null;

  async function handleSend(text: string, replyTo: ChatMessage | null, _mentioned: string[]) {
    if (!chatRef || !chatId || !selectedUid) return;
    await sendChatMessage(chatRef, {
      authorUid: me.uid,
      authorName: me.nickname || me.name,
      authorPhotoURL: me.photoURL,
      text,
      replyTo,
    });
    await upsertPrivateChatMeta(
      workspaceId,
      chatId,
      [me.uid, selectedUid].sort() as [string, string],
      text,
      me.uid,
      me.nickname || me.name
    );
  }

  return (
    <div className="flex h-full">
      <div className="flex w-72 shrink-0 flex-col border-r border-border">
        <div className="border-b border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <h1 className="text-sm font-semibold">Личные сообщения</h1>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" title="Написать новому">
                  <UserPlus className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-64 overflow-y-auto">
                {otherMembers.map((m) => (
                  <DropdownMenuItem key={m.uid} onClick={() => openThread(m.uid)}>
                    {displayNameOf(m)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск..." className="h-8 pl-8 text-sm" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {filteredConversations.map((c) => {
            const name = c.otherMember ? displayNameOf(c.otherMember) : c.otherUid;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => openThread(c.otherUid)}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-accent/40",
                  selectedUid === c.otherUid && "bg-accent/60"
                )}
              >
                <div className="relative shrink-0">
                  <Avatar className="h-9 w-9">
                    <AvatarImage src={c.otherMember?.photoURL ?? undefined} />
                    <AvatarFallback>{name[0]?.toUpperCase()}</AvatarFallback>
                  </Avatar>
                  {c.otherMember && (
                    <span
                      className={cn(
                        "absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-card",
                        PRESENCE_DOT_COLOR[getPresenceStatus(c.otherMember.lastActiveAt)]
                      )}
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <p className={cn("truncate text-sm", c.unread ? "font-semibold" : "font-medium")}>{name}</p>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {formatMessageWrittenAt(c.lastMessageAt, { compact: true })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-1">
                    <p className={cn("truncate text-xs", c.unread ? "font-medium text-foreground" : "text-muted-foreground")}>
                      {c.lastMessageFromUid === profile.uid ? "Вы: " : ""}
                      {c.lastMessageText}
                    </p>
                    {c.unread && (
                      <span
                        role="button"
                        title="Прочитано"
                        className="shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary-foreground"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void markThreadRead(c.otherUid, c.id);
                        }}
                      >
                        Прочитано
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}

          {filteredNewContacts.length > 0 && (
            <>
              <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Начать переписку
              </p>
              {filteredNewContacts.map((m) => (
                <button
                  key={m.uid}
                  type="button"
                  onClick={() => openThread(m.uid)}
                  className={cn(
                    "flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-accent/40",
                    selectedUid === m.uid && "bg-accent/60"
                  )}
                >
                  <Avatar className="h-9 w-9 shrink-0">
                    <AvatarImage src={m.photoURL ?? undefined} />
                    <AvatarFallback>{displayNameOf(m)[0]?.toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{displayNameOf(m)}</p>
                    <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                  </div>
                </button>
              ))}
            </>
          )}

          {filteredConversations.length === 0 && filteredNewContacts.length === 0 && (
            <p className="p-4 text-center text-xs text-muted-foreground">Никого не найдено</p>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {selectedUid ? (
          <div className="flex h-full flex-col">
            <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
              <Avatar className="h-8 w-8">
                <AvatarImage src={selectedMember?.photoURL ?? undefined} />
                <AvatarFallback>
                  {(selectedMember ? displayNameOf(selectedMember) : selectedUid)[0]?.toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-tight">
                  {selectedMember ? displayNameOf(selectedMember) : "Диалог"}
                </p>
                <p className="text-xs leading-tight text-muted-foreground">
                  {selectedMember ? PRESENCE_LABEL[getPresenceStatus(selectedMember.lastActiveAt)] : "Открыт по ссылке"}
                </p>
              </div>
              {threadUnread && chatId && (
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-9 shrink-0 gap-1.5"
                  onClick={() => void markThreadRead(selectedUid, chatId)}
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  Прочитано
                </Button>
              )}
            </div>
            <div className="flex-1 overflow-hidden">
              <ChatPanel
                key={chatId ?? selectedUid}
                messages={messages}
                currentUid={profile.uid}
                onSend={handleSend}
                onEdit={async (id, text) => {
                  if (chatRef) await editChatMessage(chatRef, id, text);
                }}
                onDelete={async (id) => {
                  if (chatRef) await deleteChatMessage(chatRef, id);
                }}
                emptyMessage={
                  selectedMember
                    ? `Напишите первое сообщение — ${displayNameOf(selectedMember)}`
                    : "Напишите первое сообщение"
                }
              />
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <MessageCircle className="h-8 w-8" />
            <p className="text-sm">Выберите переписку слева</p>
          </div>
        )}
      </div>
    </div>
  );
}
