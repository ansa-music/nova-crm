import { Crown } from "lucide-react";
import { cn } from "@/utils/cn";
import { zonedDateFormat } from "@/utils/date";

/**
 * «Заказы от 300к+»: сколько крупных заказов человек получил с последнего
 * сброса (сбрасывает Owner). Ноль не рисуется.
 */
export function BigCountBadge({
  count,
  since,
  className,
}: {
  count: number | undefined;
  since?: number | null;
  className?: string;
}) {
  if (!count) return null;
  const from = since ? ` с ${zonedDateFormat("ru-RU", { day: "numeric", month: "short" }).format(since)}` : "";
  const label = `Получил заказов от 300 тыс: ${count}${from}`;
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-5 shrink-0 items-center justify-center gap-0.5 rounded-full bg-warning/20 px-1.5 font-mono text-[11px] font-semibold tabular-nums text-warning",
        className
      )}
      title={label}
      aria-label={label}
    >
      <Crown className="h-3 w-3" aria-hidden />
      {count}
    </span>
  );
}
