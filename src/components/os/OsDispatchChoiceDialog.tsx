import { useState } from "react";
import { Loader2, Store, UserCheck } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TechPickerSheet } from "@/components/os/TechPickerSheet";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useSendOsRowToExchange } from "@/hooks/useSendOsRowToExchange";
import { OS_DESK_KEYS, type OsDeskKeys } from "@/services/osDeskService";
import { sbPatchRow } from "@/services/rows/supabaseRowStore";
import {
  DEFAULT_STATUS_OPTIONS,
  ensureApprovalStatus,
  ensureDoneStatus,
  findInProgressStatusOption,
  isApprovalStatusValue,
} from "@/utils/columnOptions";
import { firestoreErrorText } from "@/utils/dbError";
import type { PageRow } from "@/types";

/**
 * «Как отдать заказ?» — спрашивает стол ОС, когда заказ переходит из
 * «Утверждения» в работу (просьба Nurba 23.09.2026):
 * - «Общий» — на биржу «Заказы», всем технарям; отдаёте, когда откликнутся;
 * - «Выборочно» — сразу выбранному технарю (и это увидят Тимлид и Owner во
 *   «Выдачах ОС»).
 * Сам диалог только пишет строку стола ОС (ник технаря) или выставляет заказ
 * на биржу — доставку технарю делает проход стола (useOsDeskDispatch).
 */
export function OsDispatchChoiceDialog({
  row,
  pageId,
  subPageId,
  keys = OS_DESK_KEYS,
  onClose,
}: {
  row: PageRow;
  pageId: string;
  subPageId: string | null;
  /** Ключи ячеек открытой таблицы стола ОС. */
  keys?: OsDeskKeys;
  onClose: () => void;
}) {
  const { activeWorkspaceId, activeWorkspace } = useWorkspace();
  const sendToExchange = useSendOsRowToExchange();
  const TECH_KEY = keys.technician;
  const STATUS_KEY = keys.status;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const statusOptions = ensureApprovalStatus(ensureDoneStatus(activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS));
  const client = String(row.cells[keys.client] ?? "").trim() || "Заказ";

  /** Статус «Утверждение» снимается: заказ отдают — значит, он в работе. */
  function statusPatch(): Record<string, string> {
    const current = row.cells[STATUS_KEY];
    if (!isApprovalStatusValue(current, statusOptions)) return {};
    const inProgress = findInProgressStatusOption([...statusOptions])?.value;
    return inProgress ? { [STATUS_KEY]: inProgress } : {};
  }

  async function giveToTech(nick: string, name: string) {
    if (!activeWorkspaceId) return;
    setBusy(true);
    try {
      await sbPatchRow(activeWorkspaceId, pageId, subPageId, row.id, { cells: { [TECH_KEY]: nick, ...statusPatch() } });
      toast.success(`${client} → ${name}`, { description: "Заказ уедет в его стол через секунду." });
      onClose();
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось выбрать технаря"));
    } finally {
      setBusy(false);
    }
  }

  async function giveToAll() {
    if (!activeWorkspaceId) return;
    setBusy(true);
    try {
      await sendToExchange({ row, pageId, tabId: subPageId, keys });
      toast.success(`${client} — на «Заказах»`, {
        description: "Технари получили уведомление. Отдайте заказ, когда откликнутся, — он приедет к технарю сам.",
      });
      onClose();
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось выставить заказ на «Заказы»"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <TechPickerSheet
      open={pickerOpen}
      title={`Кому отдать «${client}»?`}
      description="Заказ уедет в стол выбранного технаря. Тимлид и Owner увидят выдачу во «Выдачах ОС»."
      busy={busy}
      onPick={(tech) => void giveToTech(tech.nick, tech.name)}
      onClose={() => setPickerOpen(false)}
    />
    <Dialog open={!pickerOpen} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>Как отдать заказ «{client}»?</DialogTitle>
          <DialogDescription>
            Заказ в работе. Отдайте его всем на «Заказы» или сразу выбранному технарю.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void giveToAll()}
              className="flex min-h-24 flex-col items-start gap-1.5 rounded-xl border border-border p-3 text-left transition-colors hover:border-primary/60 hover:bg-primary/5 disabled:opacity-60"
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Store className="h-4 w-4 text-primary" />}
                Общий
              </span>
              <span className="text-xs text-muted-foreground">На биржу «Заказы» — всем технарям. Отдадите тому, кто откликнется.</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setPickerOpen(true)}
              className="flex min-h-24 flex-col items-start gap-1.5 rounded-xl border border-border p-3 text-left transition-colors hover:border-primary/60 hover:bg-primary/5 disabled:opacity-60"
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <UserCheck className="h-4 w-4 text-primary" />
                Выборочно
              </span>
              <span className="text-xs text-muted-foreground">Сразу одному технарю — выберете его на следующем шаге.</span>
            </button>
        </div>

        <div className="flex flex-wrap justify-between gap-2 border-t border-border/60 pt-3">
          <span />
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Позже
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
