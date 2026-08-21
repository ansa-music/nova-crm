import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/utils/cn";
import { useAnimatedNumber } from "@/hooks/useAnimatedNumber";

interface StatCardProps {
  label: string;
  value: string;
  /** When given, animates count-up/down from the previous render instead of jumping straight to `value`. */
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
  color = "13 100% 57%",
  delay = 0,
}: StatCardProps) {
  const animated = useAnimatedNumber(animatedValue ?? 0);
  const displayValue =
    animatedValue !== undefined ? (formatAnimatedValue ?? Math.round)(animated) : value;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay }}
    >
      <Card className="group relative overflow-hidden border-t-2 bg-card/60 p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card" style={{ borderTopColor: `hsl(${color})` }}>
        <div className="flex items-start justify-between">
          <div>
            <p className="eyebrow">{label}</p>
            <p className="mt-2 text-3xl font-light tracking-[-0.02em] tabular-nums">{displayValue}</p>
            {trend && (
              <p className={cn("mt-1 text-xs font-medium", trendUp ? "text-success" : "text-destructive")}>
                {trend}
              </p>
            )}
          </div>
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:scale-110" />
        </div>
      </Card>
    </motion.div>
  );
}
