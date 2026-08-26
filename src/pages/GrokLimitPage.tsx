import { useMemo, useState } from "react";
import { KeyRound, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { EmptyState } from "@/components/common/EmptyState";
import { GrokAccountDialog } from "@/components/grok/GrokAccountDialog";
import { GrokCredentialCard } from "@/components/grok/GrokCredentialCard";
import { GrokLimitSubnav } from "@/components/grok/GrokLimitSubnav";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useAuth } from "@/hooks/useAuth";
import { useGrokAccounts } from "@/hooks/useGrokAccounts";
import { deleteGrokAccount, getGrokAccountStatus, updateGrokAccount, type GrokAccountStatus } from "@/services/grokAccountService";
import { displayNameOf } from "@/utils/displayName";
import { grokLoginMethodLabel, grokLoginMethodOf } from "@/types/grokAccount";
import { cn } from "@/utils/cn";
import type { GrokAccount } from "@/types";

type StatusFilter = "all" | GrokAccountStatus;

export default function GrokLimitPage() {
  const { profile } = useAuth();
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
      if (!q) return true;
      const hay = `${account.email} ${account.phone ?? ""} ${grokLoginMethodLabel(grokLoginMethodOf(account.loginMethod))}`.toLowerCase();
      return hay.includes(q);
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
        <GrokLimitSubnav />
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
        <div className="relative flex-1 sm:ml-auto sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск по email, номеру..." className="h-8 pl-8" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-2.5">
          {isLoading && (
            <>
              <Skeleton className="h-32 rounded-xl" />
              <Skeleton className="h-32 rounded-xl" />
            </>
          )}

          {!isLoading && accounts.length === 0 && (
            <EmptyState
              eyebrow="Пул Grok"
              title="Пока нет аккаунтов"
              description="Добавьте аккаунт с способом входа и номером — команда увидит, как зайти, без переписки."
              action={
                <Button size="sm" className="gap-1.5" onClick={openCreate}>
                  <Plus className="h-4 w-4" /> Добавить аккаунт
                </Button>
              }
            />
          )}

          {!isLoading && accounts.length > 0 && visible.length === 0 && (
            <p className="py-16 text-center text-sm text-muted-foreground">Ничего не нашлось по этому фильтру.</p>
          )}

          {visible.map((account) => (
            <GrokCredentialCard
              key={account.id}
              methodLabel={grokLoginMethodLabel(grokLoginMethodOf(account.loginMethod))}
              email={account.email}
              password={account.password}
              phone={account.phone}
              available={account.available}
              limitResetAt={account.limitResetAt}
              updatedByName={account.updatedByName}
              updatedAt={account.updatedAt}
              revealed={revealed.has(account.id)}
              onToggleReveal={() => toggleReveal(account.id)}
              onCopy={copyText}
              onToggleAvailable={async (next) => {
                if (!profile) return;
                await updateGrokAccount(activeWorkspaceId!, account.id, { available: next }, profile.uid, displayNameOf(profile));
              }}
              onActualize={async (next) => {
                if (!profile) return;
                await updateGrokAccount(activeWorkspaceId!, account.id, { limitResetAt: next }, profile.uid, displayNameOf(profile));
              }}
              onEdit={() => {
                setEditing(account);
                setDialogOpen(true);
              }}
              onDelete={() => handleDelete(account)}
            />
          ))}
        </div>
      </div>

      <GrokAccountDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} accounts={accounts} />
    </div>
  );
}
