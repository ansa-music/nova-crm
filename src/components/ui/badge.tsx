import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/utils/cn";

/**
 * Бейдж — короткая подпись состояния. Плоский: тонированная заливка без
 * рамки, рамка только у `outline`. `rounded-md` вместо `rounded-full` — пилюли
 * выпадали из шкалы скруглений 4/6/8/12/16.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border border-transparent px-2 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-primary/10 text-primary",
        secondary: "bg-muted text-foreground",
        destructive: "bg-destructive/12 text-destructive",
        success: "bg-success/15 text-success",
        warning: "bg-warning/15 text-warning",
        outline: "border-border text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant, className }))} {...props} />;
}
