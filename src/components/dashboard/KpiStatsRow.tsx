import { CheckCircle2, Clock, DollarSign, LayoutGrid, ListOrdered } from "lucide-react";
import { KpiStatCard } from "@/components/dashboard/KpiStatCard";
import {
  deskCountTrend,
  countMonthCaption,
  revenueMonthCaption,
  revenueMonthDelta,
  revenueTrend,
  weekDelta,
} from "@/utils/dashboardTrends";
import { formatCurrency, formatNumber } from "@/utils/format";
import { monthOrderCounts, type PageProgress } from "@/utils/deskProgress";
import type { StatusOption } from "@/types";

/** Mockup-style compact KZT: 3.4M₸, else the usual currency formatter. */
function formatCompactKzt(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    const m = value / 1_000_000;
    const body = Math.abs(m) >= 10 ? String(Math.round(m)) : m.toFixed(1).replace(/\.0$/, "");
    return `${body}M₸`;
  }
  return formatCurrency(value);
}

export function KpiStatsRow({ desks, statusOptions }: { desks: PageProgress[]; statusOptions: StatusOption[] }) {
  if (desks.length === 0) return null;

  const deskTrend = deskCountTrend(desks.map((d) => d.page));
  const revTrend = revenueTrend(desks);

  const grandTotal = desks.reduce((sum, d) => sum + d.grandTotal, 0);
  const monthCounts = monthOrderCounts(desks, statusOptions);

  const hideDeskCount = desks.length === 1;

  return (
    <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {hideDeskCount ? null : (
        <KpiStatCard
          icon={LayoutGrid}
          color="189 100% 72%"
          label="Столов"
          value={formatNumber(desks.length)}
          trend={deskTrend}
          delta={weekDelta(deskTrend)}
        />
      )}
      <KpiStatCard
        icon={DollarSign}
        color="271 81% 56%"
        label={revenueMonthCaption()}
        value={formatCompactKzt(grandTotal)}
        trend={revTrend}
        delta={revenueMonthDelta(desks)}
      />
      <KpiStatCard
        icon={Clock}
        color="42 88% 56%"
        label={countMonthCaption("В работе")}
        value={formatNumber(monthCounts.open)}
      />
      <KpiStatCard
        icon={CheckCircle2}
        color="150 48% 46%"
        label={countMonthCaption("Готово")}
        value={formatNumber(monthCounts.done)}
      />
      <KpiStatCard
        icon={ListOrdered}
        color="189 100% 72%"
        label={countMonthCaption("Всего")}
        value={formatNumber(monthCounts.total)}
      />
    </div>
  );
}
