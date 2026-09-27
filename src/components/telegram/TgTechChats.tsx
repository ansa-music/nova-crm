import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Loader2, Lock, RefreshCw, Send } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { callTgEdge, listenTgGrants, TgEdgeError } from "@/services/telegram/tgServer";
import { zonedDateFormat } from "@/utils/date";
import { cn } from "@/utils/cn";

interface TechMessage {
  id: number;
  out: boolean;
  date: number;
  text: string;
  media: string | null;
  service: boolean;
}

interface TechChat {
  chatId: number;
  title: string;
  unread: number;
  last: TechMessage | null;
}

const POLL_MS = 8000;

function errText(error: unknown) {
  if (error instanceof TgEdgeError) return error.message;
  return error instanceof Error ? error.message : "Ошибка";
}

function timeOf(ms: number) {
  return zonedDateFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
}

/**
 * Раздел «Telegram» у технаря (просьба Nurba 27.09.2026): только те клиенты,
 * к которым ОС заказа открыл ему доступ. Своего входа в Telegram у технаря
 * нет — история и отправка идут через сервер (функция `tg`), и он пускает
 * только в разрешённые чаты.
 */
export function TgTechChats({ workspaceId, chatId, onOpenChat }: { workspaceId: string; chatId: number | null; onOpenChat: (id: number | null) => void }) {
  const [chats, setChats] = useState<TechChat[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const loadChats = useCallback(async () => {
    try {
      const res = await callTgEdge<{ chats: TechChat[] }>(workspaceId, "tech_chats");
      setChats(res.chats ?? []);
      setListError(null);
    } catch (e) {
      setListError(errText(e));
      setChats((prev) => prev ?? []);
    }
  }, [workspaceId]);

  useEffect(() => {
    void loadChats();
    const timer = setInterval(() => document.visibilityState === "visible" && void loadChats(), 30_000);
    const stop = listenTgGrants(workspaceId, () => void loadChats());
    return () => {
      clearInterval(timer);
      stop();
    };
  }, [workspaceId, loadChats]);

  const open = chats?.find((c) => c.chatId === chatId) ?? null;

  return (
    <div className="flex min-h-0 flex-1">
      <aside className={cn("flex w-full min-w-0 flex-col border-r border-border md:w-80", open && "hidden md:flex")}>
        <div className="border-b border-border px-4 py-2 text-[12px] text-muted-foreground">
          Вам открыты клиенты, к которым ОС дал доступ по заказу.
        </div>
        {listError && (
          <div className="p-3">
            <Alert tone="warning">{listError}</Alert>
          </div>
        )}
        {chats === null ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : chats.length === 0 ? (
          <p className="p-6 text-center text-[13px] text-muted-foreground">Пока ни одного клиента. Доступ открывает ОС вашего заказа.</p>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {chats.map((c) => (
              <li key={c.chatId}>
                <button
                  type="button"
                  onClick={() => onOpenChat(c.chatId)}
                  className={cn("flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left hover:bg-accent/60", c.chatId === chatId && "bg-primary/10")}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium">{c.title || `Чат ${c.chatId}`}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">
                      {c.last ? (c.last.out ? "Вы: " : "") + (c.last.text || (c.last.media ? `[${c.last.media}]` : "")) : "—"}
                    </span>
                  </span>
                  {c.unread > 0 && <span className="rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">{c.unread}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
      <section className={cn("min-w-0 flex-1 flex-col", open ? "flex" : "hidden md:flex")}>
        {open ? (
          <TechConversation key={open.chatId} workspaceId={workspaceId} chat={open} onBack={() => onOpenChat(null)} onChanged={loadChats} />
        ) : chatId !== null && chats !== null ? (
          <div className="m-auto flex max-w-sm flex-col items-center gap-2 p-6 text-center text-[13px] text-muted-foreground">
            <Lock className="h-5 w-5" /> Этот чат вам не открыт.
          </div>
        ) : (
          <div className="m-auto p-6 text-[13px] text-muted-foreground">Выберите клиента слева.</div>
        )}
      </section>
    </div>
  );
}

function TechConversation({ workspaceId, chat, onBack, onChanged }: { workspaceId: string; chat: TechChat; onBack: () => void; onChanged: () => void }) {
  const [messages, setMessages] = useState<TechMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const lastId = useMemo(() => messages.reduce((m, x) => Math.max(m, x.id), 0), [messages]);
  const lastIdRef = useRef(0);
  lastIdRef.current = lastId;

  const merge = (add: TechMessage[]) =>
    setMessages((prev) => {
      const map = new Map(prev.map((m) => [m.id, m]));
      for (const m of add) map.set(m.id, m);
      return [...map.values()].sort((a, b) => a.id - b.id);
    });

  const read = useCallback(
    (maxId: number) => {
      if (maxId > 0) void callTgEdge(workspaceId, "tech_read", { chatId: chat.chatId, maxId }).then(onChanged).catch(() => undefined);
    },
    [workspaceId, chat.chatId, onChanged]
  );

  useEffect(() => {
    let stopped = false;
    (async () => {
      try {
        const res = await callTgEdge<{ messages: TechMessage[] }>(workspaceId, "tech_history", { chatId: chat.chatId, limit: 40 });
        if (stopped) return;
        merge(res.messages ?? []);
        setError(null);
        read(Math.max(0, ...(res.messages ?? []).map((m) => m.id)));
      } catch (e) {
        if (!stopped) setError(errText(e));
      } finally {
        if (!stopped) setLoading(false);
      }
    })();
    const timer = setInterval(async () => {
      if (document.visibilityState !== "visible" || !lastIdRef.current) return;
      try {
        const res = await callTgEdge<{ messages: TechMessage[] }>(workspaceId, "tech_history", { chatId: chat.chatId, minId: lastIdRef.current, limit: 40 });
        const fresh = (res.messages ?? []).filter((m) => m.id > lastIdRef.current);
        if (fresh.length && !stopped) {
          merge(fresh);
          read(Math.max(...fresh.map((m) => m.id)));
        }
      } catch {
        /* следующий опрос */
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [workspaceId, chat.chatId, read]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  async function send() {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    try {
      await callTgEdge(workspaceId, "tech_send", { chatId: chat.chatId, text: value });
      setText("");
      const res = await callTgEdge<{ messages: TechMessage[] }>(workspaceId, "tech_history", { chatId: chat.chatId, minId: lastIdRef.current, limit: 20 });
      merge(res.messages ?? []);
    } catch (e) {
      setError(errText(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={onBack} aria-label="К списку">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{chat.title || `Чат ${chat.chatId}`}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {loading ? (
          <div className="flex justify-center p-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {messages.map((m) =>
              m.service ? (
                <p key={m.id} className="self-center text-[11px] text-muted-foreground">
                  служебное сообщение
                </p>
              ) : (
                <div
                  key={m.id}
                  className={cn(
                    "max-w-[80%] whitespace-pre-wrap break-words rounded-lg px-3 py-1.5 text-[13px]",
                    m.out ? "self-end bg-primary/15" : "self-start bg-muted"
                  )}
                >
                  {m.media && <span className="mr-1 text-muted-foreground">[{m.media}]</span>}
                  {m.text}
                  <span className="ml-2 align-bottom text-[10px] text-muted-foreground">{timeOf(m.date)}</span>
                </div>
              )
            )}
            {!messages.length && <p className="p-6 text-center text-[13px] text-muted-foreground">Сообщений пока нет.</p>}
            <div ref={bottom} />
          </div>
        )}
      </div>
      {error && (
        <div className="px-3 pb-2">
          <Alert
            tone="warning"
            action={
              <Button variant="outline" size="sm" onClick={() => setError(null)}>
                <RefreshCw className="h-3.5 w-3.5" /> Скрыть
              </Button>
            }
          >
            {error}
          </Alert>
        </div>
      )}
      <form
        className="flex items-end gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <Textarea
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Сообщение клиенту"
          aria-label="Сообщение"
          className="max-h-40 min-h-11 resize-none"
        />
        <Button type="submit" size="icon" className="h-11 w-11 shrink-0" disabled={sending || !text.trim()} aria-label="Отправить">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </form>
    </>
  );
}
