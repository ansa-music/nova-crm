import { useState } from "react";
import { Copy, Eye, EyeOff, KeyRound, Plus, RefreshCw, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/components/ui/sonner";
import { GrokAccountDialog } from "@/components/grok/GrokAccountDialog";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useAuth } from "@/hooks/useAuth";
import { useGrokAccounts } from "@/hooks/useGrokAccounts";
import { deleteGrokAccount, updateGrokAccount } from "@/services/grokAccountService";
import { displayNameOf } from "@/utils/displayName";
import { formatDate, timeAgo } from "@/utils/date";
import { cn } from "@/utils/cn";
import type { GrokAccount } from "@/types";

export default function GrokLimitPage() {
  const { profile } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const { accounts, isLoading, reload } = useGrokAccounts(activeWorkspaceId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<GrokAccount | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  if (!activeWorkspaceId) return null;

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

  async function handleTouch(account: GrokAccount) {
    if (!profile) return;
    setRefreshingId(account.id);
    try {
      // Empty patch — "Актуализировать" just re-stamps who confirmed this
      // account is still accurate right now, without changing its data.
      await updateGrokAccount(activeWorkspaceId!, account.id, {}, profile.uid, displayNameOf(profile));
      await reload();
      toast.success("Отмечено как актуальное");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось обновить");
    } finally {
      setRefreshingId(null);
    }
  }

  async function handleDelete(account: GrokAccount) {
    if (!window.confirm(`Удалить аккаунт «${account.email}»?`)) return;
    await deleteGrokAccount(activeWorkspaceId!, account.id);
    void reload();
    toast.success("Аккаунт удалён");
  }

  const now = Date.now();

  return (
    <div className="flex h-full flex-col">
      <div className="page-header">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <KeyRound className="h-4 w-4" />
        </span>
        <h1 className="page-title">GROK LIMIT</h1>
        <div className="flex-1" />
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="h-4 w-4" /> Добавить аккаунт
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {!isLoading && accounts.length === 0 && (
            <p className="py-16 text-center text-sm text-muted-foreground">
              Пока нет аккаунтов — добавьте первый.
            </p>
          )}
          {accounts.map((account) => {
            const isRevealed = revealed.has(account.id);
            const isAvailable = account.limitResetAt == null || account.limitResetAt <= now;
            return (
              <Card key={account.id} className="hud-frame glass-panel">
                <CardContent className="flex flex-col gap-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">{account.email}</span>
                        <button
                          type="button"
                          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                          title="Копировать email"
                          onClick={() => copyText(account.email, "Email")}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                            isAvailable ? "bg-success/15 text-success" : "bg-warning/15 text-warning"
                          )}
                        >
                          {isAvailable ? "Доступен" : "Ограничен"}
                        </span>
                      </div>

                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <span className="font-mono tabular-nums">
                          {isRevealed ? account.password || "—" : "•".repeat(Math.max(6, account.password.length))}
                        </span>
                        <button
                          type="button"
                          className="rounded p-1 hover:bg-accent hover:text-foreground"
                          title={isRevealed ? "Скрыть пароль" : "Показать пароль"}
                          onClick={() => toggleReveal(account.id)}
                        >
                          {isRevealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                        {account.password && (
                          <button
                            type="button"
                            className="rounded p-1 hover:bg-accent hover:text-foreground"
                            title="Копировать пароль"
                            onClick={() => copyText(account.password, "Пароль")}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>

                      <p className="mt-1.5 text-xs text-muted-foreground">
                        Лимит восстановится:{" "}
                        {account.limitResetAt != null ? (
                          <span className="font-medium text-foreground">{formatDate(account.limitResetAt)}</span>
                        ) : (
                          "не указано"
                        )}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1.5"
                        onClick={() => handleTouch(account)}
                        disabled={refreshingId === account.id}
                        title="Отметить актуальным прямо сейчас"
                      >
                        <RefreshCw className={cn("h-3.5 w-3.5", refreshingId === account.id && "animate-spin")} />
                        Актуализировать
                      </Button>
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

                  {/* Corner marker — who last confirmed/edited this row, and when. */}
                  <div className="flex justify-end border-t border-border/60 pt-2">
                    <span className="text-[11px] text-muted-foreground">
                      Актуализировал: <span className="font-medium text-foreground">{account.updatedByName}</span> ·{" "}
                      {timeAgo(account.updatedAt)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <GrokAccountDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) void reload();
        }}
        editing={editing}
      />
    </div>
  );
}
