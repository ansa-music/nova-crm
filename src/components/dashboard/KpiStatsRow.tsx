import { CheckCircle2, Clock, DollarSign, LayoutGrid } from "lucide-react";
import { KpiStatCard } from "@/components/dashboard/KpiStatCard";
import {
  deskCountTrend,
  revenueMonthCaption,
  revenueMonthDelta,
  revenueTrend,
  weekDelta,
} from "@/utils/dashboardTrends";
import { formatCurrency, formatNumber } from "@/utils/format";
import { monthOrderCountsByMonth, nowOrderCounts, type PageProgress } from "@/utils/deskProgress";
import { ymdInTimeZone } from "@/utils/date";
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
  const nowCounts = nowOrderCounts(desks, statusOptions);
  const byMonth = monthOrderCountsByMonth(desks, statusOptions);
  const thisMonth = ymdInTimeZone(Date.now()).slice(0, 7);

  const hideDeskCount = desks.length === 1;

  return (
    <div className="mb-6 flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
          label="Сейчас в работе"
          value={formatNumber(nowCounts.open)}
        />
        <KpiStatCard
          icon={CheckCircle2}
          color="150 48% 46%"
          label="Сейчас готово"
          value={formatNumber(nowCounts.done)}
        />
      </div>
      {byMonth.length > 0 ? (
        <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            По месяцам, штуки
          </p>
          <div className="flex flex-col gap-3">
            {byMonth.map((row) => (
              <div
                key={row.key}
                className={
                  row.key === thisMonth
                    ? "rounded-xl border border-primary/30 bg-primary/5 px-3 py-3 sm:px-4"
                    : "rounded-xl border border-border px-3 py-3 sm:px-4"
                }
              >
                <p className="mb-2 text-sm font-medium capitalize">{row.label}</p>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <p className="text-[11px] text-muted-foreground">В работе</p>
                    <p className="tabular text-xl font-medium tracking-[-0.03em]">{formatNumber(row.open)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">Готово</p>
                    <p className="tabular text-xl font-medium tracking-[-0.03em]">{formatNumber(row.done)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">Всего</p>
                    <p className="tabular text-xl font-medium tracking-[-0.03em]">{formatNumber(row.total)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
