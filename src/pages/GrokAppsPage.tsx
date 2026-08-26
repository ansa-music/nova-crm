import { useMemo, useState } from "react";
import { KeyRound, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { EmptyState } from "@/components/common/EmptyState";
import { GrokAppDialog } from "@/components/grok/GrokAppDialog";
import { GrokCredentialCard } from "@/components/grok/GrokCredentialCard";
import { GrokLimitSubnav } from "@/components/grok/GrokLimitSubnav";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useGrokAppAccounts } from "@/hooks/useGrokAppAccounts";
import { deleteGrokAppAccount, updateGrokAppAccount } from "@/services/grokAppAccountService";
import { displayNameOf } from "@/utils/displayName";
import { grokLoginMethodLabel, grokLoginMethodOf } from "@/types/grokAccount";
import { GROK_APP_PROVIDERS, grokAppProviderLabel, type GrokAppAccount, type GrokAppProvider } from "@/types/grokAppAccount";
import { cn } from "@/utils/cn";

type ProviderFilter = "all" | GrokAppProvider;

export default function GrokAppsPage() {
  const { profile } = useAuth();
  const { role } = usePermissions();
  const canName = role === "owner" || role === "admin";
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
      const hay = `${account.nickname ?? ""} ${account.email} ${account.phone ?? ""} ${account.note ?? ""} ${grokAppProviderLabel(account.provider, account.providerOther)}`.toLowerCase();
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

  const CHIP_TONE: Record<ProviderFilter, string> = {
    all: "border-primary/50 bg-primary/15 text-primary",
    elevenlabs: "border-amber-400/50 bg-amber-400/15 text-amber-300",
    higgsfield: "border-emerald-400/50 bg-emerald-400/15 text-emerald-300",
    suno: "border-rose-400/50 bg-rose-400/15 text-rose-300",
    other: "border-violet-400/50 bg-violet-400/15 text-violet-300",
  };

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
                  ? CHIP_TONE[item.id]
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
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Название, сервис, email..." className="h-8 pl-8" />
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

          {visible.map((account) => (
            <GrokCredentialCard
              key={account.id}
              methodLabel={grokLoginMethodLabel(grokLoginMethodOf(account.loginMethod))}
              extraChip={grokAppProviderLabel(account.provider, account.providerOther)}
              nickname={account.nickname}
              email={account.email}
              password={account.password}
              phone={account.phone}
              note={account.note}
              available={account.available}
              limitResetAt={account.limitResetAt}
              updatedByName={account.updatedByName}
              updatedAt={account.updatedAt}
              revealed={revealed.has(account.id)}
              onToggleReveal={() => toggleReveal(account.id)}
              onCopy={copyText}
              canRename={canName}
              onToggleAvailable={async (next) => {
                if (!profile) return;
                await updateGrokAppAccount(activeWorkspaceId!, account.id, { available: next }, profile.uid, displayNameOf(profile));
              }}
              onRename={async (nickname) => {
                if (!profile) return;
                await updateGrokAppAccount(activeWorkspaceId!, account.id, { nickname }, profile.uid, displayNameOf(profile));
              }}
              onActualize={async (next) => {
                if (!profile) return;
                await updateGrokAppAccount(activeWorkspaceId!, account.id, { limitResetAt: next }, profile.uid, displayNameOf(profile));
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

      <GrokAppDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} accounts={accounts} />
    </div>
  );
}
