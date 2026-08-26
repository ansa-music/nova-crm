import { CheckCircle2, Clock, DollarSign, LayoutGrid } from "lucide-react";
import { KpiStatCard } from "@/components/dashboard/KpiStatCard";
import {
  deskCountTrend,
  doneTrend,
  openCountTrend,
  revenueMonthCaption,
  revenueMonthDelta,
  revenueTrend,
  weekDelta,
} from "@/utils/dashboardTrends";
import { formatCurrency, formatNumber } from "@/utils/format";
import type { PageProgress } from "@/utils/deskProgress";
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
  const doneTrendData = doneTrend(desks, statusOptions);
  const openTrendData = openCountTrend(desks, statusOptions);

  const grandTotal = desks.reduce((sum, d) => sum + d.grandTotal, 0);
  const doneTotal = desks.reduce((sum, d) => sum + d.doneTotal, 0);
  const openCount = desks.reduce((sum, d) => sum + d.openCount, 0);

  const hideDeskCount = desks.length === 1;

  return (
    <div
      className={
        hideDeskCount
          ? "mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
          : "mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      }
    >
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
        icon={CheckCircle2}
        color="150 48% 46%"
        label="Готово"
        value={formatCurrency(doneTotal)}
        trend={doneTrendData}
        delta={weekDelta(doneTrendData)}
      />
      <KpiStatCard
        icon={Clock}
        color="42 88% 56%"
        label="В работе"
        value={formatNumber(openCount)}
        trend={openTrendData}
        delta={weekDelta(openTrendData)}
      />
    </div>
  );
}
