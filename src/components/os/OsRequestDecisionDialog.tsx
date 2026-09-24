import { useState } from "react";
import { Check, Hand, Loader2, X } from "lucide-react";
import { StatusBadge } from "@/components/table/StatusBadge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { decideOrderRequest } from "@/services/orderRequestDecision";
import type { OrderRequest } from "@/services/orderRequestService";
import { timeAgo } from "@/utils/date";
import { firestoreErrorText } from "@/utils/dbError";
import { displayNameOf, myDisplayName } from "@/utils/displayName";
import type { PageRow, StatusOption } from "@/types";

/**
 * ОС решает просьбу технаря прямо из строки своего стола (метка «Просит: …»
 * в ячейке статуса) — жалоба Nurba 25.09.2026: «у ОС ничего такого удобного
 * нет». Имя технаря — из участников по uid, а не из запроса (его пишет сам
 * просящий); клиент — из строки ОС.
 */
export function OsRequestDecisionDialog({
  request,
  row,
  osUid,
  mirrors,
  statusKey,
  statusOptions,
  clientKey,
  onClose,
  onChanged,
}: {
  request: OrderRequest | null;
  /** Строка стола ОС, к которой относится просьба. */
  row: PageRow | null;
  osUid: string;
  mirrors: PageRow[];
  statusKey: string;
  statusOptions: StatusOption[];
  clientKey: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { activeWorkspaceId, members } = useWorkspace();
  const { profile } = useAuth();
  const [busy, setBusy] = useState<"yes" | "no" | null>(null);
  if (!request || !activeWorkspaceId) return null;

  const tech = members.find((m) => m.uid === request.techUid);
  const techName = tech ? displayNameOf(tech) : "Технарь";
  const client = row ? String(row.cells[clientKey] ?? "").trim() : "";
  const current = row ? String(row.cells[statusKey] ?? "") : "";
  const wanted = request.kind === "status" ? (request.statusLabel ?? request.status ?? "") : "";

  async function decide(approved: boolean) {
    if (!profile || !activeWorkspaceId || !request) return;
    setBusy(approved ? "yes" : "no");
    try {
      await decideOrderRequest({
        workspaceId: activeWorkspaceId,
        request,
        approved,
        osUid,
        mirrors,
        statusKey,
        me: { uid: profile.uid, name: myDisplayName(profile, members) },
      });
      toast.success(
        approved ? (request.kind === "delete" ? "Заказ удалён и у технаря" : `Поставлено «${wanted}»`) : "Просьба отклонена",
        { description: `${techName} получит уведомление` }
      );
      onChanged();
      onClose();
    } catch (error) {
      toast.error(firestoreErrorText(error, error instanceof Error ? error.message : "Не удалось"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Hand className="h-4 w-4 text-warning" /> Технарь просит
          </DialogTitle>
          <DialogDescription>
            {techName}
            {client ? ` · ${client}` : request.client ? ` · ${request.client}` : ""} · {timeAgo(request.createdAt)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-3 text-sm">
          {request.kind === "delete" ? (
            <span className="font-medium text-destructive">Удалить заказ</span>
          ) : (
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground">Поставить статус</span>
              {request.status ? (
                <StatusBadge value={request.status} options={statusOptions} />
              ) : (
                <span className="font-medium">«{wanted}»</span>
              )}
              {current ? (
                <span className="text-xs text-muted-foreground">
                  сейчас <StatusBadge value={current} options={statusOptions} variant="plain" />
                </span>
              ) : null}
            </span>
          )}
          {request.note ? <span className="text-muted-foreground">«{request.note}»</span> : null}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            className="min-h-11 flex-1 gap-1.5 sm:min-h-10"
            variant={request.kind === "delete" ? "destructive" : "default"}
            disabled={Boolean(busy)}
            onClick={() => void decide(true)}
          >
            {busy === "yes" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {request.kind === "delete" ? "Удалить заказ" : `Поставить «${wanted}»`}
          </Button>
          <Button
            variant="outline"
            className="min-h-11 gap-1.5 sm:min-h-10"
            disabled={Boolean(busy)}
            onClick={() => void decide(false)}
          >
            {busy === "no" ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
            Отклонить
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
