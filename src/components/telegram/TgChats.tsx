import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  Download,
  File as FileIcon,
  Film,
  Loader2,
  Mic,
  Paperclip,
  Search,
  Send,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { Textarea } from "@/components/ui/textarea";
import {
  cancelUpload,
  dialogAvatarUrl,
  dismissUpload,
  downloadMessageMedia,
  loadHistory,
  messagePhotoUrl,
  sendFile,
  sendText,
  setOpenChat,
  subscribeTg,
  tgErrorText,
  tgFileLimit,
  tgState,
  type TgDialog,
  type TgMe,
  type TgMessage,
  type TgUpload,
} from "@/services/telegram/tgClient";
import { cn } from "@/utils/cn";
import { formatMessageWrittenAt } from "@/utils/date";
import { filterDialogsByLink, TgChatFilterBar, TgOsChip, TgOsLinkButton, type TgChatFilter, type TgLinking } from "@/components/telegram/TgOsLink";

const FILTER_KEY = "nova:tg-chat-filter";

function readFilter(): TgChatFilter {
  try {
    const v = window.localStorage.getItem(FILTER_KEY);
    if (v === "all" || v === "mine" || v === "none" || (v && v.startsWith("os:"))) return v as TgChatFilter;
  } catch {
    /* без localStorage — «Все» */
  }
  return "all";
}

export function useTg() {
  return useSyncExternalStore(subscribeTg, tgState);
}

export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2).replace(".", ",")} ГБ`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1).replace(".", ",")} МБ`;
  if (n >= 1024) return `${Math.round(n / 1024)} КБ`;
  return `${n} Б`;
}

function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h} ч ${m % 60} мин`;
  if (m > 0) return `${m} мин ${s % 60} с`;
  return `${s} с`;
}

function timeOf(ms: number): string {
  return new Date(ms).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Almaty" });
}

function dayOf(ms: number): string {
  return new Date(ms).toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "Asia/Almaty" });
}

// ---------------------------------------------------------------------
// Аватар.
// ---------------------------------------------------------------------

function hueFrom(id: number) {
  return Math.abs(id * 47) % 360;
}

function TgAvatar({ dialog, size = 40 }: { dialog: Pick<TgDialog, "id" | "title">; size?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void dialogAvatarUrl(dialog.id).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [dialog.id]);
  const hue = hueFrom(dialog.id);
  return url ? (
    <img src={url} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span
      className="flex shrink-0 items-center justify-center rounded-full text-[13px] font-semibold"
      style={{ width: size, height: size, backgroundImage: `linear-gradient(145deg, hsl(${hue} 62% 44%), hsl(${hue} 58% 22%))`, color: `hsl(${hue} 70% 88%)` }}
    >
      {dialog.title.slice(0, 1).toUpperCase()}
    </span>
  );
}

// ---------------------------------------------------------------------
// Раздел целиком: список чатов слева, переписка справа.
// ---------------------------------------------------------------------

export function TgChats({
  me,
  chatId,
  onOpenChat,
  linking = null,
}: {
  me: TgMe;
  chatId: number | null;
  onOpenChat: (id: number | null) => void;
  /** Привязка чатов к нику ОС; null — SQL ещё не накатан или привязки не прочитаны. */
  linking?: TgLinking | null;
}) {
  const tg = useTg();
  const [query, setQuery] = useState("");
  const [filterRaw, setFilterRaw] = useState<TgChatFilter>(readFilter);
  // «Мои» без своего ника ОС ничего не значат — тогда «Все».
  const filter: TgChatFilter = !linking || (filterRaw === "mine" && !linking.myOsValue) ? "all" : filterRaw;
  const setFilter = (next: TgChatFilter) => {
    setFilterRaw(next);
    try {
      window.localStorage.setItem(FILTER_KEY, next);
    } catch {
      /* ничего */
    }
  };
  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tg.dialogs;
    return tg.dialogs.filter((d) => d.title.toLowerCase().includes(q) || (d.username ?? "").toLowerCase().includes(q));
  }, [tg.dialogs, query]);
  const dialogs = useMemo(() => filterDialogsByLink(searched, filter, linking), [searched, filter, linking]);
  const open = chatId !== null ? (tg.dialogs.find((d) => d.id === chatId) ?? null) : null;

  useEffect(() => {
    setOpenChat(chatId);
    return () => setOpenChat(null);
  }, [chatId]);

  return (
    <div className="flex min-h-0 flex-1">
      <div className={cn("w-full shrink-0 flex-col border-r border-border md:flex md:w-80", chatId !== null ? "hidden" : "flex")}>
        <div className="border-b border-border p-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск чатов" className="h-9 pl-8 text-sm" />
          </div>
          {linking && (
            <div className="mt-2">
              <TgChatFilterBar dialogs={searched} filter={filter} onFilter={setFilter} linking={linking} />
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {!tg.dialogsLoaded ? (
            <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Загружаю чаты…
            </p>
          ) : tg.dialogsError ? (
            <p className="p-4 text-sm text-destructive">{tg.dialogsError}</p>
          ) : dialogs.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              {query ? "Ничего не нашлось" : filter === "all" ? "Чатов пока нет" : filter === "none" ? "Все чаты привязаны к ОС" : "Нет чатов с этим ОС"}
            </p>
          ) : (
            dialogs.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => onOpenChat(d.id)}
                className={cn("flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/40", chatId === d.id && "bg-primary/[0.08]")}
              >
                <TgAvatar dialog={d} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className={cn("truncate text-sm", d.unread ? "font-semibold" : "font-medium")}>{d.title}</span>
                      {linking?.links[d.id] && <TgOsChip value={linking.links[d.id].osValue} options={linking.options} className="max-w-[6.5rem] shrink-0" />}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{d.lastAt ? formatMessageWrittenAt(d.lastAt, { compact: true }) : ""}</span>
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <span className={cn("truncate text-xs", d.unread ? "text-foreground" : "text-muted-foreground")}>
                      {d.lastOut ? "Вы: " : ""}
                      {d.lastText}
                    </span>
                    {d.unread > 0 ? (
                      <span className="shrink-0 rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-4 text-primary-foreground">{d.unread}</span>
                    ) : d.lastOut ? (
                      <ReadMark read={d.lastId <= d.readOutboxMaxId} />
                    ) : null}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
      <div className={cn("min-w-0 flex-1 flex-col", chatId === null ? "hidden md:flex" : "flex")}>
        {open ? (
          <TgConversation key={open.id} dialog={open} me={me} onBack={() => onOpenChat(null)} linking={linking} />
        ) : chatId !== null && tg.dialogsLoaded ? (
          <EmptyPane text="Чат не найден среди последних" onBack={() => onOpenChat(null)} />
        ) : (
          <EmptyPane text="Выберите чат слева" />
        )}
      </div>
    </div>
  );
}

function EmptyPane({ text, onBack }: { text: string; onBack?: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground">
      {text}
      {onBack && (
        <Button variant="outline" size="sm" onClick={onBack} className="md:hidden">
          К списку чатов
        </Button>
      )}
    </div>
  );
}

function ReadMark({ read }: { read: boolean }) {
  return read ? (
    <CheckCheck className="h-3.5 w-3.5 shrink-0 text-primary" aria-label="Прочитано" />
  ) : (
    <Check className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Доставлено" />
  );
}

// ---------------------------------------------------------------------
// Переписка.
// ---------------------------------------------------------------------

function TgConversation({ dialog, me, onBack, linking }: { dialog: TgDialog; me: TgMe; onBack: () => void; linking: TgLinking | null }) {
  const tg = useTg();
  const cache = tg.chats[dialog.id];
  const messages = cache?.messages ?? [];
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const prevHeight = useRef<number | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadHistory(dialog.id);
  }, [dialog.id]);

  // Новые сообщения — вниз, если человек и так внизу; догрузка старых — без прыжка.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (prevHeight.current !== null) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
      prevHeight.current = null;
      return;
    }
    if (stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 60 && cache?.hasMore && !cache.loading && messages.length > 0) {
      prevHeight.current = el.scrollHeight;
      void loadHistory(dialog.id, true);
    }
  };

  async function submitText() {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    try {
      await sendText(dialog.id, value);
      setText("");
      stickToBottom.current = true;
    } catch (error) {
      toast.error(tgErrorText(error, "Сообщение не отправилось"));
    } finally {
      setSending(false);
    }
  }

  const pickFile = useCallback(
    (file: File | null | undefined) => {
      if (!file) return;
      const limit = tgFileLimit(me);
      if (file.size > limit) {
        toast.error(`Файл ${formatBytes(file.size)} — больше предела Telegram ${formatBytes(limit)}`);
        return;
      }
      setPending(file);
    },
    [me]
  );

  const uploads = tg.uploads.filter((u) => u.chatId === dialog.id);

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        pickFile(e.dataTransfer.files?.[0]);
      }}
    >
      <div className="flex items-center gap-3 border-b border-border px-3 py-2">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={onBack} aria-label="К списку чатов">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <TgAvatar dialog={dialog} size={36} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{dialog.title}</p>
          <p className="truncate text-[11px] text-muted-foreground">{dialog.username ? `@${dialog.username}` : dialog.isUser ? "личный чат" : "группа или канал"}</p>
        </div>
        {linking && <TgOsLinkButton dialog={dialog} linking={linking} />}
      </div>

      <div ref={scroller} onScroll={onScroll} className="flex-1 overflow-y-auto px-3 py-3 scrollbar-thin sm:px-6">
        {cache?.loading && messages.length === 0 && (
          <p className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Загружаю переписку…
          </p>
        )}
        {cache?.error && <p className="py-3 text-center text-sm text-destructive">{cache.error}</p>}
        {cache?.loading && messages.length > 0 && (
          <p className="flex justify-center py-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </p>
        )}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || dayOf(prev.date) !== dayOf(m.date);
          return (
            <div key={m.id}>
              {newDay && <p className="my-3 text-center text-[11px] text-muted-foreground">{dayOf(m.date)}</p>}
              <Bubble message={m} showSender={!dialog.isUser} read={m.out && m.id <= dialog.readOutboxMaxId} />
            </div>
          );
        })}
      </div>

      {uploads.length > 0 && (
        <div className="space-y-2 border-t border-border px-3 py-2">
          {uploads.map((u) => (
            <UploadRow key={u.id} upload={u} />
          ))}
        </div>
      )}

      {pending ? (
        <PendingFile
          file={pending}
          onCancel={() => setPending(null)}
          onSend={async (caption, asDocument) => {
            const file = pending;
            setPending(null);
            stickToBottom.current = true;
            try {
              await sendFile({ chatId: dialog.id, chatTitle: dialog.title, file, caption, asDocument });
            } catch (error) {
              toast.error(tgErrorText(error, "Файл не отправился"));
            }
          }}
        />
      ) : (
        <form
          className="flex items-end gap-2 border-t border-border p-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submitText();
          }}
        >
          <input ref={fileInput} type="file" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />
          <Button type="button" variant="ghost" size="icon" onClick={() => fileInput.current?.click()} aria-label="Прикрепить файл" title="Файл или видео">
            <Paperclip className="h-4 w-4" />
          </Button>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submitText();
              }
            }}
            placeholder="Сообщение"
            rows={1}
            className="max-h-40 min-h-10 resize-none"
          />
          <Button type="submit" size="icon" disabled={!text.trim() || sending} aria-label="Отправить">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      )}

      {dragOver && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center border-2 border-dashed border-primary bg-background/80 text-sm font-medium text-primary">
          Отпустите файл, чтобы отправить в «{dialog.title}»
        </div>
      )}
    </div>
  );
}

function Bubble({ message, showSender, read }: { message: TgMessage; showSender: boolean; read: boolean }) {
  return (
    <div className={cn("mb-1.5 flex", message.out ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3 py-1.5 text-sm sm:max-w-[70%]",
          message.out ? "rounded-br-md bg-primary/[0.16]" : "rounded-bl-md border border-border bg-card"
        )}
      >
        {showSender && !message.out && <p className="mb-0.5 text-[11px] font-semibold text-primary">{message.senderName}</p>}
        {message.media && <MediaView message={message} />}
        {message.text && <p className="whitespace-pre-wrap break-words">{message.text}</p>}
        <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
          {message.edited && <span>изм.</span>}
          {timeOf(message.date)}
          {message.out && <ReadMark read={read} />}
        </p>
      </div>
    </div>
  );
}

function MediaView({ message }: { message: TgMessage }) {
  const media = message.media!;
  const [photo, setPhoto] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  useEffect(() => {
    if (media.type !== "photo") return;
    let alive = true;
    void messagePhotoUrl(message.chatId, message.id).then((u) => alive && setPhoto(u));
    return () => {
      alive = false;
    };
  }, [media.type, message.chatId, message.id]);

  if (media.type === "photo") {
    return photo ? (
      <img src={photo} alt="Фото" className="mb-1 max-h-80 rounded-lg object-contain" />
    ) : (
      <div className="mb-1 flex h-40 w-56 items-center justify-center rounded-lg bg-muted/50">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (media.type === "sticker") return <p className="text-3xl">{media.emoji ?? "Стикер"}</p>;

  const downloadable = ["video", "document", "voice", "audio", "animation"].includes(media.type);
  if (!downloadable) return <p className="text-[12px] italic text-muted-foreground">Вложение этого вида здесь не показывается</p>;

  async function download() {
    if (progress !== null) return;
    setProgress(0);
    try {
      const blob = await downloadMessageMedia(message.chatId, message.id, (done, total) => setProgress(total ? done / total : 0));
      if (!blob) throw new Error("Вложение недоступно");
      const url = URL.createObjectURL(blob);
      if (media.type === "voice" || media.type === "audio") {
        setAudioUrl(url);
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = media.fileName || `telegram-${message.id}${media.type === "video" ? ".mp4" : ""}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch (error) {
      toast.error(tgErrorText(error, "Не удалось скачать"));
    } finally {
      setProgress(null);
    }
  }

  if (audioUrl) return <audio src={audioUrl} controls autoPlay className="mb-1 h-10 w-64 max-w-full" />;

  const Icon = media.type === "video" ? Film : media.type === "voice" || media.type === "audio" ? Mic : FileIcon;
  const label = media.type === "voice" ? "Голосовое" : media.fileName || (media.type === "video" ? "Видео" : "Файл");
  return (
    <button type="button" onClick={() => void download()} className="mb-1 flex w-64 max-w-full items-center gap-2.5 rounded-lg border border-border bg-background/60 p-2 text-left hover:bg-accent/40">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/[0.12] text-primary">
        {progress !== null ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{label}</span>
        <span className="block text-[11px] text-muted-foreground">
          {progress !== null
            ? `Скачиваю ${Math.round(progress * 100)}%`
            : [media.fileSize ? formatBytes(media.fileSize) : null, media.duration ? formatDuration(media.duration) : null].filter(Boolean).join(" · ") || "Скачать"}
        </span>
      </span>
      {progress === null && <Download className="h-4 w-4 shrink-0 text-muted-foreground" />}
    </button>
  );
}

// ---------------------------------------------------------------------
// Отправка файла.
// ---------------------------------------------------------------------

function PendingFile({ file, onCancel, onSend }: { file: File; onCancel: () => void; onSend: (caption: string, asDocument: boolean) => void }) {
  const [caption, setCaption] = useState("");
  const [asDocument, setAsDocument] = useState(false);
  const isImage = file.type.startsWith("image/");
  const isVideo = file.type.startsWith("video/");
  return (
    <div className="space-y-2 border-t border-border p-3">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/[0.12] text-primary">
          {isVideo ? <Film className="h-4 w-4" /> : <FileIcon className="h-4 w-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{file.name}</span>
          <span className="block text-[11px] text-muted-foreground">
            {formatBytes(file.size)}
            {isVideo ? " · уйдёт видео в исходном качестве" : ""}
          </span>
        </span>
        <Button variant="ghost" size="icon" onClick={onCancel} aria-label="Не отправлять">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <Input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Подпись (необязательно)" />
      {isImage && (
        <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <Checkbox checked={asDocument} onCheckedChange={(v) => setAsDocument(v === true)} /> Отправить файлом, без сжатия
        </label>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          Отмена
        </Button>
        <Button onClick={() => onSend(caption, asDocument)} className="gap-1.5">
          <Send className="h-4 w-4" /> Отправить
        </Button>
      </div>
    </div>
  );
}

function UploadRow({ upload }: { upload: TgUpload }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (upload.status !== "uploading") return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [upload.status]);
  const pct = upload.size ? upload.sent / upload.size : 0;
  const elapsed = (Date.now() - upload.startedAt) / 1000;
  const speed = elapsed > 1 ? upload.sent / elapsed : 0;
  const left = speed > 0 ? (upload.size - upload.sent) / speed : null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="flex items-center gap-2 text-[12px]">
        <span className="min-w-0 flex-1 truncate font-medium">{upload.fileName}</span>
        {upload.status === "uploading" ? (
          <>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {Math.round(pct * 100)}% · {formatBytes(upload.sent)} из {formatBytes(upload.size)}
              {left !== null && pct > 0.01 ? ` · ещё ${formatDuration(left)}` : ""}
            </span>
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => cancelUpload(upload.id)}>
              Отменить
            </Button>
          </>
        ) : (
          <>
            <span className={cn("shrink-0", upload.status === "done" ? "text-success" : upload.status === "error" ? "text-destructive" : "text-muted-foreground")}>
              {upload.status === "done" ? "Отправлено" : upload.status === "cancelled" ? "Отменено" : upload.error}
            </span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => dismissUpload(upload.id)} aria-label="Убрать">
              <X className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
      {upload.status === "uploading" && (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${Math.round(pct * 100)}%` }} />
        </div>
      )}
      {upload.status === "uploading" && <p className="mt-1 text-[11px] text-muted-foreground">Не закрывайте вкладку, пока файл уходит. По другим страницам Nova ходить можно.</p>}
    </div>
  );
}
