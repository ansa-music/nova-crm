import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { ClipboardList, Loader2, Plus, Search, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { chipClass } from "@/components/ui/chip";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { toast } from "@/components/ui/sonner";
import { StatusBadge } from "@/components/table/StatusBadge";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useSendOsRowToExchange } from "@/hooks/useSendOsRowToExchange";
import { osNickLabel } from "@/services/memberService";
import {
  fetchOsDeskTabRows,
  openOsDeskCurrentTab,
  osDeskRowState,
  sortByReceivedDesc,
  type OsDeskTab,
} from "@/services/rows/osDeskIssue";
import { DEFAULT_STATUS_OPTIONS, ensureApprovalStatus, ensureDoneStatus } from "@/utils/columnOptions";
import { firestoreErrorText } from "@/utils/dbError";
import { formatCurrency } from "@/utils/format";
import { formatFullMoment, formatShortMoment, osReceivedAt } from "@/utils/osDates";
import { osRowTotal } from "@/utils/payment";
import { myDisplayName } from "@/utils/displayName";
import { cn } from "@/utils/cn";
import { WORK_ORDER_URGENCY_LABELS, type PageRow, type WorkOrder, type WorkOrderUrgency } from "@/types";

const URGENCIES: WorkOrderUrgency[] = ["normal", "urgent", "fire"];

function cellText(row: PageRow, key: string): string {
  const v = row.cells[key];
  return v === null || v === undefined ? "" : String(v).trim();
}

/**
 * «Выдать заказ» у ОС на «Заказах» — выбор строки СВОЕГО стола ОС (просьба
 * Nurba 24.09.2026). Заказы, которых на столе нет, заводятся кнопкой «Новый
 * заказ» — строкой на стол и оттуда сюда же (`onNewOrder`). Выдача —
 * `sendOsRowToExchange`, та же, что у кнопки «В работу» в самой таблице.
 */
export function OsDeskIssueDialog({
  open,
  onOpenChange,
  liveOrderIds,
  onNewOrder,
  onWithoutDesk,
  onIssued,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Заказы, открытые или отданные сейчас (живой список страницы). */
  liveOrderIds: ReadonlySet<string>;
  /** «Новый заказ (нет на столе)». */
  onNewOrder: () => void;
  /** Руководство (Owner/Тимлид + ОС) может выдать и мимо стола. */
  onWithoutDesk?: () => void;
  onIssued?: (order: WorkOrder) => void;
}) {
  const { profile } = useAuth();
  const { activeWorkspaceId, activeWorkspace, osDesks, members } = useWorkspace();
  const send = useSendOsRowToExchange();
  const [tab, setTab] = useState<OsDeskTab | null>(null);
  const [rows, setRows] = useState<PageRow[] | null>(null);
  const [noDesk, setNoDesk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState("");
  const [urgency, setUrgency] = useState<WorkOrderUrgency>("normal");
  const [busyRowId, setBusyRowId] = useState<string | null>(null);
  /** Выданные в этом окне — сразу уходят из списка, не дожидаясь перечитки. */
  const [sentIds, setSentIds] = useState<Set<string>>(() => new Set());
  const osDesksRef = useRef(osDesks);
  osDesksRef.current = osDesks;

  const statusOptions = useMemo(
    () => ensureApprovalStatus(ensureDoneStatus(activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS)),
    [activeWorkspace?.statusOptions]
  );

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setUrgency("normal");
    setSentIds(new Set());
  }, [open]);

  useEffect(() => {
    if (!open || !activeWorkspaceId || !profile) return;
    let cancelled = false;
    setRows(null);
    setError(null);
    setNoDesk(false);
    (async () => {
      try {
        const me = members.find((m) => m.uid === profile.uid);
        const opened = await openOsDeskCurrentTab({
          workspaceId: activeWorkspaceId,
          uid: profile.uid,
          name: osNickLabel(me, activeWorkspace?.responsibleOptions) ?? myDisplayName(profile, members),
          osDesks: osDesksRef.current,
          createIfMissing: false,
        });
        if (cancelled) return;
        if (!opened) {
          setNoDesk(true);
          setRows([]);
          return;
        }
        const list = await fetchOsDeskTabRows(opened);
        if (cancelled) return;
        setTab(opened);
        setRows(list);
      } catch (err) {
        if (!cancelled) setError(firestoreErrorText(err, "Не удалось прочитать ваш стол ОС"));
      }
    })();
    return () => {
      cancelled = true;
    };
    // Стол перечитываем при открытии окна и по «Повторить», а не на каждый снимок участников.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeWorkspaceId, profile?.uid, reload]);

  const grouped = useMemo(() => {
    const out = { issuable: [] as PageRow[], exchange: 0, issued: 0 };
    if (!rows || !tab) return out;
    for (const row of sortByReceivedDesc(rows)) {
      const state = sentIds.has(row.id) ? "exchange" : osDeskRowState(row, tab.keys, liveOrderIds, statusOptions);
      if (state === "issuable") out.issuable.push(row);
      else if (state === "exchange") out.exchange += 1;
      else if (state === "issued") out.issued += 1;
    }
    return out;
  }, [rows, tab, liveOrderIds, statusOptions, sentIds]);

  const q = query.trim().toLowerCase();
  const visible = q && tab
    ? grouped.issuable.filter((r) =>
        [tab.keys.client, tab.keys.phone, tab.keys.note].some((k) => cellText(r, k).toLowerCase().includes(q))
      )
    : grouped.issuable;

  async function issue(row: PageRow) {
    if (!tab || busyRowId) return;
    setBusyRowId(row.id);
    try {
      const order = await send({ row, pageId: tab.page.id, tabId: tab.tabId, keys: tab.keys, urgency });
      setSentIds((prev) => new Set(prev).add(row.id));
      toast.success(`${cellText(row, tab.keys.client) || "Заказ"} — на «Заказах»`, {
        description: "Технари получили уведомление. Отклики — здесь и в ячейке «Технарь» на вашем столе.",
      });
      onIssued?.(order);
    } catch (err) {
      toast.error(firestoreErrorText(err, err instanceof Error ? err.message : "Не удалось выдать заказ"));
    } finally {
      setBusyRowId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] max-w-lg flex-col gap-3">
        <DialogHeader>
          <DialogTitle>Выдать заказ со стола</DialogTitle>
          <DialogDescription>
            Выберите заказ со своего стола ОС — он уйдёт на «Заказы» со всеми данными строки. Заказа на столе нет —
            «Новый заказ»: он появится и на столе.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted-foreground">Срочность</span>
          {URGENCIES.map((u) => (
            <button
              key={u}
              type="button"
              aria-pressed={urgency === u}
              onClick={() => setUrgency(u)}
              className={chipClass({ active: urgency === u, size: "sm", tone: u === "fire" ? "danger" : u === "urgent" ? "warning" : "primary" })}
            >
              {WORK_ORDER_URGENCY_LABELS[u]}
            </button>
          ))}
        </div>

        {grouped.issuable.length > 5 ? (
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Имя, номер или примечание" className="pl-8" autoComplete="off" />
          </div>
        ) : null}

        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 scrollbar-thin">
          {error ? (
            <Alert tone="error">
              {error}{" "}
              <button type="button" className="underline underline-offset-2" onClick={() => setReload((n) => n + 1)}>
                Повторить
              </button>
            </Alert>
          ) : rows === null ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Читаю ваш стол ОС…
            </div>
          ) : noDesk ? (
            <p className="py-6 text-sm text-muted-foreground">
              Стола ОС у вас ещё нет — «Новый заказ» заведёт его и положит туда заказ.
            </p>
          ) : visible.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">
              {q ? "Ничего не нашлось." : "На столе нет невыданных заказов. Новый — кнопкой ниже."}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {visible.map((row) => {
                const k = tab!.keys;
                const client = cellText(row, k.client);
                const phone = cellText(row, k.phone);
                const total = osRowTotal(row, k);
                const status = cellText(row, k.status);
                const received = osReceivedAt(row);
                const busy = busyRowId === row.id;
                return (
                  <li key={row.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{client}</span>
                        {total !== null && total > 0 ? (
                          <span className="shrink-0 font-mono text-[12.5px] tabular-nums">{formatCurrency(total)}</span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                        {received ? (
                          <span className="font-mono tabular-nums" title={`Получен ${formatFullMoment(received)}`}>
                            {formatShortMoment(received)}
                          </span>
                        ) : null}
                        {phone ? <span className="font-mono tabular-nums">{phone}</span> : null}
                        {status ? <StatusBadge value={status} options={statusOptions} variant="plain" /> : null}
                      </div>
                    </div>
                    <Button size="sm" className="min-h-11 shrink-0 gap-1.5 sm:min-h-0" disabled={Boolean(busyRowId)} onClick={() => void issue(row)}>
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      Выдать
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          {rows && !error && (grouped.exchange > 0 || grouped.issued > 0) ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              {grouped.exchange > 0 ? `Уже на «Заказах»: ${grouped.exchange}. ` : ""}
              {grouped.issued > 0 ? `У технарей: ${grouped.issued}.` : ""}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Button variant="outline" className="min-h-11 gap-1.5 sm:min-h-0" onClick={onNewOrder}>
            <Plus className="h-4 w-4" /> Новый заказ (нет на столе)
          </Button>
          <Button variant="ghost" className="min-h-11 gap-1.5 sm:min-h-0" asChild>
            <Link to="/os-desk" onClick={() => onOpenChange(false)}>
              <ClipboardList className="h-4 w-4" /> Мой стол ОС
            </Link>
          </Button>
          {onWithoutDesk ? (
            <button
              type="button"
              onClick={onWithoutDesk}
              className={cn("ml-auto text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline")}
            >
              Выдать без стола
            </button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
