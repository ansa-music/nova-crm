import { cn } from "@/utils/cn";

export function BrandMark({ className, size = "md" }: { className?: string; size?: "sm" | "md" }) {
  const box = size === "sm" ? "h-7 w-7 text-[11px]" : "h-9 w-9 text-xs";
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-[5px] bg-primary font-mono font-semibold tracking-[0.08em] text-primary-foreground",
          box
        )}
      >
        N
      </span>
      <span className="font-mono text-[11px] font-medium uppercase tracking-[0.22em] text-foreground">
        Nova
      </span>
    </span>
  );
}
