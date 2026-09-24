import { useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { chipClass } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/sonner";
import { autoFormatManualDateTimeInput, formatDateTimeManual, parseDateTimeManual, MANUAL_DATETIME_PLACEHOLDER } from "@/utils/date";
import { clampUsagePct, USAGE_PRESETS, usagePatch, type PoolPatch, type UsageAccount } from "@/utils/grokUsage";
import { cn } from "@/utils/cn";

/**
 * «Использовано» — то, что человек видит на grok.com → Settings → Usage:
 * процент недельной квоты и время сброса. Здесь он это переносит в две
 * отметки: чип процента (0/25/50/75/90/100 или своё число) и дата сброса.
 * 100 % = лимит кончился, аккаунт уходит в недоступные; меньше — аккаунт
 * работает (человек только что это видел), и прошедшая дата сброса
 * стирается. Одна дата без процента меняет только дату.
 */
export function UsagePopover({
  account,
  now,
  hint,
  onSave,
  children,
  align = "start",
}: {
  account: UsageAccount;
  now: number;
  /** Где взять цифры: у Грока — Settings → Usage, у других сервисов — свой кабинет. */
  hint: string;
  onSave: (patch: PoolPatch) => Promise<void>;
  /** Кнопка-триггер (asChild). */
  children: ReactNode;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const [pct, setPct] = useState<string>("");
  const [resetAt, setResetAt] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setPct(account.usagePct == null ? "" : String(clampUsagePct(account.usagePct) ?? ""));
      setResetAt(formatDateTimeManual(account.limitResetAt));
    }
  }

  const parsedReset = parseDateTimeManual(resetAt);
  const resetInvalid = parsedReset === undefined;
  const pctValue = pct.trim() === "" ? null : clampUsagePct(pct);
  const pctInvalid = pct.trim() !== "" && pctValue == null;
  const resetChanged = (parsedReset ?? null) !== (account.limitResetAt ?? null);
  const pctChanged = pctValue !== (clampUsagePct(account.usagePct) ?? null);
  const canSave = !resetInvalid && !pctInvalid && (resetChanged || pctChanged);

  async function save() {
    if (!canSave) return;
    setIsSaving(true);
    try {
      const patch: PoolPatch = pctValue == null ? { usagePct: null, usageAt: Date.now() } : { ...usagePatch(account, pctValue, Date.now()) };
      // Дата из поля сильнее автоматики патча: человек её только что видел.
      if (resetChanged) patch.limitResetAt = parsedReset ?? null;
      await onSave(patch);
      toast.success(pctValue == null ? "Отметка снята" : pctValue >= 100 ? "Лимит кончился" : `Использовано ${pctValue} %`);
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось обновить");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-80" align={align}>
        <p className="text-sm font-medium">Использовано</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {USAGE_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={chipClass({ active: pctValue === preset, tone: preset >= 100 ? "danger" : preset >= 90 ? "warning" : "primary", size: "sm" })}
              onClick={() => setPct(String(preset))}
            >
              {preset} %
            </button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-[1fr_auto] items-center gap-2">
          <span className="text-xs text-muted-foreground">Своё число</span>
          <Input
            value={pct}
            onChange={(e) => setPct(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
            inputMode="numeric"
            placeholder="—"
            aria-label="Использовано, %"
            className={cn("h-8 w-20 text-right tabular-nums", pctInvalid && "border-destructive focus-visible:ring-destructive")}
          />
        </div>
        <div className="mt-3 flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Сброс лимита</span>
          <Input
            value={resetAt}
            onChange={(e) => setResetAt(autoFormatManualDateTimeInput(e.target.value))}
            inputMode="numeric"
            placeholder={MANUAL_DATETIME_PLACEHOLDER}
            aria-label="Сброс лимита"
            className={cn("h-8 tabular-nums", resetInvalid && "border-destructive focus-visible:ring-destructive")}
            onKeyDown={(e) => {
              if (e.code === "Enter" && canSave) void save();
            }}
          />
          <p className={cn("text-[11px] text-muted-foreground", resetInvalid && "text-destructive")}>
            {resetInvalid ? `Формат ${MANUAL_DATETIME_PLACEHOLDER}` : "Пусто — время неизвестно"}
          </p>
        </div>
        <div className="mt-3 flex items-center justify-end gap-2">
          {account.usagePct != null && (
            <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" disabled={isSaving} onClick={() => setPct("")}>
              Снять отметку
            </Button>
          )}
          <Button size="sm" className="h-8 gap-1.5" onClick={() => void save()} disabled={isSaving || !canSave}>
            {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Сохранить
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
