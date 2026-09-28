import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Download, FileText, Loader2, Lock, Mic, Music, Paperclip, Play, RefreshCw, Send } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { callTgEdge, listenTgGrants, TgEdgeError } from "@/services/telegram/tgServer";
import { cancelTechUpload, dismissTechUpload, retryTechUpload, startTechUpload, TECH_FILE_MAX, useTechUploads } from "@/services/telegram/tgTechUpload";
import { formatBytes, PendingFile, UploadRow } from "@/components/telegram/TgUploadParts";
import { zonedDateFormat } from "@/utils/date";
import { cn } from "@/utils/cn";

interface TechFile {
  kind: "photo" | "video" | "round" | "voice" | "audio" | "sticker" | "document";
  name: string | null;
  mime: string | null;
  size: number | null;
  w: number | null;
  h: number | null;
  duration: number | null;
  thumb: boolean;
}

interface TechMessage {
  id: number;
  out: boolean;
  date: number;
  text: string;
  media: string | null;
  service: boolean;
  /** Кто написал — в группах (старый сервер поля не шлёт). */
  from?: string | null;
  file?: TechFile | null;
}

interface TechChat {
  chatId: number;
  title: string;
  unread: number;
  last: TechMessage | null;
}

const POLL_MS = 8000;

/** Файлы технарю открывает служебный бот — пока его нет, объясняем, кто включает. */
const FILES_OFF_TEXT = "Отправка файлов ещё не включена: Owner подключает служебного бота в разделе Telegram — кнопка «Файлы технарей».";

function errText(error: unknown) {
  if (error instanceof TgEdgeError) return error.message;
  return error instanceof Error ? error.message : "Ошибка";
}

function timeOf(ms: number) {
  return zonedDateFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
}

function dayOf(ms: number) {
  return zonedDateFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(new Date(ms));
}

function sizeText(bytes: number | null | undefined) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} МБ`;
}

function durationText(sec: number | null | undefined) {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  return `${m}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
}

function b64ToBlob(data: string, mime: string): Blob {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

const FILE_LABEL: Record<TechFile["kind"], string> = {
  photo: "Фото",
  video: "Видео",
  round: "Кружок",
  voice: "Голосовое",
  audio: "Аудио",
  sticker: "Стикер",
  document: "Файл",
};

/** Открытый файл: фото или видео — в окне, остальное скачивается. */
interface OpenedFile {
  id: number;
  url: string;
  mime: string;
  name: string;
}

/**
 * Раздел «Telegram» у технаря (просьба Nurba 27.09.2026): только те клиенты,
 * к которым ОС заказа открыл ему доступ. Своего входа в Telegram у технаря
 * нет — история и отправка идут через сервер (функция `tg`), и он пускает
 * только в разрешённые чаты.
 */
export function TgTechChats({
  workspaceId,
  uid,
  chatId,
  onOpenChat,
}: {
  workspaceId: string;
  uid: string;
  chatId: number | null;
  onOpenChat: (id: number | null) => void;
}) {
  const [chats, setChats] = useState<TechChat[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  // Можно ли отправлять файлы (Owner подключил служебного бота); старый сервер поля не шлёт.
  const [filesOn, setFilesOn] = useState(false);

  const loadChats = useCallback(async () => {
    try {
      const res = await callTgEdge<{ chats: TechChat[]; files?: boolean }>(workspaceId, "tech_chats");
      setChats(res.chats ?? []);
      setFilesOn(res.files === true);
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
          <TechConversation key={open.chatId} workspaceId={workspaceId} uid={uid} filesOn={filesOn} chat={open} onBack={() => onOpenChat(null)} onChanged={loadChats} />
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

function TechConversation({
  workspaceId,
  uid,
  filesOn,
  chat,
  onBack,
  onChanged,
}: {
  workspaceId: string;
  uid: string;
  filesOn: boolean;
  chat: TechChat;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [messages, setMessages] = useState<TechMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [fetching, setFetching] = useState<number | null>(null);
  const [opened, setOpened] = useState<OpenedFile | null>(null);
  const [pending, setPending] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const allUploads = useTechUploads();
  const uploads = useMemo(() => allUploads.filter((u) => u.chatId === chat.chatId), [allUploads, chat.chatId]);
  const doneSeen = useRef(new Set<string>());
  const scroller = useRef<HTMLDivElement>(null);
  const stickBottom = useRef(true);
  const requested = useRef(new Set<number>());
  const lastId = useMemo(() => messages.reduce((m, x) => Math.max(m, x.id), 0), [messages]);
  const firstId = useMemo(() => messages.reduce((m, x) => (m === 0 ? x.id : Math.min(m, x.id)), 0), [messages]);
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
        const res = await callTgEdge<{ messages: TechMessage[]; done?: boolean }>(workspaceId, "tech_history", { chatId: chat.chatId, limit: 40 });
        if (stopped) return;
        merge(res.messages ?? []);
        setDone(Boolean(res.done));
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

  // Превью фото и видео — пачкой, по 40, только тех, что ещё не просили.
  useEffect(() => {
    const need = messages.filter((m) => m.file?.thumb && !requested.current.has(m.id)).map((m) => m.id);
    if (!need.length) return;
    const batch = need.slice(-40);
    batch.forEach((id) => requested.current.add(id));
    callTgEdge<{ thumbs: Record<string, string> }>(workspaceId, "tech_media", { chatId: chat.chatId, ids: batch })
      .then((res) => setThumbs((prev) => ({ ...prev, ...(res.thumbs ?? {}) })))
      .catch(() => batch.forEach((id) => requested.current.delete(id)));
  }, [messages, workspaceId, chat.chatId]);

  // Прокрутка: вниз — только когда человек и так внизу (новое сообщение).
  useEffect(() => {
    const el = scroller.current;
    if (el && stickBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, thumbs]);

  useEffect(() => () => {
    if (opened) URL.revokeObjectURL(opened.url);
  }, [opened]);

  async function loadOlder() {
    if (loadingOlder || !firstId) return;
    const el = scroller.current;
    const before = el ? el.scrollHeight - el.scrollTop : 0;
    setLoadingOlder(true);
    try {
      const res = await callTgEdge<{ messages: TechMessage[]; done?: boolean }>(workspaceId, "tech_history", { chatId: chat.chatId, offsetId: firstId, limit: 40 });
      stickBottom.current = false;
      merge(res.messages ?? []);
      setDone(Boolean(res.done) || !(res.messages ?? []).length);
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - before;
      });
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoadingOlder(false);
    }
  }

  async function openFile(m: TechMessage) {
    if (!m.file || fetching) return;
    setFetching(m.id);
    try {
      const res = await callTgEdge<{ name: string | null; mime: string; data: string }>(workspaceId, "tech_media", { chatId: chat.chatId, ids: [m.id], full: true });
      const blob = b64ToBlob(res.data, res.mime || m.file.mime || "application/octet-stream");
      const url = URL.createObjectURL(blob);
      const name = res.name || m.file.name || `${FILE_LABEL[m.file.kind].toLowerCase()}-${m.id}`;
      const mime = blob.type;
      if (mime.startsWith("image/") || mime.startsWith("video/") || mime.startsWith("audio/")) {
        setOpened({ id: m.id, url, mime, name });
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        // Ссылка вне документа у части браузеров скачивает файл без имени.
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
    } catch (e) {
      toast.error("Файл не открылся", { description: errText(e) });
    } finally {
      setFetching(null);
    }
  }

  // Файл ушёл клиенту — сразу подтянуть его в переписку, не ждать опроса.
  useEffect(() => {
    const fresh = uploads.filter((u) => u.status === "done" && !doneSeen.current.has(u.id));
    if (!fresh.length) return;
    fresh.forEach((u) => doneSeen.current.add(u.id));
    stickBottom.current = true;
    callTgEdge<{ messages: TechMessage[] }>(workspaceId, "tech_history", { chatId: chat.chatId, minId: lastIdRef.current, limit: 20 })
      .then((res) => merge(res.messages ?? []))
      .catch(() => undefined);
  }, [uploads, workspaceId, chat.chatId]);

  function pickFile(file: File | null | undefined) {
    if (!file) return;
    if (!filesOn) {
      toast.info(FILES_OFF_TEXT);
      return;
    }
    if (file.size > TECH_FILE_MAX) {
      toast.error(`Файл ${formatBytes(file.size)} — через Nova уходят файлы до 2 ГБ. Этот отправьте через ОС.`);
      return;
    }
    setPending(file);
  }

  function sendFile(file: File, caption: string, asDocument: boolean) {
    setPending(null);
    stickBottom.current = true;
    try {
      startTechUpload({ workspaceId, uid, chatId: chat.chatId, chatTitle: chat.title, file, caption, asDocument });
    } catch (e) {
      toast.error("Файл не отправился", { description: errText(e) });
    }
  }

  async function send() {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    try {
      await callTgEdge(workspaceId, "tech_send", { chatId: chat.chatId, text: value });
      setText("");
      stickBottom.current = true;
      const res = await callTgEdge<{ messages: TechMessage[] }>(workspaceId, "tech_history", { chatId: chat.chatId, minId: lastIdRef.current, limit: 20 });
      merge(res.messages ?? []);
    } catch (e) {
      setError(errText(e));
    } finally {
      setSending(false);
    }
  }

  let lastDay = "";
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
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragOver(false);
        pickFile(e.dataTransfer.files?.[0]);
      }}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={onBack} aria-label="К списку">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{chat.title || `Чат ${chat.chatId}`}</span>
      </div>
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
        onScroll={(e) => {
          const el = e.currentTarget;
          stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {loading ? (
          <div className="flex justify-center p-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-1.5">
            {!done && messages.length > 0 ? (
              <Button variant="ghost" size="sm" className="self-center text-muted-foreground" disabled={loadingOlder} onClick={() => void loadOlder()}>
                {loadingOlder ? <Loader2 className="h-4 w-4 animate-spin" /> : "Показать раньше"}
              </Button>
            ) : null}
            {messages.map((m) => {
              const day = dayOf(m.date);
              const sep = day !== lastDay;
              lastDay = day;
              return (
                <div key={m.id} className="flex flex-col">
                  {sep ? (
                    <span className="my-2 self-center rounded-full bg-muted px-2.5 py-0.5 text-[11px] text-muted-foreground">{day}</span>
                  ) : null}
                  {m.service ? (
                    <p className="self-center text-[11px] text-muted-foreground">служебное сообщение</p>
                  ) : (
                    <Bubble m={m} thumb={thumbs[String(m.id)]} busy={fetching === m.id} onOpen={() => void openFile(m)} />
                  )}
                </div>
              );
            })}
            {!messages.length && <p className="p-6 text-center text-[13px] text-muted-foreground">Сообщений пока нет.</p>}
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
      {uploads.length > 0 && (
        <div className="space-y-2 border-t border-border px-3 py-2">
          {uploads.map((u) => (
            <UploadRow
              key={u.id}
              upload={u}
              onCancel={() => cancelTechUpload(u.id)}
              onDismiss={() => dismissTechUpload(u.id)}
              onRetry={() => retryTechUpload(u.id)}
            />
          ))}
        </div>
      )}
      {pending ? (
        <PendingFile file={pending} onCancel={() => setPending(null)} onSend={(caption, asDocument) => sendFile(pending, caption, asDocument)} />
      ) : (
        <form
          className="flex items-end gap-2 border-t border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <input
            ref={fileInput}
            type="file"
            className="hidden"
            onChange={(e) => {
              pickFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn("h-11 w-11 shrink-0", !filesOn && "text-muted-foreground/60")}
            onClick={() => (filesOn ? fileInput.current?.click() : toast.info(FILES_OFF_TEXT))}
            aria-label="Прикрепить файл"
            title={filesOn ? "Видео или файл до 2 ГБ" : FILES_OFF_TEXT}
          >
            <Paperclip className="h-4 w-4" />
          </Button>
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
      )}
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-primary bg-background/80 p-6 text-center text-sm font-medium text-primary">
          {filesOn ? `Отпустите файл, чтобы отправить клиенту «${chat.title || "Чат"}»` : FILES_OFF_TEXT}
        </div>
      )}
      <Dialog open={Boolean(opened)} onOpenChange={(v) => !v && setOpened(null)}>
        <DialogContent className="max-w-[min(92vw,1100px)] p-3">
          <DialogTitle className="truncate pr-8 text-[14px]">{opened?.name}</DialogTitle>
          {opened ? (
            opened.mime.startsWith("image/") ? (
              <img src={opened.url} alt={opened.name} className="max-h-[78dvh] w-full rounded-md object-contain" />
            ) : opened.mime.startsWith("video/") ? (
              <video src={opened.url} controls autoPlay className="max-h-[78dvh] w-full rounded-md bg-black" />
            ) : (
              <audio src={opened.url} controls autoPlay className="w-full" />
            )
          ) : null}
          {opened ? (
            <a href={opened.url} download={opened.name} className="inline-flex items-center gap-1.5 self-start text-[13px] text-primary hover:underline">
              <Download className="h-3.5 w-3.5" /> Скачать
            </a>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Bubble({ m, thumb, busy, onOpen }: { m: TechMessage; thumb: string | undefined; busy: boolean; onOpen: () => void }) {
  const f = m.file ?? null;
  const visual = f && (f.kind === "photo" || f.kind === "video" || f.kind === "round" || f.kind === "sticker");
  const Icon = !f ? FileText : f.kind === "voice" ? Mic : f.kind === "audio" ? Music : f.kind === "video" || f.kind === "round" ? Play : FileText;
  return (
    <div className={cn("flex max-w-[min(80%,34rem)] flex-col gap-1 rounded-lg px-2.5 py-1.5 text-[13px]", m.out ? "self-end bg-primary/15" : "self-start bg-muted")}>
      {m.from ? <span className="text-[11.5px] font-semibold text-primary">{m.from}</span> : null}
      {f ? (
        visual && (thumb || f.thumb) ? (
          <button
            type="button"
            onClick={onOpen}
            className="group relative overflow-hidden rounded-md bg-background/40"
            style={{ aspectRatio: f.w && f.h ? `${f.w} / ${f.h}` : "4 / 3", width: f.kind === "sticker" ? "8rem" : "18rem", maxWidth: "100%", maxHeight: "22rem" }}
            aria-label={`Открыть: ${FILE_LABEL[f.kind]}`}
            title="Открыть"
          >
            {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : <span className="absolute inset-0 animate-pulse bg-muted" />}
            {f.kind === "video" || f.kind === "round" || busy ? (
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white">
                  {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />}
                </span>
              </span>
            ) : null}
            {f.duration ? <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10.5px] text-white">{durationText(f.duration)}</span> : null}
          </button>
        ) : (
          <button type="button" onClick={onOpen} className="flex min-w-0 items-center gap-2 rounded-md bg-background/40 px-2 py-1.5 text-left hover:bg-background/70" title="Открыть или скачать">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[12.5px] font-medium">{f.name || FILE_LABEL[f.kind]}</span>
              <span className="block text-[11px] text-muted-foreground">{[FILE_LABEL[f.kind], sizeText(f.size), durationText(f.duration)].filter(Boolean).join(" · ")}</span>
            </span>
          </button>
        )
      ) : m.media ? (
        <span className="text-muted-foreground">[{m.media}]</span>
      ) : null}
      {m.text ? <span className="whitespace-pre-wrap break-words">{m.text}</span> : null}
      <span className="self-end text-[10px] leading-none text-muted-foreground">{timeOf(m.date)}</span>
    </div>
  );
}
