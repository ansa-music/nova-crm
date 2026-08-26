import { useState } from "react";
import { Ban, CheckCircle2, Clock3, RefreshCw } from "lucide-react";
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
    <Button
      disabled={disabled || isSaving}
      onClick={toggle}
      title={
        isAvailable
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
      {STATUS_LABEL[status]}
    </Button>
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
