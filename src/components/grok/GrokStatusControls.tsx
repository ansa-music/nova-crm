import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/sonner";
import { getGrokAccountStatus, isGrokAccountAvailable, type GrokAccountStatus } from "@/services/grokAccountService";
import {
  autoFormatManualDateTimeInput,
  formatDateTimeManual,
  parseDateTimeManual,
  MANUAL_DATETIME_PLACEHOLDER,
} from "@/utils/date";
import { cn } from "@/utils/cn";

const STATUS_LABEL: Record<GrokAccountStatus, string> = {
  available: "Доступно",
  resetToday: "Сегодня",
  unavailable: "Недоступно",
};

const STATUS_DOT: Record<GrokAccountStatus, string> = {
  available: "bg-success shadow-[0_0_8px_hsl(var(--success))]",
  resetToday: "bg-warning shadow-[0_0_8px_hsl(var(--warning))]",
  unavailable: "bg-destructive shadow-[0_0_8px_hsl(var(--destructive))]",
};

const STATUS_CHIP: Record<GrokAccountStatus, string> = {
  available: "bg-success/15 text-success hover:bg-success/25",
  resetToday: "bg-warning/15 text-warning hover:bg-warning/25",
  unavailable: "bg-destructive/15 text-destructive hover:bg-destructive/25",
};

/** Live status: reads as a badge, still one-tap to flip. Not styled like Актуализировать. */
export function AvailabilityToggle({
  available,
  limitResetAt,
  disabled,
  onToggle,
}: {
  available?: boolean;
  limitResetAt: number | null;
  disabled?: boolean;
  onToggle: (nextAvailable: boolean) => Promise<void>;
}) {
  const [isSaving, setIsSaving] = useState(false);
  const account = { available, limitResetAt };
  const isAvailable = isGrokAccountAvailable(account);
  const status = getGrokAccountStatus(account);

  async function toggle() {
    setIsSaving(true);
    try {
      await onToggle(!isAvailable);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось обновить");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <button
      type="button"
      disabled={disabled || isSaving}
      onClick={toggle}
      title={
        isAvailable
          ? "Нажми — отметить как недоступный"
          : status === "resetToday"
            ? "Восстанавливается сегодня — нажми, чтобы отметить доступным"
            : "Нажми — отметить как доступный"
      }
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-50",
        STATUS_CHIP[status]
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[status])} />
      {STATUS_LABEL[status]}
    </button>
  );
}

export function ActualizePopover({
  limitResetAt,
  onSave,
}: {
  limitResetAt: number | null;
  onSave: (next: number | null) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(() => formatDateTimeManual(limitResetAt));
  const [isSaving, setIsSaving] = useState(false);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) setValue(formatDateTimeManual(limitResetAt));
  }

  const parsed = parseDateTimeManual(value);
  const invalid = parsed === undefined;

  async function save() {
    if (invalid) return;
    setIsSaving(true);
    try {
      await onSave(parsed ?? null);
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
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground" title="Указать время восстановления лимита">
          <RefreshCw className="h-3 w-3" />
          Актуализировать
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="start">
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
