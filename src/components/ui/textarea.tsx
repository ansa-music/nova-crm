import * as React from "react";
import { cn } from "@/utils/cn";

/** Многострочное поле — те же правила, что у Input: нейтральная рамка, фокус кольцом 1px. */
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "flex w-full rounded-lg border border-border bg-background px-3 py-2 text-sm transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = "Textarea";
