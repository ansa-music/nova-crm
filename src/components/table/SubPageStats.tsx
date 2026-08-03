import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/utils/format";
import type { PageColumn, PageRow } from "@/types";

const PERCENTS = [5, 8, 10, 12];

interface SubPageStatsProps {
  columns: PageColumn[];
  rows: PageRow[];
}

export function SubPageStats({ columns, rows }: SubPageStatsProps) {
  const stats = useMemo(() => {
    const priceCol = columns.find((c) => c.type === "currency");
    const statusCol = columns.find((c) => c.type === "status");
    if (!priceCol) return null;

    let grandTotal = 0;
    let doneTotal = 0;
    for (const row of rows) {
      const raw = Number(row.cells[priceCol.key] ?? 0) || 0;
      grandTotal += raw;
      if (statusCol) {
        const rawStatus = String(row.cells[statusCol.key] ?? "");
        const label = statusCol.statusOptions?.find((o) => o.value === rawStatus)?.label ?? rawStatus;
        if (label.toLowerCase().includes("готов")) doneTotal += raw;
      }
    }
    return { grandTotal, doneTotal };
  }, [columns, rows]);

  if (!stats) return null;

  return (
    <div className="grid grid-cols-2 gap-3 border-b border-border p-4 sm:grid-cols-3 lg:grid-cols-6">
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
            <p className="text-xs text-muted-foreground">{pct}%</p>
            <p className="mt-1 text-lg font-semibold">{formatCurrency((stats.doneTotal * pct) / 100)}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
