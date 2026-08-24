import { cn } from "@/utils/cn";

export function BrandMark({ className, size = "md" }: { className?: string; size?: "sm" | "md" }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className={cn("wordmark leading-none", size === "sm" ? "text-lg" : "text-[22px]")}>NOVA</span>
    </span>
  );
}
