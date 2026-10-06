import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCount, formatCurrency } from "@/utils/format";
import { cn } from "@/utils/cn";
import { useWorkspace } from "@/hooks/useWorkspace";
import { DEFAULT_STATUS_OPTIONS, getColumnOptions, isDoneStatusLabel } from "@/utils/columnOptions";
import { parseLooseNumber } from "@/utils/numberInput";
import { isBlankRow } from "@/utils/blankRow";
import type { PageColumn, PageRow } from "@/types";

const PERCENTS = [5, 8, 10, 12];
const ORDER_FORMS = ["заказ", "заказа", "заказов"] as const;

interface SubPageStatsProps {
  columns: PageColumn[];
  rows: PageRow[];
  /** Внутри окна «Статистика» — без нижней рамки панели. */
  embedded?: boolean;
  /**
   * Воркспейс «NOVA Studio»: без плиток процентов (5/8/10/12 %) и без
   * переключателя «от Готово / от Общего» — только суммы и число заказов.
   * Нет пропа — статистика ровно прежняя.
   */
  hidePercents?: boolean;
}

export function SubPageStats({ columns, rows, embedded = false, hidePercents = false }: SubPageStatsProps) {
  const { activeWorkspace } = useWorkspace();
  const [percentBase, setPercentBase] = useState<"done" | "total">("done");
  const stats = useMemo(() => {
    const priceCol = columns.find((c) => c.type === "currency");
    const statusCol = columns.find((c) => c.type === "status");
    if (!priceCol) return null;
    const statusOptions = statusCol
      ? getColumnOptions(statusCol, activeWorkspace)
      : (activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS);

    let grandTotal = 0;
    let doneTotal = 0;
    for (const row of rows) {
      const raw = parseLooseNumber(String(row.cells[priceCol.key] ?? "")) ?? 0;
      grandTotal += raw;
      if (statusCol) {
        const rawStatus = String(row.cells[statusCol.key] ?? "");
        const label = statusOptions.find((o) => o.value === rawStatus)?.label ?? rawStatus;
        if (isDoneStatusLabel(label)) doneTotal += raw;
      }
    }
    return { grandTotal, doneTotal };
  }, [columns, rows, activeWorkspace]);

  // Студия: сколько заказов (пустые строки-слоты не заказы) и сколько «Готово».
  const counts = useMemo(() => {
    if (!hidePercents) return null;
    const statusCol = columns.find((c) => c.type === "status");
    const statusOptions = statusCol
      ? getColumnOptions(statusCol, activeWorkspace)
      : (activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS);
    let total = 0;
    let done = 0;
    for (const row of rows) {
      if (isBlankRow(row)) continue;
      total += 1;
      if (!statusCol) continue;
      const rawStatus = String(row.cells[statusCol.key] ?? "");
      const label = statusOptions.find((o) => o.value === rawStatus)?.label ?? rawStatus;
      if (isDoneStatusLabel(label)) done += 1;
    }
    return { total, done };
  }, [hidePercents, columns, rows, activeWorkspace]);

  if (!stats) return null;

  if (hidePercents) {
    return (
      <div className={cn("p-3 sm:p-4", !embedded && "border-b border-border")}>
        <div className="grid grid-cols-2 gap-2 sm:gap-3">
          <Card className="glass-panel border-success/20 bg-success/5">
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">Готово</p>
              <p className="mt-1 text-lg font-semibold text-success">{formatCurrency(stats.doneTotal)}</p>
              {counts && <p className="mt-0.5 text-[11px] text-muted-foreground">{formatCount(counts.done, ORDER_FORMS)}</p>}
            </CardContent>
          </Card>
          <Card className="glass-panel">
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">Общий доход</p>
              <p className="mt-1 text-lg font-semibold">{formatCurrency(stats.grandTotal)}</p>
              {counts && <p className="mt-0.5 text-[11px] text-muted-foreground">{formatCount(counts.total, ORDER_FORMS)}</p>}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const percentSource = percentBase === "total" ? stats.grandTotal : stats.doneTotal;
  const percentHint = percentBase === "total" ? "от общего" : "от готово";

  const baseToggle = (
    <div className="flex shrink-0 rounded-lg border border-border p-0.5">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={cn("h-7 px-2.5 text-[11px]", percentBase === "done" && "bg-primary/15 text-primary hover:bg-primary/20")}
        onClick={() => setPercentBase("done")}
      >
        от Готово
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={cn("h-7 px-2.5 text-[11px]", percentBase === "total" && "bg-primary/15 text-primary hover:bg-primary/20")}
        onClick={() => setPercentBase("total")}
      >
        от Общего
      </Button>
    </div>
  );

  return (
    <div className={cn("p-3 sm:p-4", !embedded && "border-b border-border")}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Проценты {percentHint}</p>
        {baseToggle}
      </div>

      <div className="flex gap-2 overflow-x-auto scrollbar-thin sm:hidden">
        <StatPill label="Готово" value={stats.doneTotal} accent />
        <StatPill label="Общий" value={stats.grandTotal} />
        {PERCENTS.map((pct) => (
          <StatPill key={pct} label={`${pct}%`} value={(percentSource * pct) / 100} />
        ))}
      </div>

      <div className="hidden gap-3 sm:grid sm:grid-cols-3 lg:grid-cols-6">
        <Card className="glass-panel border-success/20 bg-success/5">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Готово</p>
            <p className="mt-1 text-lg font-semibold text-success">{formatCurrency(stats.doneTotal)}</p>
          </CardContent>
        </Card>
        <Card className="glass-panel">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Общий доход</p>
            <p className="mt-1 text-lg font-semibold">{formatCurrency(stats.grandTotal)}</p>
          </CardContent>
        </Card>
        {PERCENTS.map((pct) => (
          <Card key={pct} className="glass-panel">
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">
                {pct}% <span className="text-muted-foreground/70">{percentHint}</span>
              </p>
              <p className="mt-1 text-lg font-semibold">{formatCurrency((percentSource * pct) / 100)}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function StatPill({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div
      className={cn(
        "glass-panel flex shrink-0 flex-col gap-0.5 rounded-lg border px-3 py-2",
        accent ? "border-success/20 bg-success/5" : "border-border"
      )}
    >
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className={cn("text-sm font-semibold whitespace-nowrap", accent && "text-success")}>
        {formatCurrency(value)}
      </span>
    </div>
  );
}
