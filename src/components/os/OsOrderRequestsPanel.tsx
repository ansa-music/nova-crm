import { useState } from "react";
import { Check, Inbox, Loader2, X } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { OS_DESK_COLUMNS } from "@/services/osDeskService";
import { type OrderRequest } from "@/services/orderRequestService";
import { decideOrderRequest } from "@/services/orderRequestDecision";
import { firestoreErrorText } from "@/utils/dbError";
import { displayNameOf, myDisplayName } from "@/utils/displayName";
import { timeAgo } from "@/utils/date";
import type { PageRow } from "@/types";

const STATUS_KEY = OS_DESK_COLUMNS.find((c) => c.type === "status")?.key ?? "status";
const CLIENT_KEY = OS_DESK_COLUMNS[0]?.key ?? "client";

/**
 * Запросы технарей к этому ОС — над столом ОС (просьба Nurba 23.09.2026).
 * «Принять» делает ровно то, о чём просили:
 * - статус — ставится в строку ОС (оттуда проход увезёт его технарю) и сразу
 *   в строку технаря, если она видна в списке своих заказов: строка ОС могла
 *   лежать в прошлой месячной вкладке, где проход сейчас не идёт;
 * - удалить — убирается копия у технаря и строка-источник у ОС.
 * «Отклонить» только закрывает запрос; технарю в обоих случаях уходит
 * уведомление с итогом.
 */
export function OsOrderRequestsPanel({
  osUid,
  requests,
  statusKey = STATUS_KEY,
  mirrors,
  sourceRows,
  onChanged,
}: {
  osUid: string;
  /** Ожидающие просьбы — общая подписка `useOsPendingOrderRequests`. */
  requests: OrderRequest[];
  /** Ключ статуса на этом столе ОС. */
  statusKey?: string;
  /** Заказы этого ОС в столах технарей (useMyOrderRows). */
  mirrors: PageRow[];
  /** Строки открытой вкладки стола ОС — имя клиента берём оттуда, а не из запроса. */
  sourceRows: PageRow[];
  onChanged: () => void;
}) {
  const { activeWorkspaceId, members } = useWorkspace();
  const { profile } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(true);

  if (!activeWorkspaceId || requests.length === 0) return null;

  // Имя клиента пишет в запрос сам технарь — показываем его, только если
  // строки-источника нет в открытой вкладке (прошлый месяц).
  function clientOf(request: OrderRequest): string {
    const mirror = mirrors.find((m) => m.id === request.rowId && m.deskPageId === request.deskPageId);
    const src = mirror?.srcRowId ? sourceRows.find((r) => r.id === mirror.srcRowId) : undefined;
    const name = src?.cells?.[CLIENT_KEY];
    return typeof name === "string" && name.trim() ? name.trim() : request.client;
  }

  // Имя — из участников по uid: в запросе его пишет сам просящий.
  function techNameOf(request: OrderRequest): string {
    const member = members.find((m) => m.uid === request.techUid);
    return member ? displayNameOf(member) : request.techName;
  }

  async function decide(request: OrderRequest, approved: boolean) {
    if (!activeWorkspaceId || !profile) return;
    setBusy(request.id);
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
      toast.success(approved ? (request.kind === "delete" ? "Заказ удалён и у технаря" : "Статус поставлен") : "Запрос отклонён");
      onChanged();
    } catch (error) {
      toast.error(firestoreErrorText(error, error instanceof Error ? error.message : "Не удалось"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-3 mb-2 mt-1 rounded-xl border border-warning/40 bg-warning/[0.07] sm:mx-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm font-medium"
      >
        <Inbox className="h-4 w-4 text-warning" />
        Запросы технарей
        <span className="rounded-full bg-warning/20 px-2 py-0.5 text-xs tabular-nums text-warning">{requests.length}</span>
        <span className="ml-auto text-xs font-normal text-muted-foreground">{open ? "свернуть" : "показать"}</span>
      </button>
      {open ? (
        <ul className="flex flex-col gap-1.5 px-3 pb-3">
          {requests.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 rounded-lg border border-border bg-card px-3 py-2 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <span className="font-medium">{techNameOf(r)}</span>{" "}
                  {r.kind === "delete" ? (
                    <span className="text-destructive">просит удалить заказ</span>
                  ) : (
                    <span>
                      просит статус <span className="font-medium">«{r.statusLabel ?? r.status}»</span>
                    </span>
                  )}
                  {clientOf(r) ? <span className="text-muted-foreground"> · {clientOf(r)}</span> : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {r.note ? `«${r.note}» · ` : ""}
                  {timeAgo(r.createdAt)}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  className="min-h-9 gap-1"
                  variant={r.kind === "delete" ? "destructive" : "default"}
                  disabled={busy !== null}
                  onClick={() => void decide(r, true)}
                >
                  {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  {r.kind === "delete" ? "Удалить" : "Поставить"}
                </Button>
                <Button size="sm" variant="outline" className="min-h-9 gap-1" disabled={busy !== null} onClick={() => void decide(r, false)}>
                  <X className="h-3.5 w-3.5" />
                  Отклонить
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
