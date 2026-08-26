import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/utils/format";
import { cn } from "@/utils/cn";
import { useWorkspace } from "@/hooks/useWorkspace";
import { DEFAULT_STATUS_OPTIONS, getColumnOptions, isDoneStatusLabel } from "@/utils/columnOptions";
import type { PageColumn, PageRow } from "@/types";

const PERCENTS = [5, 8, 10, 12];

interface SubPageStatsProps {
  columns: PageColumn[];
  rows: PageRow[];
}

export function SubPageStats({ columns, rows }: SubPageStatsProps) {
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
      const raw = Number(row.cells[priceCol.key] ?? 0) || 0;
      grandTotal += raw;
      if (statusCol) {
        const rawStatus = String(row.cells[statusCol.key] ?? "");
        const label = statusOptions.find((o) => o.value === rawStatus)?.label ?? rawStatus;
        if (isDoneStatusLabel(label)) doneTotal += raw;
      }
    }
    return { grandTotal, doneTotal };
  }, [columns, rows, activeWorkspace]);

  if (!stats) return null;

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
    <div className="border-b border-border p-3 sm:p-4">
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
        <Card className="glass-panel border-emerald-500/20 bg-emerald-500/5">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Готово</p>
            <p className="mt-1 text-lg font-semibold text-emerald-500">{formatCurrency(stats.doneTotal)}</p>
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
        accent ? "border-emerald-500/20 bg-emerald-500/5" : "border-border"
      )}
    >
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className={cn("text-sm font-semibold whitespace-nowrap", accent && "text-emerald-500")}>
        {formatCurrency(value)}
      </span>
    </div>
  );
}
