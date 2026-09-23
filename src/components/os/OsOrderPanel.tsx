import { useState } from "react";
import { ArrowUpRight, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/table/StatusBadge";
import { toast } from "@/components/ui/sonner";
import { useWorkspace } from "@/hooks/useWorkspace";
import { OS_DESK_KEYS, type OsDeskKeys } from "@/services/osDeskService";
import { pushOrderToTech, findTechTarget, techTargetProblem, techUidByNick } from "@/services/rows/osOrderMirror";
import { sbPatchRow } from "@/services/rows/supabaseRowStore";
import {
  DEFAULT_STATUS_OPTIONS,
  ensureApprovalStatus,
  ensureDoneStatus,
  findInProgressStatusOption,
  isApprovalStatusValue,
} from "@/utils/columnOptions";
import { firestoreErrorText } from "@/utils/dbError";
import { mirrorAddressOf } from "@/utils/osDispatchPlan";
import { OS_LOST_FOR_KEY, OS_STATUS_SENT_KEY } from "@/utils/reservedCellKeys";
import { personLabel } from "@/utils/peopleDesks";
import type { PageRow, PaymentMethod } from "@/types";
import { PaymentChip } from "@/components/cashbox/PaymentChip";
import { osRowFees, osRowTotal } from "@/utils/payment";
import { formatCurrency } from "@/utils/format";
import { parseLooseNumber } from "@/utils/numberInput";

/** Сумма из ячейки как число (для показа рядом со способом оплаты). */
function cellAmount(value: unknown): number {
  if (typeof value === "number") return value;
  return parseLooseNumber(String(value ?? "")) ?? 0;
}

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
  onChoose,
  onPickTech,
  keys = OS_DESK_KEYS,
  payment,
}: {
  row: PageRow;
  pageId: string;
  subPageId: string | null;
  osUid: string;
  osNickValue: string;
  /** Строка этого заказа в столе технаря, если он уже выдан. */
  mirror: PageRow | null;
  onChanged: () => void;
  /** «Отдать заказ…» — тот же вопрос «общий или выборочно», что после «В работе». */
  onChoose?: () => void;
  /** Выбрать / сменить технаря — полноэкранный список. */
  onPickTech?: () => void;
  /** Ключи ячеек открытой таблицы стола ОС. */
  keys?: OsDeskKeys;
  /** Касса: способы оплаты у цены и апсейла (на телефоне — только отсюда). */
  payment?: {
    methods: readonly PaymentMethod[];
    canConfigure: boolean;
    onPick: (colKey: string, method: PaymentMethod | null) => void;
    onConfigure: () => void;
  };
}) {
  const { activeWorkspaceId, activeWorkspace, pages, members } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const statusOptions = ensureApprovalStatus(ensureDoneStatus(activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS));

  const techNick = String(row.cells[keys.technician] ?? "");
  const techUid = techUidByNick(members, techNick);
  const problem = techTargetProblem(pages, techUid, mirror?.deskPageId ?? row.mirrorPageId);
  const target = techUid ? findTechTarget(pages, techUid, mirror?.deskPageId ?? row.mirrorPageId) : null;
  // Статус живёт в столбце стола ОС (его синхронизирует useOsDeskDispatch):
  // так он виден прямо в таблице, а не только в карточке.
  const osStatusColumn = { key: keys.status };
  const mirrorStatusKey = mirror?.statusKey ?? target?.keys.status ?? null;
  const status =
    (osStatusColumn ? String(row.cells[osStatusColumn.key] ?? "") : "") ||
    (mirror && mirrorStatusKey ? String(mirror.cells[mirrorStatusKey] ?? "") : "");

  const techName = techUid ? personLabel(members.find((m) => m.uid === techUid)) : techNick;
  // На утверждении заказ технарю не уходит — ни сам, ни кнопкой.
  const onApproval = !mirror && isApprovalStatusValue(status, statusOptions);
  // Заказ выставлен на «Заказы» и ждёт, кому его отдадут.
  const onExchange = !mirror && !techNick && Boolean(row.orderId);

  async function handlePush() {
    if (!activeWorkspaceId || !target || !techUid) {
      toast.error(problem ?? "Не удалось определить стол технаря");
      return;
    }
    setBusy(true);
    const at = mirrorAddressOf(row, mirror);
    const pushStatus = status || findInProgressStatusOption(statusOptions)?.value || "";
    try {
      await pushOrderToTech({
        workspaceId: activeWorkspaceId,
        osUid,
        osNickValue,
        source: row,
        srcPageId: pageId,
        srcTabId: subPageId,
        osColumns: { client: keys.client, phone: keys.phone, price: keys.price, upsell: keys.upsell, note: keys.note, link: keys.link },
        target,
        techUid,
        // Та же дата, что считает автопроход: иначе подписи разъедутся и
        // заказ отправится второй раз без причины.
        dateMs: row.createdAt || 0,
        // Заказ уже в столе технаря (выдан раньше или перенесён) — правим ту
        // же строку в ТОЙ ЖЕ вкладке, а не заводим рядом вторую (на переломе
        // месяца вкладка копии — не текущая).
        mirrorRowId: at?.rowId,
        mirrorTabId: at?.tabId,
        status: pushStatus,
        // Ручная выдача — это и перевыдача после удаления копии: метку
        // «копию удалили» снимаем, синхронизированный статус запоминаем.
        sourceCells: { [OS_STATUS_SENT_KEY]: pushStatus, [OS_LOST_FOR_KEY]: "" },
      });
      toast.success(mirror ? "Заказ обновлён у технаря" : `Заказ у технаря: ${techName}`);
      onChanged();
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось отдать заказ технарю"));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Статус пишем в СВОЮ строку, а к технарю его увезёт useOsDeskDispatch.
   * Один писатель вместо двух: иначе правка из карточки и правка из столбца
   * разъезжались бы, и «кто прав» решал бы порядок сохранения.
   */
  async function handleStatus(value: string) {
    if (!activeWorkspaceId || !osStatusColumn) return;
    setBusy(true);
    try {
      await sbPatchRow(activeWorkspaceId, pageId, subPageId, row.id, {
        cells: { [osStatusColumn.key]: value },
      });
      if (mirror) {
        // Решили по просьбе технаря — чип «просит успешку» гаснет сразу.
        await sbPatchRow(activeWorkspaceId, mirror.deskPageId ?? "", mirror.tabId ?? "", mirror.id, {
          cells: {},
          clearSuccessRequest: true,
        }).catch(() => undefined);
      }
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
        {onPickTech && !onExchange ? (
          <button type="button" onClick={onPickTech} className="text-xs text-primary underline-offset-2 hover:underline">
            {techNick ? "сменить" : "выбрать"}
          </button>
        ) : null}
      </div>

      {payment ? (
        <div className="flex flex-col gap-1.5 rounded-lg border border-border/70 p-2">
          {[
            { key: keys.price, label: "Цена" },
            { key: keys.upsell, label: "Апсейл" },
          ].map((f) => (
            <div key={f.key} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="w-16 text-muted-foreground">{f.label}</span>
              <span className="tabular-nums">{String(row.cells[f.key] ?? "").trim() ? formatCurrency(cellAmount(row.cells[f.key])) : "—"}</span>
              <PaymentChip
                row={row}
                colKey={f.key}
                methods={payment.methods}
                canEdit
                canConfigure={payment.canConfigure}
                onPick={(m) => payment.onPick(f.key, m)}
                onConfigure={payment.onConfigure}
              />
            </div>
          ))}
          {(() => {
            const total = osRowTotal(row, keys);
            const fees = osRowFees(row, keys);
            return (
              <p className="flex flex-wrap items-baseline gap-x-2 border-t border-border/60 pt-1.5 text-sm">
                <span className="w-16 text-muted-foreground">Итого</span>
                <span className="font-semibold tabular-nums">{total !== null ? formatCurrency(total) : "—"}</span>
                {fees > 0 ? <span className="text-xs text-muted-foreground">комиссия −{formatCurrency(fees)}</span> : null}
                <span className="basis-full text-[11px] text-muted-foreground">Эта сумма уходит технарю как цена заказа.</span>
              </p>
            );
          })()}
        </div>
      ) : null}

      {osStatusColumn ? (
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
          {mirror?.successRequestedAt ? (
            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
              технарь просит «Успешку»
            </span>
          ) : null}
        </div>
      ) : null}
      {problem && techNick ? <p className="text-xs text-warning">{problem}</p> : null}
      {onApproval ? (
        <p className="text-xs text-muted-foreground">
          На утверждении — технарю заказ не уйдёт. Поставьте «В работе», и стол спросит, кому отдать: всем на «Заказы» или
          выбранному технарю.
        </p>
      ) : onExchange ? (
        <p className="text-xs text-muted-foreground">
          Заказ на «Заказах» — отдайте его там, когда технари откликнутся, и он приедет к технарю сам.
        </p>
      ) : !mirror && !problem && techNick ? (
        <p className="text-xs text-muted-foreground">Заказ уедет к технарю сам через секунду.</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {mirror || (techNick && !onApproval) ? (
          <Button size="sm" className="min-h-9" onClick={() => void handlePush()} disabled={busy || Boolean(problem)}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : mirror ? <RefreshCw className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
            {mirror ? "Обновить у технаря" : "Выдать в работу"}
          </Button>
        ) : onChoose && !onExchange ? (
          <Button size="sm" className="min-h-9" onClick={onChoose} disabled={busy}>
            <ArrowUpRight className="h-4 w-4" />
            Отдать заказ…
          </Button>
        ) : null}
      </div>
    </div>
  );
}
