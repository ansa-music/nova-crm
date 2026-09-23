import { useState } from "react";
import { ArrowUpRight, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/table/StatusBadge";
import { toast } from "@/components/ui/sonner";
import { useWorkspace } from "@/hooks/useWorkspace";
import { OS_DESK_COLUMNS } from "@/services/osDeskService";
import { pushOrderToTech, findTechTarget, techTargetProblem, techUidByNick } from "@/services/rows/osOrderMirror";
import { sbPatchRow } from "@/services/rows/supabaseRowStore";
import { DEFAULT_STATUS_OPTIONS, findInProgressStatusOption } from "@/utils/columnOptions";
import { firestoreErrorText } from "@/utils/dbError";
import { personLabel } from "@/utils/peopleDesks";
import type { PageRow } from "@/types";

/**
 * Заказ в карточке строки стола ОС: кому выдан, какой статус и кнопка выдачи.
 *
 * Статус живёт в строке СТОЛА ТЕХНАРЯ — по ней считают «Технари», дашборд и
 * оценки, — поэтому здесь он и читается, и пишется: у ОС есть право на свои
 * строки в чужих столах. Столбца статуса на столе ОС нет намеренно (так
 * просил Nurba: «из карточки строки»).
 */
export function OsOrderPanel({
  row,
  pageId,
  subPageId,
  osUid,
  osNickValue,
  mirror,
  onChanged,
}: {
  row: PageRow;
  pageId: string;
  subPageId: string | null;
  osUid: string;
  osNickValue: string;
  /** Строка этого заказа в столе технаря, если он уже выдан. */
  mirror: PageRow | null;
  onChanged: () => void;
}) {
  const { activeWorkspaceId, activeWorkspace, pages, members } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const statusOptions = activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS;

  const techColumn = OS_DESK_COLUMNS.find((c) => c.type === "technician");
  const techNick = techColumn ? String(row.cells[techColumn.key] ?? "") : "";
  const techUid = techUidByNick(members, techNick);
  const problem = techTargetProblem(pages, techUid);
  const target = techUid ? findTechTarget(pages, techUid) : null;
  const statusKey = mirror?.statusKey ?? target?.keys.status ?? null;
  const status = mirror && statusKey ? String(mirror.cells[statusKey] ?? "") : "";

  const techName = techUid ? personLabel(members.find((m) => m.uid === techUid)) : techNick;

  async function handlePush() {
    if (!activeWorkspaceId || !target || !techUid) {
      toast.error(problem ?? "Не удалось определить стол технаря");
      return;
    }
    setBusy(true);
    try {
      await pushOrderToTech({
        workspaceId: activeWorkspaceId,
        osUid,
        osNickValue,
        source: row,
        srcPageId: pageId,
        srcTabId: subPageId,
        osColumns: {
          client: "client",
          phone: "phone",
          price: "price",
          upsell: "upsell",
          note: "note",
          link: "link",
        },
        target,
        techUid,
        status: status || findInProgressStatusOption(statusOptions)?.value || "",
      });
      toast.success(mirror ? "Заказ обновлён у технаря" : `Заказ у технаря: ${techName}`);
      onChanged();
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось отдать заказ технарю"));
    } finally {
      setBusy(false);
    }
  }

  async function handleStatus(value: string) {
    if (!activeWorkspaceId || !mirror || !statusKey) return;
    setBusy(true);
    try {
      await sbPatchRow(activeWorkspaceId, mirror.deskPageId ?? "", mirror.tabId ?? "", mirror.id, {
        cells: { [statusKey]: value },
        // Решили по просьбе технаря — чип «просит успешку» гаснет.
        clearSuccessRequest: true,
      });
      onChanged();
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось поменять статус"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Заказ у технаря</span>
        {mirror && (
          <span className="text-xs text-muted-foreground">
            {mirror.syncHash && row.syncHash && mirror.syncHash !== row.syncHash ? "правка не доехала" : "в работе у технаря"}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Технарь:</span>
        <span className="font-medium">{techName || "не выбран"}</span>
      </div>

      {mirror && statusKey ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Статус:</span>
          <Select value={status} onValueChange={(v) => void handleStatus(v)} disabled={busy}>
            <SelectTrigger className="h-9 w-[190px]">
              <SelectValue placeholder="Выберите статус" />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  <StatusBadge value={o.value} options={statusOptions} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {mirror.successRequestedAt ? (
            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
              технарь просит «Успешку»
            </span>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {problem ?? "Заказ ещё не выдан — статус появится после выдачи."}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" className="min-h-9" onClick={() => void handlePush()} disabled={busy || Boolean(problem)}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : mirror ? <RefreshCw className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
          {mirror ? "Обновить у технаря" : "Выдать в работу"}
        </Button>
      </div>
    </div>
  );
}
