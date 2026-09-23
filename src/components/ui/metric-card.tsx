import * as React from "react";
import { cn } from "@/utils/cn";

export type MetricTone = "neutral" | "primary" | "success" | "warning" | "danger";

const VALUE_BY_TONE: Record<MetricTone, string> = {
  neutral: "text-foreground",
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
};

const METER_BY_TONE: Record<MetricTone, string> = {
  neutral: "bg-foreground/60",
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
};

export interface MetricCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Подпись сверху — моно 10px капителью (eyebrow). */
  label: React.ReactNode;
  /** Число. Моно, табличные цифры — столбик метрик выравнивается по разрядам. */
  value: React.ReactNode;
  /** Строка под числом: «из 12», «+3 за неделю». */
  sub?: React.ReactNode;
  /** Доля 0..1 — тонкая полоска под числом. Вне диапазона обрезается. */
  meter?: number;
  /** Цвет числа и полоски. По умолчанию нейтральный — акцент только у главной метрики. */
  tone?: MetricTone;
  size?: "sm" | "md";
}

/**
 * Плитка метрики для дашборда и статистики стола: label → value → sub →
 * meter. Плоская карточка `bg-card border-border`, без стекла и свечения —
 * иерархию задаёт только размер и моно-шрифт числа.
 */
export const MetricCard = React.forwardRef<HTMLDivElement, MetricCardProps>(
  ({ label, value, sub, meter, tone = "neutral", size = "md", className, children, ...rest }, ref) => {
    const ratio = typeof meter === "number" && Number.isFinite(meter) ? Math.min(1, Math.max(0, meter)) : null;
    return (
      <div
        ref={ref}
        className={cn(
          "flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-card",
          size === "sm" ? "px-3 py-2.5" : "px-4 py-3",
          className
        )}
        {...rest}
      >
        <p className="eyebrow truncate">{label}</p>
        <p
          className={cn(
            "font-mono font-medium tabular-nums leading-none tracking-[-0.01em]",
            size === "sm" ? "text-[1.1rem]" : "text-[1.4rem]",
            VALUE_BY_TONE[tone]
          )}
        >
          {value}
        </p>
        {sub && <p className="text-[11px] leading-4 text-muted-foreground">{sub}</p>}
        {ratio !== null && (
          <div className="mt-1 h-1 w-full overflow-hidden rounded-sm bg-border" role="presentation">
            <div className={cn("h-full rounded-sm transition-[width] duration-300", METER_BY_TONE[tone])} style={{ width: `${ratio * 100}%` }} />
          </div>
        )}
        {children}
      </div>
    );
  }
);
MetricCard.displayName = "MetricCard";
