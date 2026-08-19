import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/utils/cn";

interface StatCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  trend?: string;
  trendUp?: boolean;
  color?: string;
  delay?: number;
}

export function StatCard({ label, value, icon: Icon, trend, trendUp, color = "243 75% 59%", delay = 0 }: StatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay }}
    >
      <Card className="relative overflow-hidden border-white/80 bg-card/90 p-5 shadow-card transition-all duration-300 hover:-translate-y-0.5 hover:shadow-popover dark:border-border">
        <div
          className="absolute -right-8 -top-8 h-28 w-28 rounded-full opacity-[0.12] blur-[1px]"
          style={{ backgroundColor: `hsl(${color})` }}
        />
        <div className="relative flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
            <p className="mt-2 text-2xl font-semibold tracking-[-0.04em]">{value}</p>
            {trend && (
              <p className={cn("mt-1 text-xs font-medium", trendUp ? "text-success" : "text-destructive")}>
                {trend}
              </p>
            )}
          </div>
          <span
            className="flex h-10 w-10 items-center justify-center rounded-2xl"
            style={{ backgroundColor: `hsl(${color} / 0.15)`, color: `hsl(${color})` }}
          >
            <Icon className="h-5 w-5" />
          </span>
        </div>
      </Card>
    </motion.div>
  );
}
