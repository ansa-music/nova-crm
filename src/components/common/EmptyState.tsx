import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

export function EmptyState({
  eyebrow,
  title,
  description,
  action,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-3 px-8 py-20 text-center", className)}>
      <div className="mb-1 h-px w-10 bg-primary/70" />
      {eyebrow && <p className="eyebrow text-primary">{eyebrow}</p>}
      <p className="display text-[1.35rem] tracking-[-0.03em]">{title}</p>
      {description && <p className="max-w-sm text-sm leading-6 text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
