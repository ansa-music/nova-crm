import * as React from "react";
import { cn } from "@/utils/cn";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        // Spec "Inputs": surface a touch lighter than the ground, thin cyan
        // edge that goes solid + emits a faint glow on focus.
        "flex h-9 w-full rounded-lg border border-primary/20 bg-white/[0.03] px-3 py-1 text-sm transition-[border-color,box-shadow] duration-200 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary focus-visible:shadow-[0_0_8px_hsl(var(--primary)/0.35)] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";
