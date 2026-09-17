import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { KeyRound, Plus, Search, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { GrokAccountDialog } from "@/components/grok/GrokAccountDialog";
import { GrokAppDialog } from "@/components/grok/GrokAppDialog";
import { GrokPoolRow, type PoolAccount, type PoolPatch } from "@/components/grok/GrokPoolRow";
import { useAuth } from "@/hooks/useAuth";
import { useGrokAccounts } from "@/hooks/useGrokAccounts";
import { useGrokAppAccounts } from "@/hooks/useGrokAppAccounts";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { deleteGrokAccount, getGrokAccountStatus, updateGrokAccount, type GrokAccountStatus } from "@/services/grokAccountService";
import { deleteGrokAppAccount, updateGrokAppAccount } from "@/services/grokAppAccountService";
import { grokLoginMethodLabel, grokLoginMethodOf } from "@/types/grokAccount";
import { grokAppProviderLabel, type GrokAppAccount, type GrokAppProvider } from "@/types/grokAppAccount";
import type { GrokAccount } from "@/types";
import { confirmDialog, promptDialog } from "@/utils/appDialog";
import { cn } from "@/utils/cn";
import { formatResetCountdown } from "@/utils/date";
import { displayNameOf } from "@/utils/displayName";

type SectionId = "grok" | "higgsfield" | "elevenlabs" | "other";
type StatusFilter = "all" | GrokAccountStatus;

const SECTIONS: { id: SectionId; title: string; subtitle: string; provider: GrokAppProvider | null }[] = [
  { id: "grok", title: "Грок", subtitle: "Grok", provider: null },
  { id: "higgsfield", title: "Хикс", subtitle: "Higgsfield", provider: "higgsfield" },
  { id: "elevenlabs", title: "11 Labs", subtitle: "ElevenLabs", provider: "elevenlabs" },
  { id: "other", title: "Другие", subtitle: "Suno и прочие", provider: "other" },
];

const STATUS_RANK: Record<GrokAccountStatus, number> = { available: 0, resetToday: 1, unavailable: 2 };
const GROUP_TITLE: Record<GrokAccountStatus, string> = {
  available: "Доступны",
  resetToday: "Восстановятся сегодня",
  unavailable: "Недоступны",
};
const SECTION_KEY = "nova-crm:grok-section";

function isSectionId(value: unknown): value is SectionId {
  return SECTIONS.some((s) => s.id === value);
}

function sectionOfProvider(provider: GrokAppProvider): SectionId {
  return provider === "higgsfield" || provider === "elevenlabs" ? provider : "other";
}

function readStoredSection(): SectionId | null {
  try {
    const value = window.localStorage.getItem(SECTION_KEY);
    return isSectionId(value) ? value : null;
  } catch {
    return null;
  }
}

type Entry = PoolAccount & { section: SectionId; raw: { kind: "grok"; account: GrokAccount } | { kind: "app"; account: GrokAppAccount } };

/**
 * Грок лимит — one pool of shared logins in three main sections (Грок,
 * Хикс = Higgsfield, 11 Labs = ElevenLabs, plus «Другие» when any exist).
 * Each section shows at a glance how many accounts work and when the next
 * one comes back; one search finds an account in every section; a row marks
 * a spent limit («Кончился на 3 часа») or a working account in one tap.
 */
export default function GrokLimitPage() {
  const { profile } = useAuth();
  const { role, roles, isResolved } = usePermissions();
  const canName = role === "owner" || role === "teamlead" || role === "admin";
  // Грок is closed only to a pure ОС; any other role of theirs opens it.
  const isOs = isResolved && roles.every((r) => r === "os");
  const { activeWorkspaceId } = useWorkspace();
  const workspaceId = isOs ? null : activeWorkspaceId;
  const { accounts: grokAccounts, isLoading: grokLoading } = useGrokAccounts(workspaceId);
  const { accounts: appAccounts, isLoading: appsLoading } = useGrokAppAccounts(workspaceId);
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [now, setNow] = useState(() => Date.now());
  const [grokDialog, setGrokDialog] = useState<{ open: boolean; editing: GrokAccount | null }>({ open: false, editing: null });
  const [appDialog, setAppDialog] = useState<{ open: boolean; editing: GrokAppAccount | null }>({ open: false, editing: null });
  const searchRef = useRef<HTMLInputElement>(null);

  const paramSection = searchParams.get("s");
  const section: SectionId = isSectionId(paramSection) ? paramSection : readStoredSection() ?? "grok";

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // «/» jumps to the search from anywhere on the page.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.closest("input, textarea, [contenteditable=true]") || target.isContentEditable)) return;
      e.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function selectSection(next: SectionId) {
    setFilter("all");
    try {
      window.localStorage.setItem(SECTION_KEY, next);
    } catch {
      // per-browser convenience only
    }
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set("s", next);
      return params;
    }, { replace: true });
  }

  const entries = useMemo<Entry[]>(() => {
    const fromGrok: Entry[] = grokAccounts.map((account) => ({
      key: `grok:${account.id}`,
      id: account.id,
      kind: "grok",
      section: "grok",
      serviceLabel: "Grok",
      nickname: account.nickname,
      email: account.email,
      password: account.password,
      phone: account.phone,
      methodLabel: grokLoginMethodLabel(grokLoginMethodOf(account.loginMethod)),
      available: account.available,
      limitResetAt: account.limitResetAt,
      updatedByName: account.updatedByName,
      updatedAt: account.updatedAt,
      raw: { kind: "grok", account },
    }));
    const fromApps: Entry[] = appAccounts.map((account) => ({
      key: `app:${account.id}`,
      id: account.id,
      kind: "app",
      section: sectionOfProvider(account.provider),
      serviceLabel: grokAppProviderLabel(account.provider, account.providerOther),
      nickname: account.nickname,
      email: account.email,
      password: account.password,
      phone: account.phone,
      note: account.note,
      methodLabel: grokLoginMethodLabel(grokLoginMethodOf(account.loginMethod)),
      available: account.available,
      limitResetAt: account.limitResetAt,
      updatedByName: account.updatedByName,
      updatedAt: account.updatedAt,
      raw: { kind: "app", account },
    }));
    const statusOf = (e: Entry) => getGrokAccountStatus({ available: e.available, limitResetAt: e.limitResetAt }, now);
    return [...fromGrok, ...fromApps].sort(
      (a, b) =>
        STATUS_RANK[statusOf(a)] - STATUS_RANK[statusOf(b)] ||
        (a.limitResetAt ?? Number.MAX_SAFE_INTEGER) - (b.limitResetAt ?? Number.MAX_SAFE_INTEGER) ||
        (a.nickname || a.email).localeCompare(b.nickname || b.email, "ru")
    );
  }, [grokAccounts, appAccounts, now]);

  const stats = useMemo(() => {
    const out = {} as Record<SectionId, { total: number; available: number; resetToday: number; unavailable: number; nextReset: number | null }>;
    for (const s of SECTIONS) out[s.id] = { total: 0, available: 0, resetToday: 0, unavailable: 0, nextReset: null };
    for (const e of entries) {
      const bucket = out[e.section];
      const status = getGrokAccountStatus({ available: e.available, limitResetAt: e.limitResetAt }, now);
      bucket.total += 1;
      bucket[status] += 1;
      if (status !== "available" && e.limitResetAt != null && e.limitResetAt > now) {
        bucket.nextReset = bucket.nextReset == null ? e.limitResetAt : Math.min(bucket.nextReset, e.limitResetAt);
      }
    }
    return out;
  }, [entries, now]);

  const shownSections = SECTIONS.filter((s) => s.id !== "other" || stats.other.total > 0 || section === "other");
  const q = query.trim().toLowerCase();
  const matches = (e: Entry) =>
    `${e.nickname ?? ""} ${e.email} ${e.phone ?? ""} ${e.note ?? ""} ${e.serviceLabel} ${e.methodLabel}`.toLowerCase().includes(q);
  const searching = q.length > 0;
  const visible = entries.filter((e) => {
    if (searching) return matches(e);
    if (e.section !== section) return false;
    return filter === "all" || getGrokAccountStatus({ available: e.available, limitResetAt: e.limitResetAt }, now) === filter;
  });
  const loading = grokLoading || appsLoading;
  const totalAvailable = SECTIONS.reduce((n, s) => n + stats[s.id].available, 0);
  const totalAccounts = entries.length;

  if (!activeWorkspaceId) return null;

  // ОС doesn't use Грок лимит (firestore.rules deny the collection to them too).
  if (isOs) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <ShieldCheck className="h-8 w-8 text-muted-foreground" />
        <p className="text-lg font-semibold">Доступ ограничен</p>
        <p className="text-sm text-muted-foreground">Грок лимит недоступен для роли ОС.</p>
      </div>
    );
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} скопирован`);
    } catch {
      toast.error("Не удалось скопировать");
    }
  }

  async function patchEntry(entry: Entry, patch: PoolPatch) {
    if (!profile) return;
    const name = displayNameOf(profile);
    if (entry.raw.kind === "grok") await updateGrokAccount(activeWorkspaceId!, entry.id, patch, profile.uid, name);
    else await updateGrokAppAccount(activeWorkspaceId!, entry.id, patch, profile.uid, name);
  }

  async function renameEntry(entry: Entry) {
    const next = await promptDialog({
      title: "Название аккаунта",
      description: "Видно всем вместо почты — чтобы быстро найти нужный.",
      defaultValue: entry.nickname ?? "",
      placeholder: "Например, Грок 3 / Хикс основной",
      maxLength: 40,
    });
    if (next === null) return;
    try {
      await patchEntry(entry, { nickname: next.trim() });
      toast.success("Название сохранено");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить");
    }
  }

  async function deleteEntry(entry: Entry) {
    if (!(await confirmDialog({ title: `Удалить ${entry.serviceLabel} «${entry.nickname?.trim() || entry.email}»?`, destructive: true }))) return;
    if (entry.raw.kind === "grok") await deleteGrokAccount(activeWorkspaceId!, entry.id);
    else await deleteGrokAppAccount(activeWorkspaceId!, entry.id);
    toast.success("Аккаунт удалён");
  }

  function editEntry(entry: Entry) {
    if (entry.raw.kind === "grok") setGrokDialog({ open: true, editing: entry.raw.account });
    else setAppDialog({ open: true, editing: entry.raw.account });
  }

  function openCreate() {
    if (section === "grok") setGrokDialog({ open: true, editing: null });
    else setAppDialog({ open: true, editing: null });
  }

  const current = SECTIONS.find((s) => s.id === section)!;
  const currentStats = stats[section];
  const filters: { id: StatusFilter; label: string; count: number; tone: string }[] = [
    { id: "all", label: "Все", count: currentStats.total, tone: "border-primary/50 bg-primary/15 text-primary" },
    { id: "available", label: "Доступны", count: currentStats.available, tone: "border-success/50 bg-success/15 text-success" },
    { id: "resetToday", label: "Сегодня", count: currentStats.resetToday, tone: "border-warning/50 bg-warning/15 text-warning" },
    { id: "unavailable", label: "Недоступны", count: currentStats.unavailable, tone: "border-destructive/50 bg-destructive/15 text-destructive" },
  ];
  const groups = (["available", "resetToday", "unavailable"] as GrokAccountStatus[])
    .map((status) => ({
      status,
      items: visible.filter((e) => getGrokAccountStatus({ available: e.available, limitResetAt: e.limitResetAt }, now) === status),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="flex h-full flex-col">
      <div className="page-header">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <KeyRound className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h1 className="page-title">Грок лимит</h1>
          {!loading && totalAccounts > 0 && (
            <p className="text-[11px] text-muted-foreground">
              доступно {totalAvailable} из {totalAccounts}
            </p>
          )}
        </div>
        <div className="flex-1" />
        <Button size="sm" className="gap-1.5" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Добавить в «{current.title}»</span>
          <span className="sm:hidden">Добавить</span>
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4 sm:p-6">
          <div className={cn("grid gap-2", shownSections.length > 3 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3")} role="tablist" aria-label="Разделы">
            {shownSections.map((s) => {
              const st = stats[s.id];
              const active = !searching && section === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setQuery("");
                    selectSection(s.id);
                  }}
                  className={cn(
                    "flex min-w-0 flex-col rounded-2xl border p-3 text-left transition-colors",
                    active
                      ? "border-primary/60 bg-primary/[0.08] shadow-[0_0_0_1px_hsl(var(--primary)/0.25)]"
                      : "border-border/70 bg-card/60 hover:border-primary/35 hover:bg-card"
                  )}
                >
                  <span className="flex min-w-0 items-baseline justify-between gap-2">
                    <span className="truncate text-[15px] font-semibold sm:text-base">{s.title}</span>
                    <span className="hidden truncate text-[10px] text-muted-foreground sm:inline">{s.subtitle}</span>
                  </span>
                  <span className="mt-2 flex items-baseline gap-1">
                    <span className={cn("text-2xl font-semibold leading-none", st.available > 0 ? "text-success" : "text-muted-foreground")}>
                      {st.available}
                    </span>
                    <span className="text-xs text-muted-foreground">/ {st.total}</span>
                  </span>
                  <span className="mt-0.5 text-[10px] text-muted-foreground">доступно</span>
                  <span className="mt-2 flex h-1.5 w-full gap-[2px] overflow-hidden rounded-full bg-muted/50" aria-hidden>
                    {st.available > 0 && <span className="h-full bg-success" style={{ flexGrow: st.available }} />}
                    {st.resetToday > 0 && <span className="h-full bg-warning" style={{ flexGrow: st.resetToday }} />}
                    {st.unavailable > 0 && <span className="h-full bg-destructive/80" style={{ flexGrow: st.unavailable }} />}
                  </span>
                  <span className="mt-1.5 truncate text-[10px] text-muted-foreground">
                    {st.total === 0
                      ? "пусто"
                      : st.nextReset
                        ? `ближайший ${formatResetCountdown(st.nextReset, now)}`
                        : st.available === st.total
                          ? "все работают"
                          : "время не указано"}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative sm:w-80">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setQuery("");
                }}
                placeholder="Найти во всех разделах  ( / )"
                className="h-9 pl-8 pr-8"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label="Очистить поиск"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            {!searching && (
              <div className="flex flex-wrap gap-1.5 sm:ml-auto">
                {filters.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setFilter(item.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                      filter === item.id
                        ? item.tone
                        : "border-border bg-background/40 text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    {item.label}
                    <span className="tabular-nums text-[10px] opacity-80">{item.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {loading && (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-14 rounded-xl" />
              <Skeleton className="h-14 rounded-xl" />
              <Skeleton className="h-14 rounded-xl" />
            </div>
          )}

          {!loading && searching && visible.length === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground">Ничего не нашли во всех разделах.</p>
          )}
          {!loading && !searching && currentStats.total === 0 && (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border py-12 text-center">
              <p className="text-sm text-muted-foreground">В «{current.title}» пока нет аккаунтов.</p>
              <Button size="sm" className="gap-1.5" onClick={openCreate}>
                <Plus className="h-4 w-4" /> Добавить аккаунт
              </Button>
            </div>
          )}
          {!loading && !searching && currentStats.total > 0 && visible.length === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground">Под этот фильтр ничего нет.</p>
          )}

          {!loading &&
            groups.map((group) => (
              <section key={group.status} className="flex flex-col gap-2">
                <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {GROUP_TITLE[group.status]}
                  <span className="tabular-nums">{group.items.length}</span>
                </h2>
                <ul className="flex flex-col gap-1.5">
                  {group.items.map((entry) => (
                    <GrokPoolRow
                      key={entry.key}
                      account={entry}
                      now={now}
                      showService={searching || entry.section === "other"}
                      canRename={canName}
                      onPatch={(patch) => patchEntry(entry, patch)}
                      onCopy={copyText}
                      onEdit={() => editEntry(entry)}
                      onRename={() => void renameEntry(entry)}
                      onDelete={() => void deleteEntry(entry)}
                    />
                  ))}
                </ul>
              </section>
            ))}
        </div>
      </div>

      <GrokAccountDialog
        open={grokDialog.open}
        onOpenChange={(open) => setGrokDialog((prev) => ({ ...prev, open }))}
        editing={grokDialog.editing}
        accounts={grokAccounts}
      />
      <GrokAppDialog
        open={appDialog.open}
        onOpenChange={(open) => setAppDialog((prev) => ({ ...prev, open }))}
        editing={appDialog.editing}
        accounts={appAccounts}
        defaultProvider={current.provider ?? "elevenlabs"}
      />
    </div>
  );
}
