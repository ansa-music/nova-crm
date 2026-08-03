import { useMemo, useState } from "react";
import { MessageCircle, Search } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useAuth } from "@/hooks/useAuth";
import { usePrivateChat } from "@/hooks/usePrivateChat";
import { paths } from "@/firebase/firestore";
import { deleteChatMessage, editChatMessage, sendChatMessage } from "@/services/chatService";
import { displayNameOf } from "@/utils/displayName";
import { getPresenceStatus, PRESENCE_DOT_COLOR, PRESENCE_LABEL } from "@/utils/presence";
import { cn } from "@/utils/cn";
import type { ChatMessage } from "@/types";

export default function MessagesPage() {
  const { activeWorkspaceId, members } = useWorkspace();
  const { profile } = useAuth();
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const otherMembers = useMemo(
    () => members.filter((m) => m.status === "active" && m.uid !== profile?.uid),
    [members, profile?.uid]
  );
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return otherMembers;
    return otherMembers.filter((m) => displayNameOf(m).toLowerCase().includes(q) || m.email.toLowerCase().includes(q));
  }, [otherMembers, search]);

  const { messages } = usePrivateChat(activeWorkspaceId, profile?.uid ?? null, selectedUid);
  const selectedMember = otherMembers.find((m) => m.uid === selectedUid) ?? null;

  if (!activeWorkspaceId || !profile) return null;

  const chatId = selectedUid ? [profile.uid, selectedUid].sort().join("_") : null;
  const chatRef = chatId ? paths.privateChatMessages(activeWorkspaceId, chatId) : null;

  async function handleSend(text: string, replyTo: ChatMessage | null) {
    if (!chatRef) return;
    await sendChatMessage(chatRef, {
      authorUid: profile!.uid,
      authorName: profile!.nickname || profile!.name,
      authorPhotoURL: profile!.photoURL,
      text,
      replyTo,
    });
  }

  return (
    <div className="flex h-full">
      <div className="flex w-64 shrink-0 flex-col border-r border-border">
        <div className="border-b border-border p-3">
          <h1 className="mb-2 text-sm font-semibold">Личные сообщения</h1>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск..." className="h-8 pl-8 text-sm" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {filtered.map((m) => (
            <button
              key={m.uid}
              onClick={() => setSelectedUid(m.uid)}
              className={cn(
                "flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-accent/40",
                selectedUid === m.uid && "bg-accent/60"
              )}
            >
              <div className="relative shrink-0">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={m.photoURL ?? undefined} />
                  <AvatarFallback>{displayNameOf(m)[0]?.toUpperCase()}</AvatarFallback>
                </Avatar>
                <span
                  className={cn(
                    "absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-card",
                    PRESENCE_DOT_COLOR[getPresenceStatus(m.lastActiveAt)]
                  )}
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{displayNameOf(m)}</p>
                <p className="truncate text-xs text-muted-foreground">{m.email}</p>
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="p-4 text-center text-xs text-muted-foreground">Никого не найдено</p>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {selectedMember ? (
          <div className="flex h-full flex-col">
            <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
              <Avatar className="h-8 w-8">
                <AvatarImage src={selectedMember.photoURL ?? undefined} />
                <AvatarFallback>{displayNameOf(selectedMember)[0]?.toUpperCase()}</AvatarFallback>
              </Avatar>
              <div>
                <p className="text-sm font-medium leading-tight">{displayNameOf(selectedMember)}</p>
                <p className="text-xs leading-tight text-muted-foreground">
                  {PRESENCE_LABEL[getPresenceStatus(selectedMember.lastActiveAt)]}
                </p>
              </div>
            </div>
            <div className="flex-1 overflow-hidden">
              <ChatPanel
                messages={messages}
                currentUid={profile.uid}
                onSend={handleSend}
                onEdit={async (id, text) => {
                  if (chatRef) await editChatMessage(chatRef, id, text);
                }}
                onDelete={async (id) => {
                  if (chatRef) await deleteChatMessage(chatRef, id);
                }}
                emptyMessage={`Напишите первое сообщение — ${displayNameOf(selectedMember)}`}
              />
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <MessageCircle className="h-8 w-8" />
            <p className="text-sm">Выберите собеседника слева</p>
          </div>
        )}
      </div>
    </div>
  );
}
