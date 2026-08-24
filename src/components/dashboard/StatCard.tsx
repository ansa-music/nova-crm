import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
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
  color = "13 100% 57%",
  delay = 0,
}: StatCardProps) {
  const animated = useAnimatedNumber(animatedValue ?? 0);
  const displayValue =
    animatedValue !== undefined ? (formatAnimatedValue ?? Math.round)(animated) : value;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      <Card className="relative overflow-hidden bg-card/80 p-5">
        <span
          className="absolute inset-y-3 left-0 w-px rounded-full"
          style={{ backgroundColor: `hsl(${color})` }}
        />
        <div className="flex items-start justify-between pl-2">
          <div>
            <p className="eyebrow">{label}</p>
            <p className="display mt-2 text-[1.75rem] leading-none tabular">{displayValue}</p>
            {trend && (
              <p className={cn("mt-2 text-xs", trendUp ? "text-success" : "text-destructive")}>
                {trend}
              </p>
            )}
          </div>
          <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </div>
      </Card>
    </motion.div>
  );
}
