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
    <div className={cn("flex flex-col items-center gap-3 px-6 py-16 text-center", className)}>
      {eyebrow && <p className="eyebrow text-primary">{eyebrow}</p>}
      <p className="text-[15px] font-medium tracking-[-0.02em]">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
