import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Pencil, Reply, Search, Smile, Trash2, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/utils/cn";
import { formatMessageWrittenAt } from "@/utils/date";
import type { ChatMessage } from "@/types";
import { confirmDialog } from "@/utils/appDialog";

const EMOJI = ["😀", "😂", "❤️", "👍", "👎", "🎉", "🔥", "😢", "😮", "🙏", "👏", "✅"];

export interface MentionableUser {
  uid: string;
  name: string;
}

interface ChatPanelProps {
  messages: ChatMessage[];
  currentUid: string;
  onSend: (text: string, replyTo: ChatMessage | null, mentionedUids: string[]) => Promise<void>;
  onEdit: (id: string, text: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  emptyMessage?: string;
  /** Enables @mention autocomplete + highlighting + notifying the mentioned person. */
  mentionableUsers?: MentionableUser[];
}

/**
 * One combined alternation, LONGEST name first, so "@Bob Smith" can never
 * also match a shorter "Bob" that happens to be a prefix of it — matching
 * independently per-name (as extractMentionedUids used to) would match
 * BOTH names on that text and notify the wrong person too.
 */
function buildMentionPattern(mentionableUsers: MentionableUser[]): RegExp | null {
  if (mentionableUsers.length === 0) return null;
  const names = mentionableUsers.map((u) => u.name).sort((a, b) => b.length - a.length);
  return new RegExp(`@(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "g");
}

/** Renders message text with "@Name" occurrences (matching a known mentionable user) highlighted. */
function renderTextWithMentions(text: string, mentionableUsers: MentionableUser[]) {
  const pattern = buildMentionPattern(mentionableUsers);
  if (!pattern) return text;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    parts.push(
      <span key={key++} className="rounded bg-primary/15 px-1 font-medium text-primary">
        @{match[1]}
      </span>
    );
    lastIndex = match.index + match[0].length;
  }
  parts.push(text.slice(lastIndex));
  return parts;
}

/** Extracts the uids of every mentionable user whose "@Name" appears in the text. */
function extractMentionedUids(text: string, mentionableUsers: MentionableUser[]): string[] {
  const pattern = buildMentionPattern(mentionableUsers);
  if (!pattern) return [];
  const byName = new Map(mentionableUsers.map((u) => [u.name, u.uid]));
  const uids = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const uid = byName.get(match[1]);
    if (uid) uids.add(uid);
  }
  return Array.from(uids);
}

export function ChatPanel({
  messages,
  currentUid,
  onSend,
  onEdit,
  onDelete,
  emptyMessage,
  mentionableUsers = [],
}: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // Starts true so the very first load still lands at the bottom. Updated
  // on every scroll (see the container's onScroll below), NOT computed
  // inside the messages.length effect itself — by the time that effect
  // runs, the DOM already reflects the new message, so scrollHeight
  // already includes it and can't tell "was already at the bottom" from
  // "just scrolled up to read something."
  const isNearBottomRef = useRef(true);

  useEffect(() => {
    // A new message while the user has scrolled up to read older ones
    // must NOT yank them back down to the bottom — only auto-follow when
    // they were already there, or it's their own outgoing message (they'd
    // want to see that land regardless of where they'd scrolled to).
    const last = messages[messages.length - 1];
    if (!isNearBottomRef.current && last?.authorUid !== currentUid) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  // Mention autocomplete: look at the text right before the cursor for an
  // unclosed "@word" and, if found, offer matching mentionable users.
  const mentionQuery = useMemo(() => {
    const caret = textareaRef.current?.selectionStart ?? draft.length;
    const upToCaret = draft.slice(0, caret);
    const match = upToCaret.match(/@(\w*)$/);
    return match ? match[1] : null;
  }, [draft]);

  const mentionMatches = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return mentionableUsers.filter((u) => u.name.toLowerCase().startsWith(q)).slice(0, 6);
  }, [mentionQuery, mentionableUsers]);

  function insertMention(user: MentionableUser) {
    const caret = textareaRef.current?.selectionStart ?? draft.length;
    const upToCaret = draft.slice(0, caret);
    const replaced = upToCaret.replace(/@(\w*)$/, `@${user.name} `);
    setDraft(replaced + draft.slice(caret));
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  async function handleSend() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    const wasReplying = replyTo;
    setReplyTo(null);
    try {
      await onSend(text, wasReplying, extractMentionedUids(text, mentionableUsers));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось отправить сообщение");
    }
  }

  async function handleSaveEdit(id: string) {
    const text = editValue.trim();
    if (!text) return;
    try {
      await onEdit(id, text);
      setEditingId(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось изменить сообщение");
    }
  }

  async function handleDelete(id: string) {
    if (!(await confirmDialog({ title: "Удалить сообщение?", description: "Сообщение исчезнет у всех участников чата.", destructive: true }))) return;
    try {
      await onDelete(id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось удалить сообщение");
    }
  }

  const displayedMessages = search.trim()
    ? messages.filter((m) => !m.deleted && m.text.toLowerCase().includes(search.trim().toLowerCase()))
    : messages;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <button
          onClick={() => {
            setSearchOpen((v) => !v);
            if (searchOpen) setSearch("");
          }}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
            searchOpen && "bg-accent text-foreground"
          )}
        >
          <Search className="h-3.5 w-3.5" /> Поиск
        </button>
        {searchOpen && (
          <Input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по сообщениям..."
            className="h-7 flex-1 text-sm"
          />
        )}
        {search.trim() && (
          <span className="shrink-0 text-xs text-muted-foreground">{displayedMessages.length} найдено</span>
        )}
      </div>
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto scrollbar-thin p-4"
        onScroll={(e) => {
          const el = e.currentTarget;
          isNearBottomRef.current = el.scrollHeight - (el.scrollTop + el.clientHeight) < 120;
        }}
      >
        {displayedMessages.length === 0 && (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {search.trim() ? "Ничего не найдено" : emptyMessage ?? "Сообщений пока нет"}
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          {displayedMessages.map((m, index) => {
            const isMine = m.authorUid === currentUid;
            const isEditing = editingId === m.id;
            const prev = displayedMessages[index - 1];
            const stacked = Boolean(prev && prev.authorUid === m.authorUid);
            const showAvatar = !stacked;
            return (
              <div key={m.id} className={cn("group flex items-start gap-2.5", stacked ? "mt-0" : "mt-2 first:mt-0")}>
                {showAvatar ? (
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarImage src={m.authorPhotoURL ?? undefined} />
                    <AvatarFallback>{m.authorName[0]?.toUpperCase()}</AvatarFallback>
                  </Avatar>
                ) : (
                  <div className="h-8 w-8 shrink-0" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  {showAvatar ? (
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium">{m.authorName}</span>
                      <span className="text-[10px] text-muted-foreground">{formatMessageWrittenAt(m.createdAt)}</span>
                      {m.editedAt && !m.deleted && (
                        <span className="text-[10px] text-muted-foreground">(изменено)</span>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-baseline gap-2">
                      <span className="text-[10px] text-muted-foreground">{formatMessageWrittenAt(m.createdAt)}</span>
                      {m.editedAt && !m.deleted && (
                        <span className="text-[10px] text-muted-foreground">(изменено)</span>
                      )}
                    </div>
                  )}

                  {m.replyToId && !m.deleted && (
                    <div className="mt-0.5 rounded border-l-2 border-primary/40 bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
                      <span className="font-medium">{m.replyToAuthorName}: </span>
                      {m.replyToText}
                    </div>
                  )}

                  {isEditing ? (
                    <div className="mt-1 flex flex-col gap-1.5">
                      <Textarea
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        rows={2}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleSaveEdit(m.id);
                          }
                          if (e.key === "Escape") setEditingId(null);
                        }}
                      />
                      <div className="flex gap-1.5">
                        <Button size="sm" className="h-7 gap-1 text-xs" onClick={() => handleSaveEdit(m.id)}>
                          <Check className="h-3 w-3" /> Сохранить
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setEditingId(null)}>
                          <X className="h-3 w-3" /> Отмена
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p
                      className={cn(
                        "whitespace-pre-wrap text-sm",
                        m.deleted && "italic text-muted-foreground",
                        isMine &&
                          !m.deleted &&
                          "rounded-2xl border border-primary/55 bg-primary/[0.04] px-3 py-1.5 [border-color:hsl(var(--primary)/0.45)] shadow-[0_0_10px_hsl(var(--primary)/0.16)]"
                      )}
                    >
                      {m.deleted ? "Сообщение удалено" : renderTextWithMentions(m.text, mentionableUsers)}
                    </p>
                  )}
                </div>

                {!isEditing && !m.deleted && (
                  <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button variant="ghost" size="icon" className="h-6 w-6" title="Ответить" onClick={() => setReplyTo(m)}>
                      <Reply className="h-3 w-3" />
                    </Button>
                    {isMine && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          title="Редактировать"
                          onClick={() => {
                            setEditingId(m.id);
                            setEditValue(m.text);
                          }}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-destructive"
                          title="Удалить"
                          onClick={() => handleDelete(m.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div ref={bottomRef} />
      </div>

      <div className="relative border-t border-border p-3">
        {mentionMatches.length > 0 && (
          <div className="absolute bottom-full left-3 mb-1 w-56 rounded-lg border border-border bg-popover p-1 shadow-popover">
            {mentionMatches.map((u) => (
              <button
                key={u.uid}
                onClick={() => insertMention(u)}
                className="flex w-full items-center rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                @{u.name}
              </button>
            ))}
          </div>
        )}
        {replyTo && (
          <div className="mb-2 flex items-center justify-between rounded-lg bg-muted/50 px-3 py-1.5 text-xs">
            <span className="truncate text-muted-foreground">
              Ответ <span className="font-medium">{replyTo.authorName}</span>: {replyTo.text.slice(0, 80)}
            </span>
            <button onClick={() => setReplyTo(null)} className="shrink-0 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="shrink-0" title="Emoji">
                <Smile className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="grid w-56 grid-cols-6 gap-1 p-2">
              {EMOJI.map((e) => (
                <button
                  key={e}
                  onClick={() => setDraft((d) => d + e)}
                  className="rounded p-1 text-lg hover:bg-accent"
                >
                  {e}
                </button>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={mentionableUsers.length > 0 ? "Написать сообщение... (@ для упоминания)" : "Написать сообщение..."}
            rows={1}
            className="max-h-32 min-h-9 flex-1 resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && mentionMatches.length === 0) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <Button onClick={handleSend} disabled={!draft.trim()} className="shrink-0">
            Отправить
          </Button>
        </div>
      </div>
    </div>
  );
}
