import { useState } from "react";
import {
  Check,
  ChevronDown,
  Clock3,
  Copy,
  Eye,
  EyeOff,
  Gauge,
  KeyRound,
  Loader2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Trash2,
  TimerOff,
  Users,
} from "lucide-react";
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
import { UsagePopover } from "@/components/grok/GrokStatusControls";
import { getGrokAccountStatus, isGrokResetPassed, type GrokAccountStatus } from "@/services/grokAccountService";
import type { ElevenLabsUsageState } from "@/services/elevenLabsUsageService";
import { cn } from "@/utils/cn";
import { formatDate, formatResetCountdown, timeAgo, ymdInTimeZone } from "@/utils/date";
import { elevenLabsUsedPct, formatChars, shownUsagePct, usageTone, type PoolPatch } from "@/utils/grokUsage";

export type { PoolPatch };

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
  usagePct?: number | null;
  usageAt?: number;
  /** Ключ API только для чтения (11 Labs) — показывается в раскрытом теле. */
  apiKey?: string;
  updatedByName: string;
  updatedAt: number;
  /** Сколько людей пущено к аккаунту; null — доступ не ограничивали. */
  accessCount?: number | null;
}

/** Живое использование из сервиса (пока — ElevenLabs по ключу). */
export type LiveUsage = ElevenLabsUsageState | { kind: "loading" };

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
  available: { dot: "bg-success", chip: "border-success/30 bg-success/[0.12] text-success", label: "Доступен" },
  resetToday: { dot: "bg-warning", chip: "border-warning/30 bg-warning/[0.12] text-warning", label: "Сегодня" },
  unavailable: { dot: "bg-destructive", chip: "border-destructive/30 bg-destructive/[0.12] text-destructive", label: "Недоступен" },
};

const TONE_BAR = { success: "bg-success", warning: "bg-warning", danger: "bg-destructive" } as const;
const TONE_TEXT = { success: "text-success", warning: "text-warning", danger: "text-destructive" } as const;

/** «через 2ч 15м» for today, «завтра 14:00» / «18 сент, 14:00» further out. */
export function resetLabel(at: number, now: number): string {
  if (at <= now) return "время вышло";
  const sameDay = ymdInTimeZone(at) === ymdInTimeZone(now);
  if (sameDay || at - now < 6 * HOUR) return formatResetCountdown(at, now);
  const tomorrow = ymdInTimeZone(now + 24 * HOUR) === ymdInTimeZone(at);
  return tomorrow ? `завтра ${formatDate(at, "HH:mm")}` : formatDate(at, "d MMM, HH:mm");
}

/**
 * Строка пула «Грок лимита»: кто это, работает ли, сколько осталось и когда
 * сброс — и одно главное действие на состояние. Доступен → «Кончился ▾»,
 * недоступен → «Доступен», сброс уже прошёл → «Доступен» акцентом с
 * подписью. Логин копируется из строки; пароль, номер, ключ и живое
 * использование — в раскрытом теле.
 */
export function GrokPoolRow({
  account,
  now,
  showService,
  canRename,
  usageHint,
  live,
  onPatch,
  onCopy,
  onEdit,
  onRename,
  onDelete,
  onAccess,
  onRefreshLive,
}: {
  account: PoolAccount;
  now: number;
  showService: boolean;
  canRename: boolean;
  /** Подсказка popover «Использовано»: где взять цифры. */
  usageHint: string;
  /** Живое использование по ключу (11 Labs); нет ключа — undefined. */
  live?: LiveUsage;
  onPatch: (patch: PoolPatch) => Promise<void>;
  onCopy: (text: string, label: string) => void;
  onEdit: () => void;
  onRename: () => void;
  onDelete: () => void;
  /** Есть только у тех, кто вправе открывать аккаунт, и только у аккаунтов подписок. */
  onAccess?: () => void;
  onRefreshLive?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [keyRevealed, setKeyRevealed] = useState(false);
  const [saving, setSaving] = useState(false);
  const status = getGrokAccountStatus({ available: account.available, limitResetAt: account.limitResetAt }, now);
  const style = STATUS_STYLE[status];
  const isAvailable = status === "available";
  const resetPassed = isGrokResetPassed(account, now);
  const title = account.nickname?.trim() || account.email;
  const futureReset = account.limitResetAt != null && account.limitResetAt > now ? account.limitResetAt : null;
  const liveOk = live?.kind === "ok" ? live : null;
  // Живая цифра сервиса сильнее ручной отметки: ей не нужен человек.
  const livePct = liveOk ? elevenLabsUsedPct(liveOk.usage) : null;
  const manualPct = shownUsagePct(account, now);
  const pct = livePct ?? manualPct;

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

  const usageChip =
    pct != null ? (
      <span
        className={cn("inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium tabular-nums", "border-border bg-transparent")}
        title={
          liveOk
            ? `Символов: ${formatChars(liveOk.usage.used)} из ${formatChars(liveOk.usage.limit)}`
            : `Использовано ${pct} %${account.usageAt ? ` · отмечено ${timeAgo(account.usageAt)}` : ""}`
        }
      >
        <span className="h-1.5 w-10 overflow-hidden rounded-full bg-muted">
          <span className={cn("block h-full rounded-full", TONE_BAR[usageTone(pct)])} style={{ width: `${pct}%` }} />
        </span>
        <span className={TONE_TEXT[usageTone(pct)]}>{pct} %</span>
        {futureReset && <span className="text-muted-foreground">· сброс {resetLabel(futureReset, now)}</span>}
      </span>
    ) : (
      <span className="inline-flex h-7 items-center gap-1 rounded-md border border-dashed border-border px-2 text-[11px] text-muted-foreground">
        <Gauge className="h-3 w-3" />
        {futureReset ? `сброс ${resetLabel(futureReset, now)}` : "сколько осталось?"}
      </span>
    );

  return (
    <li
      className={cn(
        "group relative overflow-hidden rounded-xl border bg-card transition-colors",
        status === "available" && !resetPassed && "border-success/25",
        status === "resetToday" && "border-warning/30",
        status === "unavailable" && "border-border",
        resetPassed && "border-warning/40"
      )}
    >
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", resetPassed ? "bg-warning" : style.dot)} />
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
                <span className="shrink-0 rounded-md border border-border px-1.5 text-[10px] leading-4 text-muted-foreground">{account.serviceLabel}</span>
              )}
            </span>
            <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
              {account.nickname?.trim() && <span className="truncate">{account.email}</span>}
              <span className="shrink-0 rounded-md bg-primary/10 px-1.5 leading-4 text-primary">{account.methodLabel}</span>
              {account.phone?.trim() && <span className="hidden truncate font-mono sm:inline">{account.phone}</span>}
            </span>
          </span>
        </button>

        {/* Доступ — прямо в строке, а не только в «⋯»: «кому открыт Хикс»
            спрашивают чаще, чем правят пароль. Чип есть у тех, кто вправе
            менять список, и у закрытого аккаунта — у всех (видно, почему «у
            меня есть, а у него нет»). */}
        {account.kind === "app" && (onAccess || (account.accessCount != null && account.accessCount > 0)) && (
          <button
            type="button"
            onClick={onAccess}
            disabled={!onAccess}
            className={cn(
              "inline-flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-[11px] font-medium transition-colors disabled:cursor-default",
              account.accessCount != null && account.accessCount > 0
                ? "border-primary/30 bg-primary/[0.12] text-primary"
                : "border-dashed border-border text-muted-foreground",
              onAccess && "hover:bg-accent hover:text-foreground"
            )}
            title={
              account.accessCount != null && account.accessCount > 0
                ? `Открыт ${account.accessCount} людям${onAccess ? " — изменить" : ""}`
                : "Открыт всем — закрыть на список"
            }
          >
            {account.accessCount != null && account.accessCount > 0 ? (
              <>
                <ShieldCheck className="h-3 w-3" />
                {account.accessCount}
              </>
            ) : (
              <>
                <Users className="h-3 w-3" />
                всем
              </>
            )}
          </button>
        )}

        <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 pl-6 sm:pl-0">
          <span className={cn("inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium", style.chip)}>
            <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
            {resetPassed ? "Сброс прошёл" : style.label}
          </span>
          {isAvailable && !resetPassed && (
            liveOk ? (
              usageChip
            ) : (
              <UsagePopover account={account} now={now} hint={usageHint} onSave={onPatch}>
                <button type="button" className="shrink-0 rounded-md transition-colors hover:bg-accent" title="Отметить, сколько использовано">
                  {usageChip}
                </button>
              </UsagePopover>
            )
          )}
          {resetPassed && account.limitResetAt != null && (
            <span className="text-[11px] text-warning" title="Названное время сброса прошло — считаем аккаунт доступным, пока никто не отметил иное">
              был {formatDate(account.limitResetAt, "d MMM, HH:mm")} · считаем доступным
            </span>
          )}
          {!isAvailable && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={saving}
                  className={cn(
                    "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] tabular-nums transition-colors hover:bg-accent hover:text-foreground",
                    account.limitResetAt == null ? "border-dashed border-border text-muted-foreground" : "border-border text-muted-foreground"
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
                    onSelect={() => void patch({ available: false, limitResetAt: Date.now() + preset.ms }, `Вернётся через ${preset.label}`)}
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
          {isAvailable && !resetPassed ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1 px-2.5 text-xs" disabled={saving}>
                  <TimerOff className="h-3.5 w-3.5" />
                  Кончился
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Лимит вернётся…</DropdownMenuLabel>
                {futureReset && (
                  <>
                    {/* У Грока сброс недельный и уже известен — это и есть правильный ответ. */}
                    <DropdownMenuItem
                      onSelect={() => void patch({ available: false, usagePct: 100, usageAt: Date.now() }, `Лимит кончился — сброс ${resetLabel(futureReset, now)}`)}
                    >
                      в сброс · {resetLabel(futureReset, now)}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {PRESETS.map((preset) => (
                  <DropdownMenuItem
                    key={preset.label}
                    onSelect={() =>
                      void patch(
                        { available: false, limitResetAt: Date.now() + preset.ms, usagePct: 100, usageAt: Date.now() },
                        `Лимит кончился — вернётся через ${preset.label}`
                      )
                    }
                  >
                    через {preset.label}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void patch({ available: false, usagePct: 100, usageAt: Date.now() }, "Отмечен недоступным")}>
                  Время неизвестно
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              variant={resetPassed ? "default" : "outline"}
              size="sm"
              className="h-8 gap-1 px-2.5 text-xs"
              disabled={saving}
              title={resetPassed ? "Подтвердить: аккаунт снова работает" : "Отметить доступным"}
              onClick={() => void patch({ available: true, limitResetAt: null, usagePct: null, usageAt: Date.now() }, "Снова доступен")}
            >
              <Check className="h-3.5 w-3.5" />
              Доступен
            </Button>
          )}
          {/* Кнопки стоят в одной строке с «Доступен» (h-8): тач-блок растил
              иконки до 44, и строка аккаунта становилась выше соседних. На таче
              — 36, как чип; data-compact выключает общее правило. */}
          <Button
            variant="ghost"
            size="icon"
            data-compact
            className="h-8 w-8 text-muted-foreground [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9"
            title="Копировать вход (почта, пароль, номер)"
            onClick={copyLogin}
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" data-compact className="h-8 w-8 text-muted-foreground [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9" title="Ещё">
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
              {onAccess && (
                <DropdownMenuItem onSelect={onAccess}>
                  <ShieldCheck className="mr-2 h-3.5 w-3.5" /> Доступ к аккаунту
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
        <div className="grid gap-x-6 gap-y-1.5 border-t border-border py-2.5 pl-10 pr-3 text-sm sm:grid-cols-2">
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
          {account.apiKey?.trim() && (
            <div className="flex min-w-0 items-center gap-2">
              <span className="w-14 shrink-0 text-xs text-muted-foreground">Ключ</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{keyRevealed ? account.apiKey : `${account.apiKey.slice(0, 3)}${"•".repeat(10)}${account.apiKey.slice(-4)}`}</span>
              <button type="button" className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" title={keyRevealed ? "Скрыть" : "Показать"} onClick={() => setKeyRevealed((v) => !v)}>
                {keyRevealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
              <button type="button" className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" title="Копировать ключ" onClick={() => onCopy(account.apiKey ?? "", "Ключ")}>
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {live && (
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] sm:col-span-2">
              <span className="w-14 shrink-0 text-xs text-muted-foreground">11 Labs</span>
              {live.kind === "loading" && (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> проверяем…
                </span>
              )}
              {live.kind === "error" && <span className="text-destructive">{live.message}</span>}
              {live.kind === "ok" && (
                <span className={cn("tabular-nums", live.usage.used >= live.usage.limit ? "text-destructive" : "text-foreground")}>
                  символов {formatChars(live.usage.used)} из {formatChars(live.usage.limit)}
                  {live.usage.used >= live.usage.limit ? " · лимит исчерпан" : ""}
                  {live.usage.resetAt ? ` · сброс ${formatDate(live.usage.resetAt, "d MMM")}` : ""}
                  {live.usage.tier ? ` · ${live.usage.tier}` : ""}
                </span>
              )}
              {onRefreshLive && live.kind !== "loading" && (
                <button type="button" className="inline-flex items-center gap-1 rounded px-1 text-muted-foreground hover:bg-accent hover:text-foreground" title="Спросить ElevenLabs заново" onClick={onRefreshLive}>
                  <RefreshCw className="h-3 w-3" /> обновить
                </button>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground sm:col-span-2">
            {!liveOk && (
              <UsagePopover account={account} now={now} hint={usageHint} onSave={onPatch}>
                <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground" title="Отметить использование и время сброса">
                  <Gauge className="h-3 w-3" />
                  Использовано{manualPct != null ? ` ${manualPct} %` : ""}
                </Button>
              </UsagePopover>
            )}
            <span>
              обновил(а) <span className="font-medium text-foreground">{account.updatedByName || "—"}</span> · {timeAgo(account.updatedAt)}
            </span>
          </div>
        </div>
      )}
    </li>
  );
}
