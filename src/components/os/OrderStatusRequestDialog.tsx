import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Hand, Loader2, Send, Undo2 } from "lucide-react";
import { StatusBadge } from "@/components/table/StatusBadge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  ORDER_REQUEST_NOTE_MAX,
  orderRequestId,
  withdrawOrderRequest,
  type OrderRequest,
} from "@/services/orderRequestService";
import { requestOrderStatus } from "@/services/orderStatusRequest";
import { cn } from "@/utils/cn";
import { findDoneStatusOption, isApprovalOption } from "@/utils/columnOptions";
import { firestoreErrorText } from "@/utils/dbError";
import { myDisplayName } from "@/utils/displayName";
import { pickRowCardColumns } from "@/utils/rowCardColumns";
import type { PageColumn, PageRow, StatusOption } from "@/types";

/**
 * «Попросить ОС сменить статус» — из ячейки статуса заказа ОС (кнопка
 * «Готово?») и из карточки строки. «Готово» — главная кнопка сверху: это
 * почти всегда то, о чём просят; остальные статусы — чипами ниже.
 * Открывают технарь и Owner за своим столом (у Owner статус и так открыт,
 * но заказ ведёт ОС, и порядок — через него).
 */
export function OrderStatusRequestDialog({
  row,
  workspaceId,
  deskPageId,
  deskTabId,
  deskName,
  columns,
  statusKey,
  statusOptions,
  osUid,
  pending,
  onClose,
}: {
  row: PageRow | null;
  workspaceId: string;
  deskPageId: string;
  deskTabId: string | null;
  deskName: string;
  columns: PageColumn[];
  /** Ключ столбца статуса в этой таблице — показать, что стоит сейчас. */
  statusKey: string | null;
  statusOptions: StatusOption[];
  /** Кого просим: ОС заказа — или, если ОС его ещё не ведёт, ОС по нику в столбце ОС. */
  osUid?: string | null;
  /** Ожидающая просьба по этой строке (живой список `subscribeMyPendingOrderRequests`). */
  pending: OrderRequest | null;
  onClose: () => void;
}) {
  const { profile } = useAuth();
  const { members } = useWorkspace();
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"send" | "done" | "withdraw" | null>(null);

  useEffect(() => {
    setPicked(null);
    setNote("");
    setBusy(null);
  }, [row?.id]);

  const done = useMemo(() => findDoneStatusOption(statusOptions), [statusOptions]);
  const others = useMemo(
    () => statusOptions.filter((o) => !o.inactive && !isApprovalOption(o) && o.value !== done?.value),
    [statusOptions, done]
  );
  if (!row) return null;
  const current = statusKey ? String(row.cells[statusKey] ?? "") : "";
  const me = profile?.uid ?? "";
  const meName = myDisplayName(profile, members);

  function clientName(): string {
    const picked = pickRowCardColumns(columns);
    return picked.title ? String(row?.cells[picked.title.key] ?? "").trim() : "";
  }

  async function send(option: StatusOption, which: "send" | "done") {
    if (!row || !me) return;
    setBusy(which);
    try {
      await requestOrderStatus({
        workspaceId,
        row,
        deskPageId,
        deskTabId,
        deskName,
        me,
        meName,
        status: option.value,
        statusLabel: option.label,
        note,
        client: clientName(),
        done: option.value === done?.value,
        members,
        osUid: osUid ?? null,
      });
      toast.success(`Попросили «${option.label}»`, {
        description: "ОС получил уведомление и решит в своём столе.",
      });
      onClose();
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось отправить просьбу"));
    } finally {
      setBusy(null);
    }
  }

  async function withdraw() {
    if (!row) return;
    setBusy("withdraw");
    try {
      await withdrawOrderRequest(workspaceId, pending?.id ?? orderRequestId(deskPageId, row.id));
      toast.success("Просьба отозвана");
      onClose();
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось отозвать"));
    } finally {
      setBusy(null);
    }
  }

  const pickedOption = picked ? others.find((o) => o.value === picked) ?? null : null;

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Hand className="h-4 w-4" /> Попросить ОС сменить статус
          </DialogTitle>
          <DialogDescription>
            {row.osUid
              ? "Заказ ведёт ОС — он и ставит статус."
              : "Статус поставит ОС из столбца «ОС» — заказ при этом перейдёт к нему на стол."}{" "}
            Сейчас:{" "}
            {current ? <StatusBadge value={current} options={statusOptions} variant="plain" /> : "без статуса"}
          </DialogDescription>
        </DialogHeader>

        {pending ? (
          <div className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm">
            <span className="font-medium text-warning">
              Уже просите: «{pending.statusLabel ?? pending.status ?? "удалить"}»
            </span>
            {pending.note ? <span className="text-xs text-muted-foreground">{pending.note}</span> : null}
            <span className="text-xs text-muted-foreground">Чтобы попросить другое — сначала отзовите эту просьбу.</span>
            <Button
              size="sm"
              variant="outline"
              className="min-h-11 self-start gap-1.5 sm:min-h-9"
              disabled={Boolean(busy)}
              onClick={() => void withdraw()}
            >
              {busy === "withdraw" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
              Отозвать
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {done ? (
              <Button
                className="min-h-12 w-full justify-center gap-2 text-base"
                disabled={Boolean(busy) || current === done.value}
                onClick={() => void send(done, "done")}
              >
                {busy === "done" ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
                {current === done.value ? `Уже «${done.label}»` : `Попросить «${done.label}»`}
              </Button>
            ) : null}

            {others.length ? (
              <div className="flex flex-col gap-1.5">
                <span className="eyebrow">Или другой статус</span>
                <div className="flex flex-wrap gap-1.5">
                  {others.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      disabled={Boolean(busy) || o.value === current}
                      aria-pressed={picked === o.value}
                      onClick={() => setPicked((v) => (v === o.value ? null : o.value))}
                      className={cn(
                        "inline-flex min-h-11 items-center rounded-md border px-2.5 text-sm transition-colors disabled:opacity-50 sm:min-h-8",
                        picked === o.value
                          ? "border-primary/40 bg-primary/12 text-primary"
                          : "border-border hover:bg-accent"
                      )}
                    >
                      <StatusBadge value={o.value} options={statusOptions} variant="plain" />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <Input
              value={note}
              maxLength={ORDER_REQUEST_NOTE_MAX}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Комментарий для ОС (необязательно)"
              className="h-10"
            />

            {pickedOption ? (
              <Button
                variant="outline"
                className="min-h-11 gap-1.5 sm:min-h-9"
                disabled={Boolean(busy)}
                onClick={() => void send(pickedOption, "send")}
              >
                {busy === "send" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Попросить «{pickedOption.label}»
              </Button>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
