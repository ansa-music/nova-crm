import type { LucideIcon } from "lucide-react";
import { Sparkline } from "@/components/dashboard/Sparkline";
import { cn } from "@/utils/cn";

interface KpiStatCardProps {
  icon: LucideIcon;
  /** HSL triplet, e.g. "189 100% 72%". */
  color: string;
  label: string;
  value: string;
  trend: number[];
  delta: { text: string; tone: "up" | "down" | "flat" };
}

export function KpiStatCard({ icon: Icon, color, label, value, trend, delta }: KpiStatCardProps) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2.5">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: `hsl(${color} / 0.15)`, color: `hsl(${color})` }}
        >
          <Icon className="h-4 w-4" />
        </span>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
      </div>
      <div className="flex items-end justify-between gap-2">
        <p className="tabular text-[1.65rem] font-medium leading-none tracking-[-0.03em]">{value}</p>
        <Sparkline points={trend} color={color} width={72} height={32} />
      </div>
      {delta.text && (
        <p
          className={cn(
            "text-[11px]",
            delta.tone === "up" && "text-success",
            delta.tone === "down" && "text-destructive",
            delta.tone === "flat" && "text-muted-foreground"
          )}
        >
          {delta.text}
        </p>
      )}
    </div>
  );
}
