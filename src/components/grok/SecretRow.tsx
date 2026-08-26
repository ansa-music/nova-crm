import { Copy, Eye, EyeOff } from "lucide-react";
import { cn } from "@/utils/cn";

export function SecretRow({
  label,
  value,
  revealed,
  onToggle,
  onCopy,
  mono = true,
  empty = "не указан",
}: {
  label: string;
  value: string;
  revealed?: boolean;
  onToggle?: () => void;
  onCopy: () => void;
  mono?: boolean;
  empty?: string;
}) {
  const has = Boolean(value);
  const shown = !has ? empty : revealed === false ? "•".repeat(Math.max(6, value.length)) : value;
  return (
    <div className="grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-x-2">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={cn("truncate text-[13px] leading-5", mono && "font-mono tabular-nums text-[12px]", !has && "text-muted-foreground")}>
        {shown}
      </span>
      <span className="flex items-center">
        {onToggle && has && (
          <button
            type="button"
            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            title={revealed ? "Скрыть" : "Показать"}
            onClick={onToggle}
          >
            {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        )}
        {has && (
          <button
            type="button"
            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            title={`Копировать ${label.toLowerCase()}`}
            onClick={onCopy}
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        )}
      </span>
    </div>
  );
}
