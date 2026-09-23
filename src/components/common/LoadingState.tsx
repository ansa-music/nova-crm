import { Loader2 } from "lucide-react";
import { cn } from "@/utils/cn";

/**
 * Единая заглушка загрузки для экранов-лент: спиннер и подпись. До неё в
 * каждом разделе был свой `<p className="py-10 …">Загружаем…</p>` с разными
 * отступами, и при переходе между страницами заглушка «прыгала».
 */
export function LoadingState({
  label = "Загружаем…",
  className,
  compact = false,
}: {
  label?: string;
  className?: string;
  /** Внутри карточки/панели — py-6 вместо py-10. */
  compact?: boolean;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground",
        compact ? "py-6" : "py-10",
        className
      )}
    >
      <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden />
      <span>{label}</span>
    </div>
  );
}
