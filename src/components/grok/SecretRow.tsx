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
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="w-14 shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 truncate text-xs", mono && "font-mono tabular-nums", !has && "text-muted-foreground")}>
        {shown}
      </span>
      {onToggle && has && (
        <button
          type="button"
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          title={revealed ? "Скрыть" : "Показать"}
          onClick={onToggle}
        >
          {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      )}
      {has && (
        <button
          type="button"
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          title={`Копировать ${label.toLowerCase()}`}
          onClick={onCopy}
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
