import { Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function BulkActionBar({
  count,
  onDelete,
  onClear,
}: {
  count: number;
  onDelete: () => void;
  onClear: () => void;
}) {
  if (count <= 0) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-30 flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border/70 bg-card/80 px-2 py-1.5 shadow-[0_12px_40px_-18px_hsl(var(--primary)/0.5)] backdrop-blur-xl">
        <span className="pl-3 font-mono text-[11px] tabular text-muted-foreground">{count} выбрано</span>
        <Button variant="destructive" size="sm" className="h-8 rounded-full px-3" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" />
          Удалить
        </Button>
        <button
          type="button"
          onClick={onClear}
          className="mr-0.5 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Снять выделение"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
