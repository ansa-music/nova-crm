import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Download, HardHat, Trophy, UserRound } from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { PageHeader, pageChipClass } from "@/components/common/PageHeader";
import { formatMoneyCompact, ordersWord } from "@/components/overview/OverviewParts";
import { ScoreMeter } from "@/components/technicians/ScoreRating";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentPeriodKey, usePeriodSettings } from "@/hooks/useCurrentPeriodKey";
import { useDeskLoadHistory, useDeskLoads, useOrderRatingTotals } from "@/hooks/useDeskLoads";
import { usePermissions } from "@/hooks/usePermissions";
import { useUrlState } from "@/hooks/useUrlState";
import { useWorkspace } from "@/hooks/useWorkspace";
import { currentMonthSubPageId } from "@/services/monthTabService";
import { fetchOsDeskMonthStats, type OsDeskMonthStats } from "@/services/osDeskStatsService";
import { buildOsAbs, sortOsAbs, type OsAbsRow } from "@/utils/absStats";
import { cn } from "@/utils/cn";
import { DEFAULT_STATUS_OPTIONS } from "@/utils/columnOptions";
import { downloadCsv } from "@/utils/csv";
import { formatCurrency, formatNumber } from "@/utils/format";
import { bonusForPlace, buildOverview, rankByDone, type OverviewTechnician } from "@/utils/overviewStats";
import { osPayOf, techBonusesOf } from "@/utils/payment";
import { periodLabel, periodNoun, periodRange, periodShortLabel, recentPeriodKeys } from "@/utils/periods";
import { personLabel } from "@/utils/peopleDesks";
import { effectiveTechLoadKinds } from "@/utils/techLoad";
import { formatScore } from "@/types/orderRating";
import type { DeskLoad, DeskLoadArchive, StatusOption, WorkspacePage } from "@/types";

const NO_OPTIONS: StatusOption[] = [];
const PERIODS_SHOWN = 12;
const VIEWS = ["techs", "os"] as const;
type View = (typeof VIEWS)[number];

/**
 * «Отчёты» — итоги прошлых периодов (просьба Nurba 26.09.2026: «оставить
 * отчёт-страницу за прошлые месяцы: какой технарь сколько сделал кассу, ОС
 * сколько выполнил»). Только агрегаты, которые читают все участники: архив
 * счётчиков столов (`deskLoadHistory` / `desk_load_history`), итоги оценок
 * заказов и сводки столов ОС за диапазон периода. Строки столов технарей
 * здесь не читаются никогда. Текущий период — по живым счётчикам, как
 * «Дашборд» и «ABS».
 */
export default function ReportsPage() {
  const { activeWorkspace, activeWorkspaceId, members, allPages, osDesks } = useWorkspace();
  const permissions = usePermissions();
  const { profile } = useAuth();
  const uid = profile?.uid ?? "";
  const currentKey = useCurrentPeriodKey();
  const periods = usePeriodSettings();
  const keys = useMemo(() => recentPeriodKeys(currentKey, PERIODS_SHOWN, periods), [currentKey, periods]);
  const [rawPeriod, setRawPeriod] = useUrlState<string>("p", currentKey);
  const selected = keys.includes(rawPeriod) ? rawPeriod : currentKey;
  const [view, setView] = useUrlState<View>("v", "techs", { values: VIEWS });
  const enabled = permissions.isResolved;
  const isCurrent = selected === currentKey;
  const range = useMemo(() => periodRange(selected, periods), [selected, periods]);

  const { loads, failed: loadsFailed } = useDeskLoads(activeWorkspaceId, enabled && isCurrent);
  const history = useDeskLoadHistory(activeWorkspaceId, keys[0], enabled);
  const { totals: ratingTotals } = useOrderRatingTotals(activeWorkspaceId, selected, enabled && view === "techs");

  // Столы — все, включая неактуальные: стол, ушедший в архив в октябре, в
  // сентябре работал. Столы ОС в кассу технарей не идут.
  const pages = useMemo(() => allPages.filter((p) => !p.osDesk), [allPages]);
  const statusOptions = activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS;
  const kinds = useMemo(() => effectiveTechLoadKinds(activeWorkspace), [activeWorkspace]);
  const bonuses = useMemo(() => techBonusesOf(activeWorkspace), [activeWorkspace]);
  const osPay = useMemo(() => osPayOf(activeWorkspace), [activeWorkspace]);

  // Счётчики выбранного периода: живые — у текущего, архив — у прошлых
  // (последняя запись каждого стола за период).
  const periodLoads = useMemo<DeskLoad[]>(() => {
    if (isCurrent) return loads ?? [];
    const latest = new Map<string, DeskLoadArchive>();
    for (const doc of history) {
      if (doc.monthKey !== selected) continue;
      const prev = latest.get(doc.pageId);
      if (!prev || (doc.updatedAt ?? 0) > (prev.updatedAt ?? 0)) latest.set(doc.pageId, doc);
    }
    return [...latest.values()];
  }, [isCurrent, loads, history, selected]);
  const archiveTabs = useMemo(() => new Map(periodLoads.map((l) => [l.pageId, l.subPageId])), [periodLoads]);
  const currentTabOf = useCallback(
    (desk: WorkspacePage) => (isCurrent ? currentMonthSubPageId(desk, selected) : (archiveTabs.get(desk.id) ?? null)),
    [isCurrent, selected, archiveTabs]
  );

  const overview = useMemo(
    () =>
      buildOverview({
        members,
        pages,
        loads: periodLoads,
        ratingTotals: ratingTotals ?? [],
        monthKey: selected,
        statusOptions,
        kinds,
        responsibleOptions: activeWorkspace?.responsibleOptions ?? NO_OPTIONS,
        currentTabOf,
        today: range.dayTo,
        days: range.days,
      }),
    [members, pages, periodLoads, ratingTotals, selected, statusOptions, kinds, activeWorkspace, currentTabOf, range]
  );
  const techRanked = useMemo(() => rankByDone(overview.technicians), [overview]);

  // Апсейлы ОС — сводки столов ОС за диапазон периода (кэш 15 мин на диапазон).
  const [osStats, setOsStats] = useState<Record<string, OsDeskMonthStats | "error">>({});
  const osDeskKey = osDesks.map((d) => d.id).join(",");
  useEffect(() => {
    setOsStats({});
    if (!activeWorkspaceId || view !== "os") return;
    let cancelled = false;
    for (const desk of osDesks) {
      if (!permissions.canAccessPage(desk) || !desk.responsibleUserId) continue;
      const owner = desk.responsibleUserId;
      void fetchOsDeskMonthStats(activeWorkspaceId, desk, { range })
        .then((s) => !cancelled && setOsStats((prev) => ({ ...prev, [owner]: s })))
        .catch(() => !cancelled && setOsStats((prev) => ({ ...prev, [owner]: "error" })));
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId, osDeskKey, view, range]);

  const osRows = useMemo(
    () =>
      sortOsAbs(
        buildOsAbs({
          members,
          pages,
          loads: periodLoads,
          monthKey: selected,
          currentTabOf,
          statusOptions,
          kinds,
          settings: osPay,
          upsellNetOf: (id) => {
            const s = osStats[id];
            return s && s !== "error" ? (s.upsellNetSum ?? s.upsellSum) : null;
          },
          upsellGrossOf: (id) => {
            const s = osStats[id];
            return s && s !== "error" ? s.upsellSum : null;
          },
        })
      ),
    [members, pages, periodLoads, selected, currentTabOf, statusOptions, kinds, osPay, osStats]
  );

  const label = periodLabel(selected, periods);
  const noun = periodNoun(selected);
  const counted = periodLoads.length > 0;
  const loadingUpsell = osDesks.some((d) => d.responsibleUserId && !osStats[d.responsibleUserId]);

  const exportCsv = () => {
    const file = `otchet-${selected}-${view}.csv`;
    if (view === "techs") {
      downloadCsv(
        file,
        ["Место", "Технарь", "Заказов", "Готово, шт.", "Касса «Готово»", "Общая сумма", "Ждём оплату", "Оценка", "Оценено", "Премия"],
        techRanked.map((t, i) => [
          String(i + 1),
          personLabel(t.member),
          t.counted ? String(t.summary.total) : "",
          t.counted ? String(t.summary.done) : "",
          t.counted ? String(t.doneTotal) : "",
          t.counted ? String(t.grandTotal) : "",
          t.counted ? String(t.paymentTotal) : "",
          t.ratingAvg !== null ? formatScore(t.ratingAvg) : "",
          String(t.ratingCount),
          String(bonusForPlace(bonuses, i, t.doneTotal)),
        ])
      );
    } else {
      downloadCsv(
        file,
        ["ОС", "Заказов", "Готово", "KPI, %", "Апсейл после комиссии", "% от апсейла", "Порог KPI", "Топ-1 KPI", "Итого доплат"],
        osRows.map((r) => [
          personLabel(r.member),
          String(r.summary.total),
          String(r.done),
          r.kpiPct === null ? "" : String(r.kpiPct),
          r.upsellNet === null ? "" : String(r.upsellNet),
          String(r.upsellPay),
          r.tier ? String(r.tier.amount) : "",
          String(r.kpiTopPay),
          String(r.totalPay),
        ])
      );
    }
  };

  if (!permissions.isResolved || (isCurrent && loads === null && !loadsFailed)) {
    return (
      <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-4 p-5 sm:p-8">
        <Skeleton className="h-8 w-60" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-4 p-5 sm:p-8">
      <PageHeader
        className="mb-0"
        eyebrow={`Отчёты · ${label}`}
        title="Отчёты за периоды"
        description="Касса и «Готово» технарей, KPI и апсейлы ОС — по каждому периоду. Прошлые периоды берутся из архива счётчиков, текущий — вживую."
        actions={
          <Button variant="outline" className="min-h-11 gap-1.5 sm:min-h-9" onClick={exportCsv} disabled={view === "techs" ? techRanked.length === 0 : osRows.length === 0}>
            <Download className="h-4 w-4" /> Скачать CSV
          </Button>
        }
        filters={
          <>
            <button type="button" className={pageChipClass(view === "techs")} onClick={() => setView("techs")}>
              <HardHat className="h-3.5 w-3.5" />
              Технари
            </button>
            <button type="button" className={pageChipClass(view === "os")} onClick={() => setView("os")}>
              <UserRound className="h-3.5 w-3.5" />
              ОС
            </button>
          </>
        }
      />

      {/* Периоды — новые слева; текущий помечен «идёт». */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Период">
        {[...keys].reverse().map((key) => {
          const on = key === selected;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={on}
              className={cn(pageChipClass(on), "shrink-0 whitespace-nowrap")}
              onClick={() => setRawPeriod(key)}
            >
              {periodShortLabel(key, periods)}
              {key === currentKey ? <span className="ml-1 text-[10px] text-muted-foreground">идёт</span> : null}
            </button>
          );
        })}
      </div>

      {loadsFailed && isCurrent && (
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Не удалось загрузить цифры столов. Обновите страницу.
        </p>
      )}

      {!counted ? (
        <EmptyState
          eyebrow={label}
          title={isCurrent ? "Счётчиков за этот период ещё нет" : "За этот период счётчики не архивированы"}
          description={
            isCurrent
              ? "Стол публикует счётчики, пока открыта его вкладка периода; Owner пересчитывает столы на «Технарях»."
              : "Архив пишется, когда стол впервые публикует следующий период. Периоды до появления счётчиков в отчёт не попадают."
          }
          bordered
        />
      ) : view === "techs" ? (
        <TechTable ranked={techRanked} bonuses={bonuses} myUid={uid} noun={noun} />
      ) : (
        <OsTable rows={osRows} settings={osPay} myUid={uid} noun={noun} loadingUpsell={loadingUpsell} />
      )}

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span>Премии и проценты — по текущим настройкам «Касса» и «ABS».</span>
        <Link to="/abs" className="inline-flex items-center gap-1 hover:text-foreground">
          <Trophy className="h-3 w-3" /> ABS этого {periodNoun(currentKey) === "месяц" ? "месяца" : "периода"} →
        </Link>
      </p>
    </div>
  );
}

const th = "px-2 py-2 text-left text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground";
const thNum = cn(th, "text-right");
const td = "px-2 py-2 align-middle";
const tdNum = cn(td, "text-right font-mono text-[12.5px] tabular-nums");

function money(value: number) {
  return <span title={formatCurrency(value)}>{formatMoneyCompact(value)}</span>;
}

function TechTable({ ranked, bonuses, myUid, noun }: { ranked: OverviewTechnician[]; bonuses: number[]; myUid: string; noun: string }) {
  if (ranked.length === 0) {
    return <EmptyState eyebrow="Технари" title="Нет технарей со столами" description="В отчёт попадают технари, у которых есть столы." bordered />;
  }
  const counted = ranked.filter((t) => t.counted);
  const totals = {
    orders: counted.reduce((n, t) => n + t.summary.total, 0),
    done: counted.reduce((n, t) => n + t.summary.done, 0),
    doneTotal: counted.reduce((n, t) => n + t.doneTotal, 0),
    grandTotal: counted.reduce((n, t) => n + t.grandTotal, 0),
    paymentTotal: counted.reduce((n, t) => n + t.paymentTotal, 0),
    bonus: ranked.slice(0, 3).reduce((n, t, i) => n + bonusForPlace(bonuses, i, t.doneTotal), 0),
  };
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <thead className="border-b border-border bg-muted/40">
          <tr>
            <th className={cn(th, "w-10")}>#</th>
            <th className={th}>Технарь</th>
            <th className={thNum}>Заказов</th>
            <th className={thNum}>Готово, шт.</th>
            <th className={thNum}>Касса «Готово»</th>
            <th className={thNum}>Общая сумма</th>
            <th className={thNum}>Ждём оплату</th>
            <th className={th}>Оценка</th>
            <th className={thNum}>Премия</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {ranked.map((t, i) => {
            const me = t.member.uid === myUid;
            const bonus = bonusForPlace(bonuses, i, t.doneTotal);
            return (
              <tr key={t.member.uid} className={cn(me && "bg-primary/[0.06]")}>
                <td className={cn(td, "text-muted-foreground tabular-nums")}>{i + 1}</td>
                <td className={td}>
                  <span className="flex min-w-0 items-center gap-2">
                    <MemberAvatar id={t.member.uid} name={t.member.name} nickname={t.member.nickname} photoURL={t.member.photoURL} className="h-6 w-6 shrink-0" />
                    <span className="truncate font-medium">{personLabel(t.member)}</span>
                    {me ? <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">вы</span> : null}
                  </span>
                </td>
                {t.counted ? (
                  <>
                    <td className={tdNum}>{formatNumber(t.summary.total)}</td>
                    <td className={tdNum}>{formatNumber(t.summary.done)}</td>
                    <td className={cn(tdNum, "font-semibold text-foreground")}>{money(t.doneTotal)}</td>
                    <td className={cn(tdNum, "text-muted-foreground")}>{money(t.grandTotal)}</td>
                    <td className={cn(tdNum, t.paymentTotal > 0 ? "text-success" : "text-muted-foreground")}>{money(t.paymentTotal)}</td>
                  </>
                ) : (
                  <td className={cn(td, "text-xs text-muted-foreground")} colSpan={5}>
                    нет данных за {noun}
                  </td>
                )}
                <td className={td}>
                  <ScoreMeter average={t.ratingAvg} count={t.ratingCount} size="sm" />
                </td>
                <td className={cn(tdNum, bonus > 0 ? "text-success" : "text-muted-foreground")}>{bonus > 0 ? money(bonus) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="border-t border-border bg-muted/30 font-medium">
          <tr>
            <td className={td} colSpan={2}>
              Итого · {counted.length} из {ranked.length}
            </td>
            <td className={tdNum}>{formatNumber(totals.orders)}</td>
            <td className={tdNum}>{formatNumber(totals.done)}</td>
            <td className={cn(tdNum, "font-semibold")}>{money(totals.doneTotal)}</td>
            <td className={tdNum}>{money(totals.grandTotal)}</td>
            <td className={tdNum}>{money(totals.paymentTotal)}</td>
            <td className={td} />
            <td className={tdNum}>{money(totals.bonus)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function OsTable({
  rows,
  settings,
  myUid,
  noun,
  loadingUpsell,
}: {
  rows: OsAbsRow[];
  settings: ReturnType<typeof osPayOf>;
  myUid: string;
  noun: string;
  loadingUpsell: boolean;
}) {
  if (rows.length === 0) {
    return <EmptyState eyebrow="ОС" title="Нет ОС с ником" description="KPI считается по нику ОС в заказах: закрепите ник ОС на «Команде»." bordered />;
  }
  const totals = {
    orders: rows.reduce((n, r) => n + r.summary.total, 0),
    done: rows.reduce((n, r) => n + r.done, 0),
    upsell: rows.reduce((n, r) => n + (r.upsellNet ?? 0), 0),
    upsellPay: rows.reduce((n, r) => n + r.upsellPay, 0),
    pay: rows.reduce((n, r) => n + r.totalPay, 0),
  };
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[820px] border-collapse text-sm">
        <thead className="border-b border-border bg-muted/40">
          <tr>
            <th className={th}>ОС</th>
            <th className={thNum}>Заказов</th>
            <th className={thNum}>Готово</th>
            <th className={thNum}>KPI</th>
            <th className={thNum}>Апсейл (после комиссии)</th>
            <th className={thNum}>{settings.upsellPct}% от апсейла</th>
            <th className={thNum}>Порог KPI</th>
            <th className={thNum}>Топ-1 KPI</th>
            <th className={thNum}>Итого доплат</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map((r) => {
            const me = r.member.uid === myUid;
            return (
              <tr key={r.member.uid} className={cn(me && "bg-primary/[0.06]")}>
                <td className={td}>
                  <span className="flex min-w-0 items-center gap-2">
                    <MemberAvatar id={r.member.uid} name={r.member.name} nickname={r.member.nickname} photoURL={r.member.photoURL} className="h-6 w-6 shrink-0" />
                    <span className="truncate font-medium">{personLabel(r.member)}</span>
                    {me ? <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">вы</span> : null}
                    {r.kpiPlace && r.kpiPlace <= 3 ? <span className="text-[10px] text-muted-foreground">#{r.kpiPlace} KPI</span> : null}
                  </span>
                </td>
                <td className={tdNum}>{formatNumber(r.summary.total)}</td>
                <td className={tdNum}>{formatNumber(r.done)}</td>
                <td className={cn(tdNum, "font-semibold")} title={!r.kpiEligible && r.summary.total > 0 ? `для KPI нужно от ${settings.kpiMinOrders} ${ordersWord(settings.kpiMinOrders)}` : undefined}>
                  {r.kpiPct === null ? "—" : `${r.kpiPct}%`}
                </td>
                <td className={tdNum} title={r.upsellGross !== null ? `вписано ${formatCurrency(r.upsellGross)}` : undefined}>
                  {r.upsellNet === null ? (loadingUpsell ? "…" : "—") : money(r.upsellNet)}
                </td>
                <td className={tdNum}>{money(r.upsellPay)}</td>
                <td className={tdNum}>{r.tier ? money(r.tier.amount) : "—"}</td>
                <td className={tdNum}>{r.kpiTopPay > 0 ? money(r.kpiTopPay) : "—"}</td>
                <td className={cn(tdNum, "font-semibold text-success")}>{money(r.totalPay)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="border-t border-border bg-muted/30 font-medium">
          <tr>
            <td className={td}>Итого за {noun}</td>
            <td className={tdNum}>{formatNumber(totals.orders)}</td>
            <td className={tdNum}>{formatNumber(totals.done)}</td>
            <td className={tdNum}>{totals.orders ? `${Math.round((totals.done / totals.orders) * 100)}%` : "—"}</td>
            <td className={tdNum}>{money(totals.upsell)}</td>
            <td className={tdNum}>{money(totals.upsellPay)}</td>
            <td className={td} colSpan={2} />
            <td className={cn(tdNum, "font-semibold")}>{money(totals.pay)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
