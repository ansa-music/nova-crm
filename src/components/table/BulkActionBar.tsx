import { CheckCircle2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/table/StatusBadge";
import type { StatusOption } from "@/types";

export function BulkActionBar({
  count,
  onDelete,
  onClear,
  statusOptions,
  onSetStatus,
  canEdit,
}: {
  count: number;
  onDelete: () => void;
  onClear: () => void;
  statusOptions?: StatusOption[];
  onSetStatus?: (value: string) => void;
  canEdit?: boolean;
}) {
  if (count <= 0) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-30 flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-2 rounded-sm border border-primary/40 bg-card px-2 py-1.5 shadow-[0_12px_40px_-18px_hsl(var(--primary)/0.5)]">
        <span className="pl-2 font-mono text-[11px] tabular text-muted-foreground">{count} выбрано</span>
        {canEdit && onSetStatus && statusOptions && statusOptions.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-10 gap-1.5 rounded-full px-3 sm:h-8">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Статус
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center">
              {statusOptions.map((opt) => (
                <DropdownMenuItem key={opt.value} onClick={() => onSetStatus(opt.value)}>
                  <StatusBadge value={opt.value} options={statusOptions} showTick />
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button variant="destructive" size="sm" className="h-10 rounded-full px-3 sm:h-8" onClick={onDelete} disabled={!canEdit}>
          <Trash2 className="h-3.5 w-3.5" />
          Удалить
        </Button>
        <button
          type="button"
          onClick={onClear}
          className="mr-0.5 flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-transform transition-colors select-none hover:bg-accent hover:text-foreground active:scale-[0.97] active:translate-y-px motion-reduce:active:scale-100 motion-reduce:active:translate-y-0 sm:h-8 sm:w-8"
          title="Снять выделение"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
