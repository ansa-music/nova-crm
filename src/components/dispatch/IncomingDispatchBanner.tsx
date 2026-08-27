import { useState } from "react";
import { PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { useMyDispatchRequests } from "@/hooks/useMyDispatchRequests";
import { useWorkspace } from "@/hooks/useWorkspace";
import { acceptDispatchRequest } from "@/services/dailyDispatchService";
import { tryWriteDispatchOrderToSheet } from "@/services/dispatchSheetWrite";
import { formatCurrency } from "@/utils/format";
import type { DailyDispatch, WorkspacePage } from "@/types";

/**
 * Shown only on your own desk (isOwnDesk in DynamicTablePage) — the
 * technician-side half of Выдача: orders an Admin/Owner assigned to you
 * through the roster show up here to accept, instead of silently landing
 * as rows you never agreed to.
 */
export function IncomingDispatchBanner({
  workspaceId,
  uid,
  page,
}: {
  workspaceId: string;
  uid: string;
  page: WorkspacePage;
}) {
  const { data: requests, reload } = useMyDispatchRequests(workspaceId, uid, true);
  const { pages, activeWorkspace } = useWorkspace();
  const pending = requests.filter((r) => r.requestStatus === "pending");
  const acceptedUnwritten = requests.filter((r) => r.requestStatus === "accepted" && !r.sheetRowId);
  const visible = [...pending, ...acceptedUnwritten];
  const [busyId, setBusyId] = useState<string | null>(null);

  if (visible.length === 0) return null;

  async function writeRow(row: DailyDispatch): Promise<boolean> {
    const result = await tryWriteDispatchOrderToSheet({
      workspaceId,
      uid,
      entry: row,
      ownPage: page,
      pages,
      responsibleOptions: activeWorkspace?.responsibleOptions ?? [],
    });
    if (result.ok) {
      return true;
    }
    if (result.reason === "no-mapping" || result.reason === "bad-columns") {
      toast.error("Owner ещё не настроил столбцы в Выдаче");
    } else if (result.reason === "not-own") {
      toast.error("Этот заказ не на твой стол");
    } else if (result.reason === "no-sheet") {
      toast.error("Нет листа текущего месяца");
    } else if (result.reason === "already") {
      return true;
    }
    return false;
  }

  async function handleAccept(row: DailyDispatch) {
    setBusyId(row.id);
    try {
      await acceptDispatchRequest(workspaceId, row.id);
      const written = await writeRow({ ...row, requestStatus: "accepted", acceptedAt: Date.now() });
      toast.success(written ? `Заказ по чеку ${row.checkNo} принят и в столе` : `Заказ по чеку ${row.checkNo} принят`);
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось принять заказ");
    } finally {
      setBusyId(null);
    }
  }

  async function handleToSheet(row: DailyDispatch) {
    setBusyId(row.id);
    try {
      const written = await writeRow(row);
      if (written) toast.success(`Чек ${row.checkNo} в столе`);
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось добавить в стол");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="border-b border-primary/30 bg-primary/5 px-4 py-3 sm:px-6">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary">
        <PackageCheck className="h-4 w-4" />
        Новые заказы для тебя ({visible.length})
      </div>
      <div className="flex flex-col gap-2">
        {visible.map((row) => (
          <div
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/25 bg-card px-3 py-2"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">Чек {row.checkNo}</p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                {row.amount > 0 && <span className="tabular">{formatCurrency(row.amount)}</span>}
                {row.minutes != null && <span>{row.minutes} мин</span>}
                {row.character && <span className="truncate">{row.character}</span>}
                {row.os && <span className="truncate">ОС: {row.os}</span>}
              </div>
            </div>
            {row.requestStatus === "pending" ? (
              <Button size="sm" className="h-8 shrink-0" disabled={busyId === row.id} onClick={() => handleAccept(row)}>
                Принять
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="h-8 shrink-0"
                disabled={busyId === row.id}
                onClick={() => handleToSheet(row)}
              >
                в стол
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
