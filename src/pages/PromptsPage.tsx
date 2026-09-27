import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  ChevronDown,
  Copy,
  ImagePlus,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Users,
  UserPen,
  X,
} from "lucide-react";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { PageHeader, pageChipClass } from "@/components/common/PageHeader";
import { GrokPeoplePicker, GrokPickerShell } from "@/components/grok/GrokPeoplePicker";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useUrlState } from "@/hooks/useUrlState";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  copyText,
  deletePrompt,
  discardPromptPhoto,
  matchesPrompt,
  refreshPrompts,
  requestPromptAccess,
  resolvePromptRequest,
  revokePromptAccess,
  savePrompt,
  setPromptWriters,
  uploadPromptPhoto,
  usePrompts,
  type Prompt,
  type PromptKind,
  type PromptRequest,
  type PromptStub,
  type PromptsData,
} from "@/services/promptService";
import { confirmDialog } from "@/utils/appDialog";
import { cn } from "@/utils/cn";
import { myDisplayName } from "@/utils/displayName";
import { personLabel } from "@/utils/peopleDesks";
import type { WorkspaceMember } from "@/types";

type Tab = "mine" | "shared";

/**
 * «Промты» (просьба Nurba 27.09.2026): «Мои» и «Общие». Нажатие на панель —
 * промт уже в буфере обмена; сам текст не показывается, его раскрывает
 * маленькая стрелка. Форма — прямо на странице, без окон. Права держит база
 * (SQL 20261034): чужой личный промт экран получает только названием.
 */
export default function PromptsPage() {
  const { activeWorkspaceId, members } = useWorkspace();
  const { profile } = useAuth();
  const permissions = usePermissions();
  const uid = profile?.uid ?? "";
  const ws = activeWorkspaceId ?? "";
  const snap = usePrompts(activeWorkspaceId);
  const [tab, setTab] = useUrlState<Tab>("v", "mine", { values: ["mine", "shared"] });
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<Prompt | "new" | null>(null);
  const [writersOpen, setWritersOpen] = useState(false);
  const sender = useMemo(() => ({ uid, name: myDisplayName(profile, members) }), [uid, profile, members]);
  const byUid = useMemo(() => new Map(members.map((m) => [m.uid, m])), [members]);
  const data = snap.data;

  const header = (
    <PageHeader
      className="mb-0"
      eyebrow="Работа"
      title="Промты"
      description="Нажмите на промт — он скопирован. Стрелка справа раскрывает текст и фото результата."
      actions={
        data ? (
          <div className="flex flex-wrap gap-2">
            {data.isOwner ? (
              <Button variant="outline" size="sm" className="min-h-11 sm:min-h-9" onClick={() => setWritersOpen(true)}>
                <UserPen className="h-4 w-4" />
                Кто пишет общие · {data.writers.length}
              </Button>
            ) : null}
            <Button size="sm" className="min-h-11 sm:min-h-9" onClick={() => setForm("new")} disabled={form !== null}>
              <Plus className="h-4 w-4" />
              Промт
            </Button>
          </div>
        ) : null
      }
    />
  );

  if (!permissions.isResolved || snap.status === "idle" || (snap.status === "loading" && !data)) {
    return (
      <Shell>
        {header}
        <Skeleton className="h-10 rounded-lg" />
        <Skeleton className="h-14 rounded-lg" />
        <Skeleton className="h-14 rounded-lg" />
      </Shell>
    );
  }

  if (!data) {
    return (
      <Shell>
        {header}
        {snap.status === "missing" ? (
          <Alert tone="warning" title="Промты ещё не включены в базе">
            Они заработают после ближайшего обновления сайта (SQL накатывается при выкладке).
          </Alert>
        ) : (
          <Alert
            tone="error"
            title="Не удалось загрузить промты"
            action={
              <Button variant="outline" size="sm" onClick={() => void refreshPrompts(ws)}>
                <RefreshCw className="h-3.5 w-3.5" /> Повторить
              </Button>
            }
          >
            Проверьте связь и попробуйте ещё раз.
          </Alert>
        )}
      </Shell>
    );
  }

  const mine = data.prompts.filter((p) => p.authorUid === uid && matchesPrompt(p, query));
  const shared = data.prompts.filter((p) => p.kind === "shared" && matchesPrompt(p, query));
  const granted = data.prompts.filter((p) => p.granted && matchesPrompt(p, query));
  const stubs = data.stubs.filter((s) => matchesPrompt(s, query));
  const mineTotal = data.prompts.filter((p) => p.authorUid === uid).length;
  const sharedTotal = data.prompts.filter((p) => p.kind === "shared").length;

  return (
    <Shell>
      {header}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={pageChipClass(tab === "mine")} aria-pressed={tab === "mine"} onClick={() => setTab("mine")}>
          Мои · {mineTotal}
          {data.requests.length ? (
            <span className="ml-1 rounded-full bg-warning/20 px-1.5 text-[11px] font-semibold text-warning">просят {data.requests.length}</span>
          ) : null}
        </button>
        <button type="button" className={pageChipClass(tab === "shared")} aria-pressed={tab === "shared"} onClick={() => setTab("shared")}>
          Общие · {sharedTotal}
        </button>
        <div className="relative ml-auto w-full min-w-0 sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Найти промт" className="h-9 pl-8" aria-label="Найти промт" />
        </div>
      </div>

      {form ? (
        <PromptForm
          key={form === "new" ? "new" : form.id}
          ws={ws}
          uid={uid}
          prompt={form === "new" ? null : form}
          canWriteShared={data.canWriteShared}
          defaultKind={tab === "shared" && data.canWriteShared ? "shared" : "personal"}
          onDone={() => setForm(null)}
        />
      ) : null}

      {tab === "mine" ? (
        <>
          {data.requests.length ? <RequestsPanel ws={ws} data={data} byUid={byUid} sender={sender} /> : null}
          <PromptList
            prompts={mine}
            empty={query ? "Ничего не нашлось." : "Здесь будут ваши промты. Личные видите только вы — коллега может попросить доступ."}
            ws={ws}
            uid={uid}
            isOwner={data.isOwner}
            byUid={byUid}
            onEdit={(p) => setForm(p)}
          />
        </>
      ) : (
        <>
          <PromptList
            prompts={shared}
            empty={
              query
                ? "Ничего не нашлось."
                : data.canWriteShared
                  ? "Общих промтов пока нет — добавьте первый: «+ Промт» → «Общий»."
                  : "Общих промтов пока нет. Писать их может тот, кому Owner разрешил."
            }
            ws={ws}
            uid={uid}
            isOwner={data.isOwner}
            byUid={byUid}
            onEdit={(p) => setForm(p)}
          />
          {granted.length ? (
            <Group title="Открытые вам">
              <PromptList prompts={granted} empty="" ws={ws} uid={uid} isOwner={data.isOwner} byUid={byUid} onEdit={() => {}} />
            </Group>
          ) : null}
          {stubs.length ? (
            <Group title="Личные промты коллег" hint="Текст видит только автор — попросите доступ.">
              <div className="flex flex-col gap-1.5">
                {stubs.map((s) => (
                  <StubRow key={s.id} ws={ws} stub={s} author={byUid.get(s.authorUid)} sender={sender} />
                ))}
              </div>
            </Group>
          ) : null}
        </>
      )}

      {writersOpen ? (
        <WritersDialog
          members={members}
          initial={data.writers}
          onClose={() => setWritersOpen(false)}
          onSave={(next) => setPromptWriters(ws, next)}
        />
      ) : null}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-3 p-4 sm:p-8">{children}</div>;
}

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mt-2 flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline gap-x-2 px-1">
        <h2 className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{title}</h2>
        {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------
// Список и карточка.
// ---------------------------------------------------------------------

function PromptList({
  prompts,
  empty,
  ws,
  uid,
  isOwner,
  byUid,
  onEdit,
}: {
  prompts: Prompt[];
  empty: string;
  ws: string;
  uid: string;
  isOwner: boolean;
  byUid: Map<string, WorkspaceMember>;
  onEdit: (p: Prompt) => void;
}) {
  if (!prompts.length) {
    return empty ? <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">{empty}</p> : null;
  }
  return (
    <div className="flex flex-col gap-1.5">
      {prompts.map((p) => (
        <PromptCard key={p.id} prompt={p} ws={ws} uid={uid} isOwner={isOwner} byUid={byUid} onEdit={onEdit} />
      ))}
    </div>
  );
}

function PromptCard({
  prompt,
  ws,
  uid,
  isOwner,
  byUid,
  onEdit,
}: {
  prompt: Prompt;
  ws: string;
  uid: string;
  isOwner: boolean;
  byUid: Map<string, WorkspaceMember>;
  onEdit: (p: Prompt) => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [zoom, setZoom] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  const mineAuthor = prompt.authorUid === uid;
  const canEdit = mineAuthor || (prompt.kind === "shared" && isOwner);
  const author = byUid.get(prompt.authorUid);

  const copy = async () => {
    const ok = await copyText(prompt.body);
    if (!ok) {
      toast.error("Не удалось скопировать — раскройте промт и выделите текст.");
      return;
    }
    setCopied(true);
    toast.success(`Скопировано: ${prompt.title}`, { duration: 1500 });
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div
      className={cn(
        "rounded-lg border bg-card transition-colors",
        copied ? "border-success/60" : "border-border",
        open && "border-primary/40"
      )}
      data-prompt={prompt.id}
    >
      <div className="flex min-h-14 items-stretch">
        <button
          type="button"
          onClick={() => void copy()}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-l-lg px-3 py-2 text-left hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          title="Нажмите — промт скопирован"
          aria-label={`Скопировать промт «${prompt.title}»`}
        >
          {prompt.photoUrl ? (
            <img src={prompt.photoUrl} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-md border border-border object-cover" />
          ) : null}
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[14px] font-medium">{prompt.title}</span>
              {prompt.kind === "personal" && mineAuthor ? (
                <Lock className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="личный" />
              ) : null}
              {prompt.kind === "shared" && mineAuthor ? (
                <span className="shrink-0 rounded bg-primary/10 px-1 text-[10px] font-medium text-primary">общий</span>
              ) : null}
            </span>
            {prompt.purpose || prompt.granted || (prompt.kind === "shared" && !mineAuthor) ? (
              <span className="block truncate text-[12px] text-muted-foreground">
                {prompt.purpose}
                {(prompt.granted || (prompt.kind === "shared" && !mineAuthor)) && author ? (
                  <span className="opacity-70">{prompt.purpose ? " · " : ""}{personLabel(author)}</span>
                ) : null}
              </span>
            ) : null}
          </span>
          <span className={cn("shrink-0", copied ? "text-success" : "text-muted-foreground/60")} aria-hidden>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-3.5 w-3.5" />}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Свернуть" : "Раскрыть"}
          aria-expanded={open}
          className="flex w-11 shrink-0 items-center justify-center rounded-r-lg border-l border-border text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        >
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        </button>
      </div>

      {open ? (
        <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3 font-mono text-[12.5px] leading-relaxed">
            {prompt.body}
          </pre>
          {prompt.photoUrl ? (
            <button type="button" onClick={() => setZoom(true)} className="self-start" aria-label="Открыть фото крупно">
              <img src={prompt.photoUrl} alt={`Результат: ${prompt.title}`} loading="lazy" className="max-h-48 max-w-full rounded-md border border-border object-contain" />
            </button>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" className="min-h-11 sm:min-h-8" onClick={() => void copy()}>
              <Copy className="h-3.5 w-3.5" /> Копировать
            </Button>
            {canEdit ? (
              <Button size="sm" variant="outline" className="min-h-11 sm:min-h-8" onClick={() => onEdit(prompt)}>
                <Pencil className="h-3.5 w-3.5" /> Изменить
              </Button>
            ) : null}
            {canEdit ? (
              <Button
                size="sm"
                variant="ghost"
                className="min-h-11 text-destructive hover:text-destructive sm:min-h-8"
                onClick={async () => {
                  const ok = await confirmDialog({
                    title: "Удалить промт?",
                    description: `«${prompt.title}» пропадёт у всех, кому он виден.`,
                    confirmLabel: "Удалить",
                    destructive: true,
                  });
                  if (!ok) return;
                  try {
                    await deletePrompt(ws, prompt);
                    toast.success("Промт удалён");
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Не удалось удалить");
                  }
                }}
              >
                <Trash2 className="h-3.5 w-3.5" /> Удалить
              </Button>
            ) : null}
            {!mineAuthor && author ? (
              <span className="ml-auto text-[11px] text-muted-foreground">
                {prompt.granted ? "личный · " : ""}автор: {personLabel(author)}
              </span>
            ) : null}
          </div>
          {prompt.kind === "personal" && mineAuthor ? <AccessList ws={ws} prompt={prompt} byUid={byUid} /> : null}
        </div>
      ) : null}

      {zoom && prompt.photoUrl ? (
        <Dialog open onOpenChange={(v) => !v && setZoom(false)}>
          <DialogContent className="max-w-3xl p-2">
            <DialogTitle className="sr-only">{prompt.title}</DialogTitle>
            <img src={prompt.photoUrl} alt={`Результат: ${prompt.title}`} className="max-h-[80dvh] w-full rounded-md object-contain" />
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

function AccessList({ ws, prompt, byUid }: { ws: string; prompt: Prompt; byUid: Map<string, WorkspaceMember> }) {
  if (!prompt.access.length) {
    return <p className="text-[11px] text-muted-foreground">Личный — виден только вам. Коллеги могут попросить доступ.</p>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-muted-foreground">Открыт:</span>
      {prompt.access.map((u) => {
        const m = byUid.get(u);
        return (
          <span key={u} className="inline-flex items-center gap-1 rounded-full border border-border py-0.5 pl-2 pr-0.5 text-[12px]">
            {m ? personLabel(m) : "бывший участник"}
            <button
              type="button"
              className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Снять доступ"
              title="Снять доступ"
              onClick={async () => {
                try {
                  await revokePromptAccess(ws, prompt.id, u);
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Не удалось снять доступ");
                }
              }}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------
// Чужие личные: только название и «Запросить доступ».
// ---------------------------------------------------------------------

function StubRow({
  ws,
  stub,
  author,
  sender,
}: {
  ws: string;
  stub: PromptStub;
  author: WorkspaceMember | undefined;
  sender: { uid: string; name: string };
}) {
  const [busy, setBusy] = useState(false);
  const pending = stub.request === "pending";
  return (
    <div className="flex min-h-12 items-center gap-3 rounded-lg border border-dashed border-border px-3 py-1.5">
      <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px]">{stub.title}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{author ? personLabel(author) : "бывший участник"}</span>
      </span>
      <Button
        size="sm"
        variant={pending ? "ghost" : "outline"}
        className="min-h-11 shrink-0 sm:min-h-8"
        disabled={busy || pending}
        onClick={async () => {
          setBusy(true);
          try {
            await requestPromptAccess(ws, stub, sender);
            toast.success("Запрос отправлен автору");
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Не удалось отправить запрос");
          } finally {
            setBusy(false);
          }
        }}
      >
        {pending ? "Запрошено" : stub.request === "rejected" ? "Отказали · ещё раз" : "Запросить доступ"}
      </Button>
    </div>
  );
}

function RequestsPanel({
  ws,
  data,
  byUid,
  sender,
}: {
  ws: string;
  data: PromptsData;
  byUid: Map<string, WorkspaceMember>;
  sender: { uid: string; name: string };
}) {
  const titles = new Map(data.prompts.map((p) => [p.id, p.title]));
  const act = async (r: PromptRequest, approve: boolean) => {
    try {
      await resolvePromptRequest(ws, r, approve, sender);
      toast.success(approve ? "Доступ открыт" : "Отклонено");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось");
    }
  };
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-warning/40 bg-warning/5 p-2">
      <div className="flex items-center gap-1.5 px-1 text-[12px] font-medium text-warning">
        <Users className="h-3.5 w-3.5" /> Просят доступ · {data.requests.length}
      </div>
      {data.requests.map((r) => {
        const m = byUid.get(r.uid);
        return (
          <div key={`${r.promptId}:${r.uid}`} className="flex flex-wrap items-center gap-2 rounded-md bg-card px-2 py-1.5">
            {m ? <MemberAvatar id={m.uid} name={m.name} nickname={m.nickname} photoURL={m.photoURL} className="h-7 w-7 shrink-0" /> : null}
            <span className="min-w-0 flex-1 text-[13px]">
              <span className="font-medium">{m ? personLabel(m) : "бывший участник"}</span>
              <span className="text-muted-foreground"> → «{titles.get(r.promptId) ?? "промт"}»</span>
            </span>
            <div className="flex gap-1.5">
              <Button size="sm" className="min-h-11 sm:min-h-8" onClick={() => void act(r, true)}>
                Открыть
              </Button>
              <Button size="sm" variant="ghost" className="min-h-11 sm:min-h-8" onClick={() => void act(r, false)}>
                Отклонить
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------
// Форма — прямо на странице.
// ---------------------------------------------------------------------

function PromptForm({
  ws,
  uid,
  prompt,
  canWriteShared,
  defaultKind,
  onDone,
}: {
  ws: string;
  uid: string;
  prompt: Prompt | null;
  canWriteShared: boolean;
  defaultKind: PromptKind;
  onDone: (saved: Prompt | null) => void;
}) {
  const [kind, setKind] = useState<PromptKind>(prompt?.kind ?? defaultKind);
  const [title, setTitle] = useState(prompt?.title ?? "");
  const [purpose, setPurpose] = useState(prompt?.purpose ?? "");
  const [body, setBody] = useState(prompt?.body ?? "");
  const [photo, setPhoto] = useState<{ url: string; path: string } | null>(
    prompt?.photoUrl && prompt.photoPath ? { url: prompt.photoUrl, path: prompt.photoPath } : null
  );
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  // Загруженные в этой форме, но не сохранённые фото — стереть при отмене.
  const fresh = useRef<Set<string>>(new Set());

  useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.scrollIntoView({ block: "nearest" });
  }, []);

  const cancel = () => {
    for (const path of fresh.current) discardPromptPhoto(path);
    onDone(null);
  };

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const next = await uploadPromptPhoto(ws, uid, file);
      if (photo && fresh.current.has(photo.path)) {
        discardPromptPhoto(photo.path);
        fresh.current.delete(photo.path);
      }
      fresh.current.add(next.path);
      setPhoto(next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Фото не загрузилось");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const save = async () => {
    if (!title.trim()) return toast.error("Впишите название.");
    if (!body.trim()) return toast.error("Впишите сам промт.");
    setBusy(true);
    try {
      const saved = await savePrompt(
        ws,
        { id: prompt?.id ?? null, kind, title, purpose, body, photoUrl: photo?.url ?? null, photoPath: photo?.path ?? null },
        prompt?.photoPath ?? null
      );
      // Неиспользованные загрузки этой формы (заменили до сохранения) — стереть.
      for (const path of fresh.current) if (path !== photo?.path) discardPromptPhoto(path);
      fresh.current.clear();
      toast.success(prompt ? "Сохранено" : "Промт добавлен");
      onDone(saved);
    } catch (error) {
      if (photo) fresh.current.delete(photo.path);
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-2.5 rounded-lg border border-primary/40 bg-card p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          cancel();
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-medium">{prompt ? "Изменить промт" : "Новый промт"}</span>
        {!prompt && canWriteShared ? (
          <div className="ml-auto flex rounded-md border border-border p-0.5" role="group" aria-label="Вид промта">
            {(["personal", "shared"] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
                className={cn(
                  "min-h-9 rounded px-3 text-[12px] sm:min-h-7",
                  kind === k ? "bg-primary/12 text-primary" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {k === "personal" ? "Личный" : "Общий"}
              </button>
            ))}
          </div>
        ) : (
          <span className="ml-auto text-[11px] text-muted-foreground">{kind === "shared" ? "общий — видят все" : "личный — видите только вы"}</span>
        )}
      </div>
      <Input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название" maxLength={120} aria-label="Название" />
      <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Для чего (необязательно)" maxLength={300} aria-label="Для чего" />
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Сам промт"
        rows={6}
        maxLength={20000}
        aria-label="Промт"
        className="font-mono text-[13px]"
      />
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => void pickPhoto(e.target.files?.[0])}
        />
        {photo ? (
          <span className="inline-flex items-center gap-2">
            <img src={photo.url} alt="" className="h-10 w-10 rounded-md border border-border object-cover" />
            <Button type="button" size="sm" variant="ghost" className="min-h-11 sm:min-h-8" onClick={() => fileRef.current?.click()} disabled={uploading}>
              Заменить
            </Button>
            <Button type="button" size="sm" variant="ghost" className="min-h-11 sm:min-h-8" onClick={() => setPhoto(null)} disabled={uploading}>
              Убрать
            </Button>
          </span>
        ) : (
          <Button type="button" size="sm" variant="outline" className="min-h-11 sm:min-h-8" onClick={() => fileRef.current?.click()} disabled={uploading}>
            <ImagePlus className="h-3.5 w-3.5" />
            {uploading ? "Загружаю…" : "Фото результата"}
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-8" onClick={cancel} disabled={busy}>
            Отмена
          </Button>
          <Button type="submit" size="sm" className="min-h-11 sm:min-h-8" disabled={busy || uploading}>
            {busy ? "Сохраняю…" : "Сохранить"}
          </Button>
        </div>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------
// Кто пишет общие — только Owner.
// ---------------------------------------------------------------------

function WritersDialog({
  members,
  initial,
  onClose,
  onSave,
}: {
  members: WorkspaceMember[];
  initial: string[];
  onClose: () => void;
  onSave: (next: string[]) => Promise<void>;
}) {
  const candidates = useMemo(
    () =>
      members
        .filter((m) => m.uid && m.status !== "invited" && m.role !== "owner")
        .sort((a, b) => personLabel(a).localeCompare(personLabel(b), "ru")),
    [members]
  );
  const known = useMemo(() => new Set(candidates.map((m) => m.uid)), [candidates]);
  const [selected, setSelected] = useState(() => initial.filter((u) => known.has(u)));
  const [busy, setBusy] = useState(false);
  return (
    <GrokPickerShell
      icon={<UserPen className="h-4 w-4 text-primary" />}
      title="Кто пишет общие промты"
      description="Отмеченные добавляют общие промты и правят свои. Остальные делают себе личные. Owner может всегда."
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} className="ml-auto">
            Отмена
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave(selected);
                toast.success("Сохранено");
                onClose();
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Не удалось сохранить");
              } finally {
                setBusy(false);
              }
            }}
          >
            Сохранить · {selected.length}
          </Button>
        </>
      }
    >
      <GrokPeoplePicker candidates={candidates} selected={selected} onChange={setSelected} />
    </GrokPickerShell>
  );
}
