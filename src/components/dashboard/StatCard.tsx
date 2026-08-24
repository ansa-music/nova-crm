import type { LucideIcon } from "lucide-react";
import { cn } from "@/utils/cn";
import { useAnimatedNumber } from "@/hooks/useAnimatedNumber";

interface StatCardProps {
  label: string;
  value: string;
  animatedValue?: number;
  formatAnimatedValue?: (n: number) => string;
  icon: LucideIcon;
  trend?: string;
  trendUp?: boolean;
  color?: string;
  delay?: number;
}

export function StatCard({
  label,
  value,
  animatedValue,
  formatAnimatedValue,
  icon: Icon,
  trend,
  trendUp,
  color = "189 100% 72%",
}: StatCardProps) {
  const animated = useAnimatedNumber(animatedValue ?? 0);
  const displayValue =
    animatedValue !== undefined ? (formatAnimatedValue ?? Math.round)(animated) : value;

  return (
    <div className="desk-metric relative">
      <span
        className="absolute inset-y-4 left-0 w-px rounded-full"
        style={{ backgroundColor: `hsl(${color})` }}
      />
      <div className="flex items-start justify-between pl-3">
        <div>
          <p className="eyebrow">{label}</p>
          <p className="display mt-2 text-[1.65rem] leading-none tabular">{displayValue}</p>
          {trend && (
            <p className={cn("mt-2 text-xs", trendUp ? "text-success" : "text-destructive")}>
              {trend}
            </p>
          )}
        </div>
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
      </div>
    </div>
  );
}
