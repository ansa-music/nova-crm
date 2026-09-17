import { useState } from "react";
import { Check, ChevronDown, Clock3, Copy, Eye, EyeOff, KeyRound, Loader2, MoreHorizontal, Pencil, Trash2, TimerOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/sonner";
import { ActualizePopover } from "@/components/grok/GrokStatusControls";
import { getGrokAccountStatus, type GrokAccountStatus } from "@/services/grokAccountService";
import { cn } from "@/utils/cn";
import { formatDate, formatResetCountdown, timeAgo, ymdInTimeZone } from "@/utils/date";

/** One account of the pool, whichever collection it lives in (Grok or another service). */
export interface PoolAccount {
  key: string;
  id: string;
  kind: "grok" | "app";
  serviceLabel: string;
  nickname?: string;
  email: string;
  password: string;
  phone?: string;
  note?: string;
  methodLabel: string;
  available?: boolean;
  limitResetAt: number | null;
  updatedByName: string;
  updatedAt: number;
}

export type PoolPatch = { available?: boolean; limitResetAt?: number | null; nickname?: string };

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const PRESETS: { label: string; ms: number }[] = [
  { label: "1 час", ms: HOUR },
  { label: "3 часа", ms: 3 * HOUR },
  { label: "5 часов", ms: 5 * HOUR },
  { label: "12 часов", ms: 12 * HOUR },
  { label: "сутки", ms: DAY },
  { label: "2 дня", ms: 2 * DAY },
  { label: "3 дня", ms: 3 * DAY },
  { label: "неделю", ms: 7 * DAY },
];

const STATUS_STYLE: Record<GrokAccountStatus, { dot: string; chip: string; label: string }> = {
  available: { dot: "bg-success", chip: "border-success/40 bg-success/12 text-success", label: "Доступен" },
  resetToday: { dot: "bg-warning", chip: "border-warning/45 bg-warning/12 text-warning", label: "Сегодня" },
  unavailable: { dot: "bg-destructive", chip: "border-destructive/40 bg-destructive/12 text-destructive", label: "Недоступен" },
};

/** «через 2ч 15м» for today, «завтра 14:00» / «18 сент, 14:00» further out. */
function resetLabel(at: number, now: number): string {
  if (at <= now) return "время вышло";
  const sameDay = ymdInTimeZone(at) === ymdInTimeZone(now);
  if (sameDay || at - now < 6 * HOUR) return formatResetCountdown(at, now);
  const tomorrow = ymdInTimeZone(now + 24 * HOUR) === ymdInTimeZone(at);
  return tomorrow ? `завтра ${formatDate(at, "HH:mm")}` : formatDate(at, "d MMM, HH:mm");
}

/**
 * Compact, scannable row for the Грок лимит pool: who it is, whether it
 * works, when it comes back, and the two things people do all day — copy
 * the login, and mark the limit as spent / back — without opening anything.
 */
export function GrokPoolRow({
  account,
  now,
  showService,
  canRename,
  onPatch,
  onCopy,
  onEdit,
  onRename,
  onDelete,
}: {
  account: PoolAccount;
  now: number;
  showService: boolean;
  canRename: boolean;
  onPatch: (patch: PoolPatch) => Promise<void>;
  onCopy: (text: string, label: string) => void;
  onEdit: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [saving, setSaving] = useState(false);
  const status = getGrokAccountStatus({ available: account.available, limitResetAt: account.limitResetAt }, now);
  const style = STATUS_STYLE[status];
  const isAvailable = status === "available";
  const overdue = !isAvailable && account.limitResetAt != null && account.limitResetAt <= now;
  const title = account.nickname?.trim() || account.email;

  async function patch(next: PoolPatch, message: string) {
    setSaving(true);
    try {
      await onPatch(next);
      toast.success(message, { description: title });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось обновить");
    } finally {
      setSaving(false);
    }
  }

  function copyLogin() {
    onCopy([account.email, account.password, account.phone?.trim()].filter(Boolean).join("\n"), "Вход");
  }

  return (
    <li
      className={cn(
        "group relative overflow-hidden rounded-xl border bg-card/70 transition-colors",
        status === "available" && "border-success/25",
        status === "resetToday" && "border-warning/35",
        status === "unavailable" && "border-border/70",
        overdue && "border-warning/50"
      )}
    >
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", style.dot)} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5 pl-4 pr-2.5 sm:flex-nowrap">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full min-w-0 items-center gap-2.5 text-left sm:w-auto sm:flex-1"
          aria-expanded={open}
          title={open ? "Свернуть" : "Пароль, номер, кто обновлял"}
        >
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-sm font-semibold">{title}</span>
              {showService && (
                <span className="shrink-0 rounded-full border border-border/70 px-1.5 text-[10px] leading-4 text-muted-foreground">
                  {account.serviceLabel}
                </span>
              )}
            </span>
            <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
              {account.nickname?.trim() && <span className="truncate">{account.email}</span>}
              <span className="shrink-0 rounded-full bg-primary/10 px-1.5 leading-4 text-primary">{account.methodLabel}</span>
              {account.phone?.trim() && <span className="hidden truncate font-mono sm:inline">{account.phone}</span>}
            </span>
          </span>
        </button>

        <div className="flex min-w-0 shrink-0 items-center gap-2 pl-6 sm:pl-0">
          <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium", style.chip)}>
            <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
            {style.label}
          </span>
          {!isAvailable && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={saving}
                  className={cn(
                    "inline-flex h-7 items-center gap-1 rounded-full border px-2 text-[11px] tabular-nums transition-colors hover:bg-accent hover:text-foreground",
                    overdue
                      ? "border-warning/45 font-medium text-warning"
                      : account.limitResetAt == null
                        ? "border-dashed border-border text-muted-foreground"
                        : "border-border/70 text-muted-foreground"
                  )}
                  title={account.limitResetAt != null ? `${formatDate(account.limitResetAt)} — изменить` : "Когда вернётся?"}
                >
                  <Clock3 className="h-3 w-3" />
                  {account.limitResetAt != null ? resetLabel(account.limitResetAt, now) : "когда вернётся?"}
                  <ChevronDown className="h-3 w-3 opacity-70" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Вернётся через…</DropdownMenuLabel>
                {PRESETS.map((preset) => (
                  <DropdownMenuItem
                    key={preset.label}
                    onSelect={() =>
                      void patch({ available: false, limitResetAt: Date.now() + preset.ms }, `Вернётся через ${preset.label}`)
                    }
                  >
                    через {preset.label}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void patch({ available: false, limitResetAt: null }, "Время неизвестно")}>
                  Время неизвестно
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          {isAvailable ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1 px-2.5 text-xs" disabled={saving}>
                  <TimerOff className="h-3.5 w-3.5" />
                  Кончился
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Лимит вернётся через…</DropdownMenuLabel>
                {PRESETS.map((preset) => (
                  <DropdownMenuItem
                    key={preset.label}
                    onSelect={() =>
                      void patch({ available: false, limitResetAt: Date.now() + preset.ms }, `Лимит кончился — вернётся через ${preset.label}`)
                    }
                  >
                    на {preset.label}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void patch({ available: false }, "Отмечен недоступным")}>
                  Время неизвестно
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              variant={overdue ? "default" : "outline"}
              size="sm"
              className="h-8 gap-1 px-2.5 text-xs"
              disabled={saving}
              onClick={() => void patch({ available: true, limitResetAt: null }, "Снова доступен")}
            >
              <Check className="h-3.5 w-3.5" />
              Доступен
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" title="Копировать вход (почта, пароль, номер)" onClick={copyLogin}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" title="Ещё">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onCopy(account.email, "Email")}>
                <Copy className="mr-2 h-3.5 w-3.5" /> Копировать почту
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onCopy(account.password, "Пароль")} disabled={!account.password}>
                <KeyRound className="mr-2 h-3.5 w-3.5" /> Копировать пароль
              </DropdownMenuItem>
              {canRename && (
                <DropdownMenuItem onSelect={onRename}>
                  <Pencil className="mr-2 h-3.5 w-3.5" /> Название
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil className="mr-2 h-3.5 w-3.5" /> Редактировать
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onDelete}>
                <Trash2 className="mr-2 h-3.5 w-3.5" /> Удалить
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {open && (
        <div className="grid gap-x-6 gap-y-1.5 border-t border-border/50 py-2.5 pl-10 pr-3 text-sm sm:grid-cols-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="w-14 shrink-0 text-xs text-muted-foreground">Почта</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{account.email}</span>
            <button type="button" className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" title="Копировать почту" onClick={() => onCopy(account.email, "Email")}>
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <span className="w-14 shrink-0 text-xs text-muted-foreground">Пароль</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
              {account.password ? (revealed ? account.password : "•".repeat(Math.min(12, Math.max(6, account.password.length)))) : "не указан"}
            </span>
            {account.password && (
              <>
                <button type="button" className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" title={revealed ? "Скрыть" : "Показать"} onClick={() => setRevealed((v) => !v)}>
                  {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
                <button type="button" className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" title="Копировать пароль" onClick={() => onCopy(account.password, "Пароль")}>
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
          {account.phone?.trim() && (
            <div className="flex min-w-0 items-center gap-2">
              <span className="w-14 shrink-0 text-xs text-muted-foreground">Номер</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{account.phone}</span>
              <button type="button" className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" title="Копировать номер" onClick={() => onCopy(account.phone ?? "", "Номер")}>
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {account.note?.trim() && (
            <div className="flex min-w-0 items-center gap-2">
              <span className="w-14 shrink-0 text-xs text-muted-foreground">Заметка</span>
              <span className="min-w-0 flex-1 truncate">{account.note}</span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground sm:col-span-2">
            <ActualizePopover
              limitResetAt={account.limitResetAt}
              onSave={(next) => onPatch({ limitResetAt: next, ...(next != null && next > Date.now() ? { available: false } : {}) })}
            />
            <span>
              обновил(а) <span className="font-medium text-foreground">{account.updatedByName || "—"}</span> · {timeAgo(account.updatedAt)}
            </span>
          </div>
        </div>
      )}
    </li>
  );
}
