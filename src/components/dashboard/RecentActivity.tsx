import { History, Pencil, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { timeAgo } from "@/utils/date";
import type { HistoryEntry } from "@/types";

const ACTION_ICON = {
  create: Plus,
  update: Pencil,
  delete: Trash2,
  restore: History,
} as const;

export function RecentActivity({ entries }: { entries: HistoryEntry[] }) {
  return (
    <Card className="bg-card/80">
      <CardHeader className="pb-2">
        <p className="eyebrow">Журнал</p>
        <CardTitle className="text-base font-medium">Недавняя активность</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {entries.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">Изменений пока нет</p>
        )}
        {entries.slice(0, 5).map((entry) => {
          const Icon = ACTION_ICON[entry.action];
          return (
            <div
              key={entry.id}
              className="flex items-start gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent/40"
            >
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted">
                <Icon className="h-3 w-3" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  <span className="font-medium">{entry.userName}</span>{" "}
                  {entry.action === "update" && `изменил(а) «${entry.fieldLabel ?? entry.field}»`}
                  {entry.action === "create" && "добавил(а) запись"}
                  {entry.action === "delete" && "удалил(а) запись"}
                  {entry.action === "restore" && "восстановил(а) значение"}
                  {entry.pageName && <span className="text-muted-foreground"> в «{entry.pageName}»</span>}
                </p>
                <p className="text-xs text-muted-foreground">{timeAgo(entry.timestamp)}</p>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
