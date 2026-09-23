import type { StatusOption } from "@/types";
import { cn } from "@/utils/cn";
import { isDoneStatusLabel } from "@/utils/columnOptions";

interface StatusBadgeProps {
  value: string;
  options: StatusOption[];
  className?: string;
  showTick?: boolean;
  /**
   * «pill» — привычная пилюля с заливкой и рамкой (выпадашки, карточки,
   * настройки — два десятка вызовов по проекту, их не трогаем).
   * «plain» — «● Слово» без пилюли, для ячейки таблицы: в плотной строке 34px
   * пилюля съедала высоту, а цветной подписи и точки хватает, чтобы статус
   * читался. «Готово»-подобные — серым: сделанное не должно спорить с тем,
   * что ещё в работе (в макете «● Готово» приглушено, «● В работе» — бирюза).
   */
  variant?: "pill" | "plain";
  /**
   * Только для «plain»: гасить серым «Готово»-подобные варианты. Эвристика
   * `isDoneStatusLabel` смотрит на подпись, и без этого флага серым красились
   * варианты НЕ-статусных столбцов — ответственный «Готовцев», технарь
   * «done_master», кастомное «Закрыто». Включает его только столбец-статус.
   */
  muteDone?: boolean;
}

function tickPercent(label: string, index: number, total: number): number {
  const l = label.toLowerCase();
  if (l.includes("отмен") || l.includes("cancel") || l.includes("неактив")) return 0;
  if (l.includes("готов") || l.includes("done") || l.includes("успеш") || l.includes("закрыт")) return 100;
  if (l.includes("ожид") || l.includes("wait") || l.includes("отпуск")) return 62;
  if (l.includes("работ") || l.includes("progress") || l.includes("active") || l.includes("актив")) return 48;
  if (l.includes("нов") || l.includes("new") || l.includes("план")) return 14;
  if (total <= 1 || index < 0) return 0;
  return Math.round((index / (total - 1)) * 100);
}

export function StatusBadge({ value, options, className, showTick, variant = "pill", muteDone = false }: StatusBadgeProps) {
  const option = options.find((o) => o.value === value);
  if (!option) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  if (variant === "plain") {
    const done = muteDone && isDoneStatusLabel(option.label);
    return (
      <span
        className={cn("inline-flex min-w-0 max-w-full items-center gap-1.5 truncate text-[12.5px]", done && "text-muted-foreground", className)}
        style={done ? undefined : { color: `hsl(${option.color})` }}
      >
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: `hsl(${option.color})` }} aria-hidden />
        <span className="truncate">{option.label}</span>
      </span>
    );
  }
  const idx = options.findIndex((o) => o.value === value);
  const tick = showTick ? tickPercent(option.label, idx, options.length) : null;
  return (
    <span
      className={cn(
        "status-pill inline-flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden truncate rounded-full border px-2.5 py-[3px] text-[11px] font-medium",
        className
      )}
      style={{
        backgroundColor: `hsl(${option.color} / 0.16)`,
        color: `hsl(${option.color})`,
        borderColor: `hsl(${option.color} / 0.28)`,
      }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: `hsl(${option.color})` }} />
      <span className="truncate">{option.label}</span>
      {tick !== null && (
        <span className="status-tick pointer-events-none absolute inset-x-2 bottom-[3px] h-[2px] overflow-hidden rounded-full bg-current/20" aria-hidden>
          <span className="block h-full rounded-full bg-current" style={{ width: `${tick}%` }} />
        </span>
      )}
    </span>
  );
}
