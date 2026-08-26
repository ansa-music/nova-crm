import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { useHistoryLog } from "@/hooks/useHistoryLog";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { updateRowCell } from "@/services/pageService";
import { timeAgo } from "@/utils/date";
import { displayNameOf } from "@/utils/displayName";
import { getColumnOptions, isOptionColumn } from "@/utils/columnOptions";
import { cn } from "@/utils/cn";
import type { HistoryAction, HistoryEntry, PageColumn } from "@/types";

const PAGE_STEP = 10;

const ACTION_DOT: Record<HistoryAction, string> = {
  create: "bg-success",
  update: "bg-warning",
  delete: "bg-destructive",
  restore: "bg-primary",
};

const ACTION_LABEL: Record<HistoryAction, string> = {
  create: "создано",
  update: "изменено",
  delete: "удалено",
  restore: "восстановлено",
};

interface HistoryPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  pageId?: string;
  /** Lets entries for status/responsible columns show the human label ("Готово") instead of the raw stored value ("resp_d6oxr..."). */
  columns?: PageColumn[];
}

export function HistoryPanel({ open, onOpenChange, workspaceId, pageId, columns = [] }: HistoryPanelProps) {
  const { entries } = useHistoryLog(open ? workspaceId : null, pageId);
  const permissions = usePermissions();
  const { profile } = useAuth();
  const { activeWorkspace } = useWorkspace();
  // Resets to the last-10 view every time the panel is (re)opened or the
  // page changes, rather than staying expanded from a previous visit.
  const [visibleCount, setVisibleCount] = useState(PAGE_STEP);
  const visibleEntries = entries.slice(0, visibleCount);

  useEffect(() => {
    if (open) setVisibleCount(PAGE_STEP);
  }, [open, pageId]);

  // Status/responsible cells store the option's internal id ("resp_xxx" /
  // "done"), never the label a person actually typed — so a raw diff like
  // "→ resp_d6oxrufsmt0pxkoh" is meaningless. Resolve it back through the
  // same column-options source the table itself reads from.
  function formatValue(entry: HistoryEntry, value: HistoryEntry["oldValue"]) {
    const raw = value == null ? "" : String(value);
    if (!raw) return "—";
    const column = entry.field ? columns.find((c) => c.key === entry.field) : undefined;
    if (column && isOptionColumn(column.type)) {
      const label = getColumnOptions(column, activeWorkspace).find((o) => o.value === raw)?.label;
      if (label) return label;
    }
    return raw;
  }

  async function handleRestore(entry: HistoryEntry) {
    if (!entry.pageId || !entry.rowId || !entry.field) return;
    await updateRowCell({
      workspaceId,
      pageId: entry.pageId,
      pageName: entry.pageName ?? "",
      rowId: entry.rowId,
      field: entry.field,
      fieldLabel: entry.fieldLabel ?? entry.field,
      oldValue: entry.newValue,
      newValue: entry.oldValue,
      userId: profile?.uid ?? "",
      userName: displayNameOf(profile),
      action: "restore",
    });
    toast.success("Значение восстановлено");
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="h-full w-full max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <History className="h-4 w-4" /> История изменений
          </SheetTitle>
        </SheetHeader>
        <div className="mt-4 overflow-y-auto scrollbar-thin" style={{ maxHeight: "calc(100vh - 6rem)" }}>
          {entries.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">История пуста</p>}
          {visibleEntries.length > 0 && (
            <ol className="relative ml-1">
              <span
                className="pointer-events-none absolute bottom-3 left-[5px] top-3 w-px bg-border"
                aria-hidden
              />
              {visibleEntries.map((entry) => (
                <li key={entry.id} className="relative flex items-start gap-3 py-2.5">
                  <span
                    className={cn(
                      "relative z-[1] mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-background",
                      ACTION_DOT[entry.action]
                    )}
                    title={ACTION_LABEL[entry.action]}
                    aria-label={ACTION_LABEL[entry.action]}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="font-medium">{entry.userName}</span>{" "}
                      {entry.action === "update" && (
                        <>
                          изменил(а) «{entry.fieldLabel ?? entry.field}»:{" "}
                          <span className="text-muted-foreground line-through">
                            {formatValue(entry, entry.oldValue)}
                          </span>{" "}
                          → <span className="font-medium">{formatValue(entry, entry.newValue)}</span>
                        </>
                      )}
                      {entry.action === "restore" && (
                        <>восстановил(а) «{entry.fieldLabel ?? entry.field}» до {formatValue(entry, entry.newValue)}</>
                      )}
                      {entry.action === "create" && "добавил(а) запись"}
                      {entry.action === "delete" && "удалил(а) запись"}
                    </p>
                    <div className="mt-0.5 flex items-center gap-2">
                      <p className="text-xs text-muted-foreground">
                        {entry.pageName && `${entry.pageName} · `}
                        {timeAgo(entry.timestamp)}
                      </p>
                      {permissions.canRestoreHistory && entry.action === "update" && entry.rowId && (
                        <button
                          onClick={() => handleRestore(entry)}
                          className="text-xs font-medium text-primary hover:underline"
                        >
                          Восстановить
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        {entries.length > visibleCount && (
          <Button
            variant="outline"
            size="sm"
            className="mt-2 w-full"
            onClick={() => setVisibleCount((c) => c + PAGE_STEP)}
          >
            Показать ещё {Math.min(PAGE_STEP, entries.length - visibleCount)}
          </Button>
        )}
      </SheetContent>
    </Sheet>
  );
}
