import { useMemo, useState } from "react";
import { Ban, CheckCircle2, Clock3, Copy, Eye, EyeOff, KeyRound, Plus, RefreshCw, Search, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { EmptyState } from "@/components/common/EmptyState";
import { GrokAccountDialog } from "@/components/grok/GrokAccountDialog";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useAuth } from "@/hooks/useAuth";
import { useGrokAccounts } from "@/hooks/useGrokAccounts";
import { deleteGrokAccount, getGrokAccountStatus, isGrokAccountAvailable, updateGrokAccount, type GrokAccountStatus } from "@/services/grokAccountService";
import { displayNameOf } from "@/utils/displayName";
import {
  autoFormatManualDateTimeInput,
  formatDate,
  formatDateTimeManual,
  parseDateTimeManual,
  timeAgo,
  MANUAL_DATETIME_PLACEHOLDER,
} from "@/utils/date";
import { cn } from "@/utils/cn";
import type { GrokAccount } from "@/types";

type StatusFilter = "all" | GrokAccountStatus;

const STATUS_META: Record<GrokAccountStatus, { label: string; rail: string; card: string }> = {
  available: {
    label: "Доступно",
    rail: "bg-success",
    card: "border-success/25",
  },
  resetToday: {
    label: "Сегодня",
    rail: "bg-warning",
    card: "border-warning/30",
  },
  unavailable: {
    label: "Недоступно",
    rail: "bg-destructive",
    card: "border-destructive/25",
  },
};

export default function GrokLimitPage() {
  const { activeWorkspaceId } = useWorkspace();
  const { accounts, isLoading } = useGrokAccounts(activeWorkspaceId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<GrokAccount | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");

  const counts = useMemo(() => {
    const next = { all: accounts.length, available: 0, resetToday: 0, unavailable: 0 };
    for (const account of accounts) next[getGrokAccountStatus(account)] += 1;
    return next;
  }, [accounts]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return accounts.filter((account) => {
      if (filter !== "all" && getGrokAccountStatus(account) !== filter) return false;
      if (q && !account.email.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [accounts, filter, query]);

  if (!activeWorkspaceId) return null;

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function toggleReveal(id: string) {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} скопирован`);
    } catch {
      toast.error("Не удалось скопировать");
    }
  }

  async function handleDelete(account: GrokAccount) {
    if (!window.confirm(`Удалить аккаунт «${account.email}»?`)) return;
    await deleteGrokAccount(activeWorkspaceId!, account.id);
    toast.success("Аккаунт удалён");
  }

  const filters: { id: StatusFilter; label: string; count: number }[] = [
    { id: "all", label: "Все", count: counts.all },
    { id: "available", label: "Доступно", count: counts.available },
    { id: "resetToday", label: "Сегодня", count: counts.resetToday },
    { id: "unavailable", label: "Недоступно", count: counts.unavailable },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="page-header">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <KeyRound className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h1 className="page-title">Грок лимит</h1>
          {!isLoading && accounts.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {counts.available} доступны · {counts.resetToday} сегодня · {counts.unavailable} заняты
            </p>
          )}
        </div>
        <div className="flex-1" />
        <Button size="sm" className="gap-1.5" onClick={openCreate}>
          <Plus className="h-4 w-4" /> Добавить аккаунт
        </Button>
      </div>

      <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:px-6">
        <div className="flex flex-wrap gap-1.5">
          {filters.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                filter === item.id
                  ? "border-primary/50 bg-primary/15 text-primary"
                  : "border-border bg-background/40 text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {item.label}
              <span className="tabular-nums text-[10px] opacity-80">{item.count}</span>
            </button>
          ))}
        </div>
        <div className="relative flex-1 sm:max-w-xs sm:ml-auto">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по email..."
            className="h-8 pl-8"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {isLoading && (
            <>
              <Skeleton className="h-36 rounded-xl" />
              <Skeleton className="h-36 rounded-xl" />
              <Skeleton className="h-36 rounded-xl" />
            </>
          )}

          {!isLoading && accounts.length === 0 && (
            <EmptyState
              eyebrow="Пул аккаунтов"
              title="Пока нет аккаунтов"
              description="Добавьте первый Grok-аккаунт — статус и лимит будут видны всей команде сразу."
              action={
                <Button size="sm" className="gap-1.5" onClick={openCreate}>
                  <Plus className="h-4 w-4" /> Добавить аккаунт
                </Button>
              }
            />
          )}

          {!isLoading && accounts.length > 0 && visible.length === 0 && (
            <p className="py-16 text-center text-sm text-muted-foreground">
              Ничего не нашлось по этому фильтру.
            </p>
          )}

          {visible.map((account) => {
            const status = getGrokAccountStatus(account);
            const meta = STATUS_META[status];
            const isRevealed = revealed.has(account.id);
            return (
              <Card key={account.id} className={cn("hud-frame glass-panel overflow-hidden", meta.card)}>
                <CardContent className="relative p-0">
                  <span className={cn("absolute inset-y-0 left-0 w-1", meta.rail)} aria-hidden />
                  <div className="flex flex-col gap-3 p-4 pl-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-[15px] font-medium tracking-[-0.01em]">{account.email}</span>
                          <button
                            type="button"
                            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                            title="Копировать email"
                            onClick={() => copyText(account.email, "Email")}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="mt-2 inline-flex items-center gap-1 rounded-lg border border-border/70 bg-background/40 px-2 py-1">
                          <span className="font-mono text-xs tabular-nums text-muted-foreground">
                            {isRevealed ? account.password || "—" : "•".repeat(Math.max(6, account.password.length))}
                          </span>
                          <button
                            type="button"
                            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                            title={isRevealed ? "Скрыть пароль" : "Показать пароль"}
                            onClick={() => toggleReveal(account.id)}
                          >
                            {isRevealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </button>
                          {account.password && (
                            <button
                              type="button"
                              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                              title="Копировать пароль"
                              onClick={() => copyText(account.password, "Пароль")}
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-col items-stretch gap-1.5 sm:items-end">
                        <AvailabilityToggle account={account} />
                        <ActualizePopover account={account} />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
                          status === "resetToday"
                            ? "border-warning/40 bg-warning/10 text-warning"
                            : "border-border/70 bg-background/30"
                        )}
                      >
                        <Clock3 className="h-3 w-3" />
                        {account.limitResetAt != null ? (
                          <span className="font-medium text-foreground">{formatDate(account.limitResetAt)}</span>
                        ) : (
                          "лимит не указан"
                        )}
                      </span>
                      <span className="ml-auto text-[11px]">
                        Актуализировал <span className="font-medium text-foreground">{account.updatedByName}</span>
                        {" · "}
                        {timeAgo(account.updatedAt)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Редактировать"
                        onClick={() => {
                          setEditing(account);
                          setDialogOpen(true);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        title="Удалить"
                        onClick={() => handleDelete(account)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <GrokAccountDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        accounts={accounts}
      />
    </div>
  );
}

function AvailabilityToggle({ account }: { account: GrokAccount }) {
  const { profile } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const [isSaving, setIsSaving] = useState(false);
  const available = isGrokAccountAvailable(account);
  const status = getGrokAccountStatus(account);

  async function toggle() {
    if (!activeWorkspaceId || !profile) return;
    setIsSaving(true);
    try {
      await updateGrokAccount(
        activeWorkspaceId,
        account.id,
        { available: !available },
        profile.uid,
        displayNameOf(profile)
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось обновить");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Button
      disabled={isSaving}
      onClick={toggle}
      title={
        available
          ? "Отметить как недоступный"
          : status === "resetToday"
            ? "Восстанавливается сегодня — отметить как доступный"
            : "Отметить как доступный"
      }
      className={cn(
        "h-11 min-w-[148px] gap-2 rounded-xl border-2 px-4 text-sm font-semibold shadow-sm transition-all hover:-translate-y-px hover:shadow-md active:translate-y-0 active:scale-[0.97] active:shadow-none",
        status === "available" && "border-success/50 bg-success/15 text-success hover:bg-success/25",
        status === "resetToday" && "border-warning/50 bg-warning/15 text-warning hover:bg-warning/25",
        status === "unavailable" && "border-destructive/50 bg-destructive/15 text-destructive hover:bg-destructive/25"
      )}
    >
      {status === "available" ? (
        <CheckCircle2 className="h-4 w-4" />
      ) : status === "resetToday" ? (
        <Clock3 className="h-4 w-4" />
      ) : (
        <Ban className="h-4 w-4" />
      )}
      {STATUS_META[status].label}
    </Button>
  );
}

function ActualizePopover({ account }: { account: GrokAccount }) {
  const { profile } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(() => formatDateTimeManual(account.limitResetAt));
  const [isSaving, setIsSaving] = useState(false);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) setValue(formatDateTimeManual(account.limitResetAt));
  }

  const parsed = parseDateTimeManual(value);
  const invalid = parsed === undefined;

  async function save() {
    if (!activeWorkspaceId || !profile || invalid) return;
    setIsSaving(true);
    try {
      await updateGrokAccount(
        activeWorkspaceId,
        account.id,
        { limitResetAt: parsed ?? null },
        profile.uid,
        displayNameOf(profile)
      );
      toast.success("Актуализировано");
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось обновить");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5" title="Указать/обновить время восстановления">
          <RefreshCw className="h-3.5 w-3.5" />
          Актуализировать
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="end">
        <p className="mb-2 text-sm font-medium">Когда восстановится лимит?</p>
        <Input
          value={value}
          onChange={(e) => setValue(autoFormatManualDateTimeInput(e.target.value))}
          inputMode="numeric"
          placeholder={MANUAL_DATETIME_PLACEHOLDER}
          autoFocus
          className={cn("tabular-nums", invalid && "border-destructive focus-visible:ring-destructive")}
          onKeyDown={(e) => {
            if (e.code === "Enter" && !invalid) save();
          }}
        />
        <p className={cn("mt-1.5 text-xs text-muted-foreground", invalid && "text-destructive")}>
          Формат: {MANUAL_DATETIME_PLACEHOLDER} — оставьте пустым, если неизвестно
        </p>
        <div className="mt-3 flex justify-end">
          <Button size="sm" className="h-7 gap-1.5" onClick={save} disabled={isSaving || invalid}>
            Сохранить
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
