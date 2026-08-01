import type { StatusOption } from "@/types";
import { cn } from "@/utils/cn";

interface StatusBadgeProps {
  value: string;
  options: StatusOption[];
  className?: string;
}

export function StatusBadge({ value, options, className }: StatusBadgeProps) {
  const option = options.find((o) => o.value === value);
  if (!option) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 truncate rounded-full px-2.5 py-1 text-xs font-medium",
        className
      )}
      style={{ backgroundColor: `hsl(${option.color} / 0.15)`, color: `hsl(${option.color})` }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: `hsl(${option.color})` }} />
      <span className="truncate">{option.label}</span>
    </span>
  );
}
