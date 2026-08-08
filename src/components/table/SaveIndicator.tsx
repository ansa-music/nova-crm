// PATH: src/components/table/SaveIndicator.tsx  (NEW FILE)
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { cn } from "@/utils/cn";
import type { SaveState } from "@/hooks/useCellCommit";

/** Per-cell save badge. Renders nothing when idle so the grid stays quiet. */
export function CellSaveDot({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  return (
    <span
      className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2"
      aria-hidden="true"
    >
      {state === "saving" && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      {state === "saved" && <Check className="h-3 w-3 text-success" />}
      {state === "error" && <AlertCircle className="h-3 w-3 text-destructive" />}
    </span>
  );
}

/** Table-level status shown in the toolbar. */
export function TableSaveStatus({
  hasUnsavedWork,
  hasFailedWrites,
  className,
}: {
  hasUnsavedWork: boolean;
  hasFailedWrites: boolean;
  className?: string;
}) {
  if (!hasUnsavedWork) return null;
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs",
        hasFailedWrites ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
        className
      )}
    >
      {hasFailedWrites ? (
        <>
          <AlertCircle className="h-3 w-3" /> Не удалось сохранить
        </>
      ) : (
        <>
          <Loader2 className="h-3 w-3 animate-spin" /> Сохранение...
        </>
      )}
    </span>
  );
}
