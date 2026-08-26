import { useMemo, useState } from "react";
import { Clock3, KeyRound, Plus, Search, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { EmptyState } from "@/components/common/EmptyState";
import { GrokAppDialog } from "@/components/grok/GrokAppDialog";
import { GrokLimitSubnav } from "@/components/grok/GrokLimitSubnav";
import { SecretRow } from "@/components/grok/SecretRow";
import { ActualizePopover, AvailabilityToggle } from "@/components/grok/GrokStatusControls";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useAuth } from "@/hooks/useAuth";
import { useGrokAppAccounts } from "@/hooks/useGrokAppAccounts";
import { deleteGrokAppAccount, getGrokAccountStatus, updateGrokAppAccount } from "@/services/grokAppAccountService";
import { displayNameOf } from "@/utils/displayName";
import { formatDate, timeAgo } from "@/utils/date";
import { grokLoginMethodLabel, grokLoginMethodOf } from "@/types/grokAccount";
import { GROK_APP_PROVIDERS, grokAppProviderLabel, type GrokAppAccount, type GrokAppProvider } from "@/types/grokAppAccount";
import { cn } from "@/utils/cn";

type ProviderFilter = "all" | GrokAppProvider;

const STATUS_CARD = {
  available: "border-success/25",
  resetToday: "border-warning/30",
  unavailable: "border-destructive/25",
} as const;

const STATUS_RAIL = {
  available: "bg-success",
  resetToday: "bg-warning",
  unavailable: "bg-destructive",
} as const;

export default function GrokAppsPage() {
  const { profile } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const { accounts, isLoading } = useGrokAppAccounts(activeWorkspaceId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<GrokAppAccount | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [provider, setProvider] = useState<ProviderFilter>("all");
  const [query, setQuery] = useState("");

  const counts = useMemo(() => {
    const next: Record<string, number> = { all: accounts.length };
    for (const item of GROK_APP_PROVIDERS) next[item.id] = 0;
    for (const account of accounts) next[account.provider] = (next[account.provider] ?? 0) + 1;
    return next;
  }, [accounts]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return accounts.filter((account) => {
      if (provider !== "all" && account.provider !== provider) return false;
      if (!q) return true;
      const hay = `${account.email} ${account.phone ?? ""} ${account.note ?? ""} ${grokAppProviderLabel(account.provider, account.providerOther)}`.toLowerCase();
      return hay.includes(q);
    });
  }, [accounts, provider, query]);

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

  async function handleDelete(account: GrokAppAccount) {
    const name = grokAppProviderLabel(account.provider, account.providerOther);
    if (!window.confirm(`Удалить ${name} «${account.email}»?`)) return;
    await deleteGrokAppAccount(activeWorkspaceId!, account.id);
    toast.success("Подписка удалена");
  }

  const filters: { id: ProviderFilter; label: string; count: number }[] = [
    { id: "all", label: "Все", count: counts.all },
    ...GROK_APP_PROVIDERS.map((item) => ({ id: item.id, label: item.label, count: counts[item.id] ?? 0 })),
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="page-header">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <KeyRound className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h1 className="page-title">Грок лимит</h1>
          <p className="text-[11px] text-muted-foreground">Другие подписки рядом с Grok</p>
        </div>
        <GrokLimitSubnav />
        <div className="flex-1" />
        <Button size="sm" className="gap-1.5" onClick={openCreate}>
          <Plus className="h-4 w-4" /> Добавить подписку
        </Button>
      </div>

      <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:px-6">
        <div className="flex flex-wrap gap-1.5">
          {filters.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setProvider(item.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                provider === item.id
                  ? "border-primary/50 bg-primary/15 text-primary"
                  : "border-border bg-background/40 text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {item.label}
              <span className="tabular-nums text-[10px] opacity-80">{item.count}</span>
            </button>
          ))}
        </div>
        <div className="relative flex-1 sm:ml-auto sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск по сервису, email..." className="h-8 pl-8" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {isLoading && (
            <>
              <Skeleton className="h-44 rounded-xl" />
              <Skeleton className="h-44 rounded-xl" />
            </>
          )}

          {!isLoading && accounts.length === 0 && (
            <EmptyState
              eyebrow="Подписки"
              title="Пока пусто"
              description="ElevenLabs, Higgsfield, Suno — те же логин, номер и статус, что у Grok, на отдельной странице."
              action={
                <Button size="sm" className="gap-1.5" onClick={openCreate}>
                  <Plus className="h-4 w-4" /> Добавить подписку
                </Button>
              }
            />
          )}

          {!isLoading && accounts.length > 0 && visible.length === 0 && (
            <p className="py-16 text-center text-sm text-muted-foreground">Ничего не нашлось по этому фильтру.</p>
          )}

          {visible.map((account) => {
            const status = getGrokAccountStatus(account);
            const isRevealed = revealed.has(account.id);
            const method = grokLoginMethodOf(account.loginMethod);
            const name = grokAppProviderLabel(account.provider, account.providerOther);
            return (
              <Card key={account.id} className={cn("hud-frame glass-panel overflow-hidden", STATUS_CARD[status])}>
                <CardContent className="relative p-0">
                  <span className={cn("absolute inset-y-0 left-0 w-1", STATUS_RAIL[status])} aria-hidden />
                  <div className="flex flex-col gap-3 p-4 pl-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Вход · {name}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                            {grokLoginMethodLabel(method)}
                          </span>
                          <span className="truncate text-[15px] font-medium tracking-[-0.01em]">{account.email}</span>
                          {account.note?.trim() && (
                            <span className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground">
                              {account.note}
                            </span>
                          )}
                        </div>
                        <div className="mt-2.5 flex flex-col gap-1 rounded-lg border border-border/70 bg-background/40 px-2.5 py-2">
                          <SecretRow label="Логин" value={account.email} onCopy={() => copyText(account.email, "Логин")} mono={false} />
                          <SecretRow
                            label="Пароль"
                            value={account.password}
                            revealed={isRevealed}
                            onToggle={() => toggleReveal(account.id)}
                            onCopy={() => copyText(account.password, "Пароль")}
                          />
                          <SecretRow label="Номер" value={account.phone ?? ""} onCopy={() => copyText(account.phone ?? "", "Номер")} />
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-col items-stretch gap-1.5 sm:items-end">
                        <AvailabilityToggle
                          available={account.available}
                          limitResetAt={account.limitResetAt}
                          onToggle={async (next) => {
                            if (!profile) return;
                            await updateGrokAppAccount(
                              activeWorkspaceId!,
                              account.id,
                              { available: next },
                              profile.uid,
                              displayNameOf(profile)
                            );
                          }}
                        />
                        <ActualizePopover
                          limitResetAt={account.limitResetAt}
                          onSave={async (next) => {
                            if (!profile) return;
                            await updateGrokAppAccount(
                              activeWorkspaceId!,
                              account.id,
                              { limitResetAt: next },
                              profile.uid,
                              displayNameOf(profile)
                            );
                          }}
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
                          status === "resetToday" ? "border-warning/40 bg-warning/10 text-warning" : "border-border/70 bg-background/30"
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
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Удалить" onClick={() => handleDelete(account)}>
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

      <GrokAppDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} accounts={accounts} />
    </div>
  );
}
