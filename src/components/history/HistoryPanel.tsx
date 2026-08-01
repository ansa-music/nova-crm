import { History, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "@/components/ui/sonner";
import { useHistoryLog } from "@/hooks/useHistoryLog";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/hooks/useAuth";
import { updateRowCell } from "@/services/pageService";
import { timeAgo } from "@/utils/date";
import type { HistoryEntry } from "@/types";

const ACTION_ICON = { create: Plus, update: Pencil, delete: Trash2, restore: RotateCcw } as const;

interface HistoryPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  pageId?: string;
}

export function HistoryPanel({ open, onOpenChange, workspaceId, pageId }: HistoryPanelProps) {
  const { entries } = useHistoryLog(workspaceId, pageId);
  const permissions = usePermissions();
  const { profile } = useAuth();

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
      userName: profile?.name ?? "Пользователь",
      action: "restore",
    });
    toast.success("Значение восстановлено");
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <History className="h-4 w-4" /> История изменений
          </SheetTitle>
        </SheetHeader>
        <div className="mt-4 flex flex-col gap-1 overflow-y-auto scrollbar-thin" style={{ maxHeight: "calc(100vh - 6rem)" }}>
          {entries.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">История пуста</p>}
          {entries.map((entry) => {
            const Icon = ACTION_ICON[entry.action];
            return (
              <div key={entry.id} className="flex items-start gap-3 rounded-lg border border-transparent px-2 py-2.5 hover:border-border hover:bg-accent/30">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <span className="font-medium">{entry.userName}</span>{" "}
                    {entry.action === "update" && (
                      <>
                        изменил(а) «{entry.fieldLabel ?? entry.field}»: <span className="text-muted-foreground line-through">{String(entry.oldValue ?? "—")}</span>{" "}
                        → <span className="font-medium">{String(entry.newValue ?? "—")}</span>
                      </>
                    )}
                    {entry.action === "restore" && (
                      <>восстановил(а) «{entry.fieldLabel ?? entry.field}» до {String(entry.newValue ?? "—")}</>
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
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
