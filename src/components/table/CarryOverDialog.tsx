import { useEffect, useMemo, useState } from "react";
import { Loader2, MoveRight } from "lucide-react";
import { StatusBadge } from "@/components/table/StatusBadge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { CarryCandidates } from "@/services/rows/carryOver";
import { CARRY_SETTLE_MS } from "@/utils/carryOver";
import { cn } from "@/utils/cn";
import { formatCount, formatCurrencyCell } from "@/utils/format";
import { pickRowCardColumns } from "@/utils/rowCardColumns";
import type { PageColumn, PageRow, StatusOption } from "@/types";

interface Group {
  key: string;
  /** Сырое значение статуса («» — без статуса / утверждение). */
  raw: string;
  rows: PageRow[];
}

/**
 * Окно «Перенести в «1–15 окт»»: заказы прошлого периода по статусам с
 * галочками. «В работе» отмечены сразу, «Ждём оплату» — нет (деньги придут
 * за прошлый период), «Готово» и «Отменено» не показываются. Строки,
 * менявшиеся только что, не предлагаются — гонка с проходом стола ОС.
 */
export function CarryOverDialog({
  open,
  onOpenChange,
  candidates,
  columns,
  statusOptions,
  fromLabel,
  toLabel,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidates: CarryCandidates | null;
  columns: PageColumn[];
  statusOptions: readonly StatusOption[];
  fromLabel: string;
  toLabel: string;
  busy: boolean;
  onConfirm: (rows: PageRow[]) => void;
}) {
  const cols = useMemo(() => pickRowCardColumns(columns), [columns]);
  const statusKey = cols.status?.key;

  const view = useMemo(() => {
    if (!candidates) return { groups: [] as Group[], payment: [] as PageRow[], settling: 0, staying: 0 };
    const settleBefore = Date.now() - CARRY_SETTLE_MS;
    const fresh = (row: PageRow) => (row.updatedAt ?? 0) > settleBefore;
    const byRaw = new Map<string, Group>();
    let settling = 0;
    for (const row of candidates.groups.unfinished) {
      if (fresh(row)) {
        settling += 1;
        continue;
      }
      const raw = statusKey ? String(row.cells[statusKey] ?? "").trim() : "";
      const group = byRaw.get(raw) ?? { key: raw || "__none", raw, rows: [] };
      group.rows.push(row);
      byRaw.set(raw, group);
    }
    const payment: PageRow[] = [];
    for (const row of candidates.groups.payment) {
      if (fresh(row)) settling += 1;
      else payment.push(row);
    }
    // Порядок групп — порядок вариантов статуса, «без статуса» первой.
    const order = new Map(statusOptions.map((o, i) => [o.value, i]));
    const groups = [...byRaw.values()].sort((a, b) => (a.raw ? (order.get(a.raw) ?? 999) : -1) - (b.raw ? (order.get(b.raw) ?? 999) : -1));
    return { groups, payment, settling, staying: candidates.groups.done.length + candidates.groups.cancelled.length };
  }, [candidates, statusKey, statusOptions]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!open) return;
    setSelected(new Set(view.groups.flatMap((g) => g.rows.map((r) => r.id))));
  }, [open, view]);

  const toggle = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const allRows = useMemo(() => [...view.groups.flatMap((g) => g.rows), ...view.payment], [view]);
  const chosen = allRows.filter((r) => selected.has(r.id));

  const titleOf = (row: PageRow) => (cols.title ? String(row.cells[cols.title.key] ?? "").trim() : "");
  const amountOf = (row: PageRow) => {
    if (!cols.currency) return "";
    const raw = row.cells[cols.currency.key];
    return raw === null || raw === undefined || String(raw).trim() === "" ? "" : formatCurrencyCell(String(raw));
  };

  const renderRows = (rows: PageRow[]) =>
    rows.map((row) => {
      const title = titleOf(row);
      const amount = amountOf(row);
      return (
        <label key={row.id} className="flex min-h-10 cursor-pointer items-center gap-2.5 px-3 text-sm hover:bg-accent/40">
          <Checkbox checked={selected.has(row.id)} onCheckedChange={(v) => toggle([row.id], v === true)} disabled={busy} />
          <span className={cn("min-w-0 flex-1 truncate", !title && "italic text-muted-foreground")}>{title || "Без названия"}</span>
          {amount && <span className="shrink-0 font-mono text-[12.5px] tabular text-muted-foreground">{amount}</span>}
        </label>
      );
    });

  const renderGroupHeader = (label: React.ReactNode, rows: PageRow[], hint?: string) => {
    const ids = rows.map((r) => r.id);
    const on = ids.filter((id) => selected.has(id)).length;
    return (
      <div className="flex items-center gap-2.5 border-b border-border bg-muted/40 px-3 py-1.5 text-xs">
        <Checkbox
          checked={on === 0 ? false : on === ids.length ? true : "indeterminate"}
          onCheckedChange={(v) => toggle(ids, v === true)}
          disabled={busy}
          aria-label="Вся группа"
        />
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          {label}
          <span className="text-muted-foreground">· {rows.length}</span>
        </span>
        {hint && <span className="hidden text-muted-foreground sm:inline">{hint}</span>}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="flex max-h-[90vh] max-w-lg flex-col gap-3 p-0">
        <DialogHeader className="px-5 pt-5 sm:px-6">
          <DialogTitle className="flex items-center gap-2">
            <MoveRight className="h-4 w-4 text-sky-300" /> Перенести в «{toLabel}»
          </DialogTitle>
          <DialogDescription>
            Из периода «{fromLabel}». Заказы переезжают вместе с визиткой, файлами и оценкой; прошлый период их больше не
            считает.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto border-y border-border">
          {view.groups.length === 0 && view.payment.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">Переносить нечего.</p>
          ) : null}
          {view.groups.map((g) => (
            <div key={g.key}>
              {renderGroupHeader(
                g.raw ? (
                  <StatusBadge value={g.raw} options={[...statusOptions]} variant="plain" />
                ) : (
                  <span className="text-foreground">Без статуса</span>
                ),
                g.rows
              )}
              {renderRows(g.rows)}
            </div>
          ))}
          {view.payment.length > 0 && (
            <div>
              {renderGroupHeader(<span className="text-foreground">Ждём оплату</span>, view.payment, "деньги придут за прошлый период")}
              {renderRows(view.payment)}
            </div>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 px-5 pb-5 sm:flex-row sm:items-center sm:px-6">
          <p className="mr-auto text-xs leading-5 text-muted-foreground">
            Готовые и отменённые остаются в прошлом периоде{view.staying > 0 ? ` (${view.staying})` : ""}.
            {view.settling > 0 ? ` Только что менялись: ${view.settling} — появятся через минуту.` : ""}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" className="min-h-11 sm:min-h-0" onClick={() => onOpenChange(false)} disabled={busy}>
              Отмена
            </Button>
            <Button className="min-h-11 gap-1.5 sm:min-h-0" disabled={busy || chosen.length === 0} onClick={() => onConfirm(chosen)}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoveRight className="h-4 w-4" />}
              Перенести {chosen.length > 0 ? formatCount(chosen.length, ["заказ", "заказа", "заказов"]) : ""}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
