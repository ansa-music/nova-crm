import { useState } from "react";
import { Ban, CheckCircle2, Copy, Eye, EyeOff, KeyRound, Plus, RefreshCw, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/sonner";
import { GrokAccountDialog } from "@/components/grok/GrokAccountDialog";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useAuth } from "@/hooks/useAuth";
import { useGrokAccounts } from "@/hooks/useGrokAccounts";
import { deleteGrokAccount, getGrokAccountStatus, isGrokAccountAvailable, updateGrokAccount } from "@/services/grokAccountService";
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

export default function GrokLimitPage() {
  const { profile } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const { accounts, isLoading } = useGrokAccounts(activeWorkspaceId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<GrokAccount | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

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

  async function handleDelete(account: GrokAccount) {
    if (!window.confirm(`Удалить аккаунт «${account.email}»?`)) return;
    await deleteGrokAccount(activeWorkspaceId!, account.id);
    toast.success("Аккаунт удалён");
  }

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

                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                      <AvailabilityToggle account={account} />
                      <ActualizePopover account={account} />
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
        onOpenChange={setDialogOpen}
        editing={editing}
        accounts={accounts}
      />
    </div>
  );
}

/**
 * The one-tap status button asked for: a single click flips Доступно ⇄
 * Недоступно right on the card, no popover, no typing — for the common
 * case of "I just tried it, here's the answer" where the exact restore
 * time isn't the point. Big and unambiguous on purpose (this is the
 * button people will hit most). Still re-stamps who/when like any other
 * actualization.
 */
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
        // Bigger and visibly a button, not a status label: thicker border,
        // a shadow that lifts on hover, a press-down on click — this is the
        // control people reach for most, so it needs to read as clickable
        // at a glance, not blend in as decoration.
        "h-11 gap-2 rounded-xl border-2 px-4 text-sm font-semibold shadow-sm transition-all hover:-translate-y-px hover:shadow-md active:translate-y-0 active:scale-[0.97] active:shadow-none",
        status === "available" && "border-success/50 bg-success/15 text-success hover:bg-success/25",
        status === "resetToday" && "border-warning/50 bg-warning/15 text-warning hover:bg-warning/25",
        status === "unavailable" && "border-destructive/50 bg-destructive/15 text-destructive hover:bg-destructive/25"
      )}
    >
      {available ? <CheckCircle2 className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
      {available ? "Доступно" : "Недоступно"}
    </Button>
  );
}

/**
 * "Актуализировать" — type the exact reset time by hand (26.08.2026 17:25)
 * right from the list, no need to open the full edit dialog. Purely
 * supplementary info: saving it does NOT itself flip Доступно/Недоступно —
 * use the button above for that.
 */
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
