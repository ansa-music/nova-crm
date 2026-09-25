import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Crown, Gift, HardHat, Medal, Settings2, Target, TrendingUp, UserRound } from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { PageHeader, pageChipClass } from "@/components/common/PageHeader";
import { StatsModeSwitch } from "@/components/chat/ChatModeSwitch";
import { BonusChip, formatMoneyCompact, ordersWord, Panel, StatTile } from "@/components/overview/OverviewParts";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentPeriodKey, usePeriodSettings } from "@/hooks/useCurrentPeriodKey";
import { useDeskLoads, useOwnerDeskRecount } from "@/hooks/useDeskLoads";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { currentMonthSubPageId } from "@/services/monthTabService";
import { fetchOsDeskMonthStats, type OsDeskMonthStats } from "@/services/osDeskStatsService";
import { buildOsAbs, sortOsAbs, type OsAbsRow } from "@/utils/absStats";
import { cn } from "@/utils/cn";
import { DEFAULT_STATUS_OPTIONS } from "@/utils/columnOptions";
import { formatCurrency, formatNumber } from "@/utils/format";
import { bonusForPlace, buildOverview, rankByDone, type OverviewTechnician } from "@/utils/overviewStats";
import { osPayOf, techBonusesOf } from "@/utils/payment";
import { periodLabel, periodNoun, periodRange } from "@/utils/periods";
import { personLabel } from "@/utils/peopleDesks";
import { effectiveTechLoadKinds } from "@/utils/techLoad";
import type { StatusOption } from "@/types";

const NO_OPTIONS: StatusOption[] = [];
type View = "tech" | "os";

/**
 * «ABS система» (просьба Nurba 23.09.2026) — зарплатные рейтинги месяца.
 *
 * Технари: касса «Готово» решает место и премию (топ-3), рядом — грязная
 * касса (все заказы месяца) и «Ждём оплату» — деньги, которые ещё не пришли.
 * ОС: KPI — доля заказов в «Готово», топ по апсейлам, процент от апсейла
 * после комиссии, доп. оклад лучшему по KPI и фикс за пороги KPI.
 * Суммы и проценты задаёт Owner в «Настройки → Касса».
 */
export default function AbsPage() {
  const { activeWorkspace, activeWorkspaceId, members, pages, osDesks } = useWorkspace();
  const permissions = usePermissions();
  const { profile } = useAuth();
  const uid = profile?.uid ?? "";
  const monthKey = useCurrentPeriodKey();
  const periods = usePeriodSettings();
  const range = useMemo(() => periodRange(monthKey, periods), [monthKey, periods]);
  const [params, setParams] = useSearchParams();
  const view: View = params.get("v") === "os" ? "os" : "tech";
  const enabled = permissions.isResolved;

  const { loads, failed, synced } = useDeskLoads(activeWorkspaceId, enabled);
  useOwnerDeskRecount(enabled ? loads : null, synced);

  const statusOptions = activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS;
  const kinds = useMemo(() => effectiveTechLoadKinds(activeWorkspace), [activeWorkspace]);
  const bonuses = useMemo(() => techBonusesOf(activeWorkspace), [activeWorkspace]);
  const osPay = useMemo(() => osPayOf(activeWorkspace), [activeWorkspace]);
  const currentTabOf = useMemo(() => (desk: Parameters<typeof currentMonthSubPageId>[0]) => currentMonthSubPageId(desk, monthKey), [monthKey]);

  const overview = useMemo(
    () =>
      buildOverview({
        members,
        pages,
        loads: loads ?? [],
        ratingTotals: [],
        monthKey,
        statusOptions,
        kinds,
        responsibleOptions: activeWorkspace?.responsibleOptions ?? NO_OPTIONS,
        currentTabOf,
        today: range.dayTo,
        days: range.days,
      }),
    [members, pages, loads, monthKey, statusOptions, kinds, activeWorkspace, currentTabOf, range]
  );
  const techRanked = useMemo(() => rankByDone(overview.technicians), [overview]);

  // Апсейл ОС — со столов ОС (их читают все участники): сводка за месяц, кэш 5 минут.
  const [osStats, setOsStats] = useState<Record<string, OsDeskMonthStats | "error">>({});
  const osDeskKey = osDesks.map((d) => d.id).join(",");
  useEffect(() => {
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
          loads: loads ?? [],
          monthKey,
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
    [members, pages, loads, monthKey, currentTabOf, statusOptions, kinds, osPay, osStats]
  );

  const monthName = periodLabel(monthKey, periods);
  const noun = periodNoun(monthKey);
  const isOwner = permissions.actsAsOwner;
  const setView = (v: View) => setParams(v === "tech" ? {} : { v }, { replace: true });

  if (!permissions.isResolved || (loads === null && !failed)) {
    return (
      <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-4 p-5 sm:p-8">
        <StatsModeSwitch />
        <Skeleton className="h-8 w-60" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-4 p-5 sm:p-8">
      <StatsModeSwitch />
      <PageHeader
        className="mb-0"
        eyebrow={`ABS · ${monthName}`}
        title="ABS система"
        description={`Касса и доплаты за ${noun}: технари — по «Готово», ОС — по KPI и апсейлам. Суммы и проценты задаёт Owner.`}
        actions={
          isOwner ? (
            <Link
              to="/settings?tab=cashbox"
              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-border px-3 text-sm hover:bg-accent sm:min-h-9"
            >
              <Settings2 className="h-4 w-4" />
              Настроить
            </Link>
          ) : undefined
        }
        filters={
          <>
            <button type="button" className={pageChipClass(view === "tech")} onClick={() => setView("tech")}>
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

      {failed && (
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Не удалось загрузить цифры столов. Обновите страницу.
        </p>
      )}

      {view === "tech" ? (
        <TechSection ranked={techRanked} bonuses={bonuses} myUid={uid} noun={noun} />
      ) : (
        <OsSection rows={osRows} settings={osPay} myUid={uid} noun={noun} loadingUpsell={osDesks.some((d) => d.responsibleUserId && !osStats[d.responsibleUserId])} />
      )}
    </div>
  );
}

function PlaceMark({ place }: { place: number | null }) {
  if (!place) return <span className="flex h-7 w-7 shrink-0 items-center justify-center text-xs text-muted-foreground">—</span>;
  const Icon = place === 1 ? Crown : Medal;
  return (
    <span
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums",
        place === 1 && "border-amber-300/60 bg-amber-300/15 text-amber-200",
        place === 2 && "border-slate-300/50 bg-slate-300/10 text-slate-200",
        place === 3 && "border-orange-400/50 bg-orange-400/10 text-orange-200",
        place > 3 && "border-border text-muted-foreground"
      )}
      aria-label={`${place} место`}
    >
      {place <= 3 ? <Icon className="h-3.5 w-3.5" /> : place}
    </span>
  );
}

function Money({ label, value, strong, tone }: { label: string; value: number; strong?: boolean; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("tabular-nums", strong ? "text-base font-semibold" : "text-sm", tone)} title={formatCurrency(value)}>
        {formatMoneyCompact(value)}
      </p>
    </div>
  );
}

function TechSection({ ranked, bonuses, myUid, noun }: { ranked: OverviewTechnician[]; bonuses: number[]; myUid: string; noun: string }) {
  const done = ranked.reduce((n, t) => n + t.doneTotal, 0);
  const dirty = ranked.reduce((n, t) => n + t.grandTotal, 0);
  const waiting = ranked.reduce((n, t) => n + t.paymentTotal, 0);
  const bonusSum = ranked.slice(0, 3).reduce((n, t, i) => n + bonusForPlace(bonuses, i, t.doneTotal), 0);
  if (ranked.length === 0) {
    return <EmptyState eyebrow="ABS" title="Пока нет технарей со столами" description="Рейтинг появится, когда у технарей будут столы с заказами этого месяца." />;
  }
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile accent label="Касса «Готово»" value={formatMoneyCompact(done)} title={formatCurrency(done)} sub="по ней места и премии" />
        <StatTile label="Грязная касса" value={formatMoneyCompact(dirty)} title={formatCurrency(dirty)} sub={`все заказы за ${noun}`} />
        <StatTile label="Ждём оплату" value={formatMoneyCompact(waiting)} title={formatCurrency(waiting)} sub="ещё не пришло" />
        <StatTile label="Премии топ-3" value={formatMoneyCompact(bonusSum)} title={formatCurrency(bonusSum)} sub={bonuses.map((b) => formatMoneyCompact(b)).join(" / ")} />
      </div>
      <Panel eyebrow="Рейтинг кассы" title="Технари — по сумме «Готово»">
        <ol className="flex flex-col gap-2">
          {ranked.map((tech, i) => {
            const bonus = bonusForPlace(bonuses, i, tech.doneTotal);
            const me = tech.member.uid === myUid;
            return (
              <li
                key={tech.member.uid}
                className={cn(
                  "grid gap-x-3 gap-y-2 rounded-xl border border-border/60 px-3 py-2.5 [grid-template-columns:auto_minmax(0,1fr)] sm:[grid-template-columns:auto_minmax(0,1.4fr)_repeat(3,minmax(0,1fr))_7.5rem]",
                  me && "border-primary/40 bg-primary/[0.06]",
                  i < 3 && tech.doneTotal > 0 && !me && "bg-card/60"
                )}
              >
                <PlaceMark place={i + 1} />
                <div className="flex min-w-0 items-center gap-2.5">
                  <MemberAvatar id={tech.member.uid} name={tech.member.name} nickname={tech.member.nickname} photoURL={tech.member.photoURL} className="h-8 w-8 shrink-0" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {personLabel(tech.member)}
                      {me ? <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">вы</span> : null}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {formatNumber(tech.summary.total)} {ordersWord(tech.summary.total)} · готово {formatNumber(tech.summary.done)}
                    </p>
                  </div>
                </div>
                <div className="col-span-2 grid grid-cols-3 gap-2 sm:contents">
                  <Money label="Готово" value={tech.doneTotal} strong />
                  <Money label="Грязная" value={tech.grandTotal} tone="text-muted-foreground" />
                  <Money label="Ждём оплату" value={tech.paymentTotal} tone={tech.paymentTotal > 0 ? "text-success" : "text-muted-foreground"} />
                </div>
                <div className="col-span-2 flex items-center sm:col-span-1 sm:justify-end">
                  {bonus > 0 ? <BonusChip amount={bonus} className="text-[11px]" /> : null}
                </div>
              </li>
            );
          })}
        </ol>
        <p className="mt-3 text-[11px] text-muted-foreground">
          Место считается только по «Готово». Грязная касса — все заказы месяца с суммой, «Ждём оплату» — заказы в этом статусе.
        </p>
      </Panel>
    </>
  );
}

function kpiTone(pct: number | null) {
  if (pct === null) return "bg-muted";
  if (pct >= 75) return "bg-success";
  if (pct >= 50) return "bg-primary";
  if (pct >= 25) return "bg-warning";
  return "bg-destructive";
}

function OsSection({
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
    return <EmptyState eyebrow="ABS" title="Пока нет ОС с ником" description="KPI считается по нику ОС в заказах: закрепите ник ОС на «Команде»." />;
  }
  const orders = rows.reduce((n, r) => n + r.summary.total, 0);
  const done = rows.reduce((n, r) => n + r.done, 0);
  const upsell = rows.reduce((n, r) => n + (r.upsellNet ?? 0), 0);
  const pay = rows.reduce((n, r) => n + r.totalPay, 0);
  const byKpi = rows.filter((r) => r.kpiPlace).sort((a, b) => (a.kpiPlace ?? 0) - (b.kpiPlace ?? 0)).slice(0, 3);
  const byUpsell = rows.filter((r) => r.upsellPlace).sort((a, b) => (a.upsellPlace ?? 0) - (b.upsellPlace ?? 0)).slice(0, 3);
  const tiersText = settings.kpiTiers.length
    ? settings.kpiTiers.map((t) => `от ${t.minPct}% → ${formatMoneyCompact(t.amount)}`).join(" · ")
    : "пороги не заданы";

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile accent label="KPI всех ОС" value={orders ? `${Math.round((done / orders) * 100)}%` : "—"} meter={orders ? done / orders : null} sub={`${formatNumber(done)} из ${formatNumber(orders)} в «Готово»`} />
        <StatTile label="Апсейл после комиссии" value={loadingUpsell && !upsell ? "…" : formatMoneyCompact(upsell)} title={formatCurrency(upsell)} sub={`${settings.upsellPct}% идёт ОС в зарплату`} />
        <StatTile label="Заказов ОС" value={formatNumber(orders)} sub={`за ${noun}, по столам технарей`} />
        <StatTile label="Доплаты ОС" value={formatMoneyCompact(pay)} title={formatCurrency(pay)} sub="% апсейла + KPI" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel eyebrow="Топ" title="По KPI — доля «Готово»">
          {byKpi.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Ни у кого ещё нет {settings.kpiMinOrders} заказов за {noun}.</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {byKpi.map((r) => (
                <li key={r.member.uid} className="flex min-w-0 items-center gap-2.5">
                  <PlaceMark place={r.kpiPlace} />
                  <MemberAvatar id={r.member.uid} name={r.member.name} nickname={r.member.nickname} photoURL={r.member.photoURL} className="h-7 w-7 shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-sm">{personLabel(r.member)}</span>
                  <span className="font-mono text-sm font-semibold tabular-nums">{r.kpiPct}%</span>
                  {r.kpiTopPay > 0 ? <BonusChip amount={r.kpiTopPay} /> : null}
                </li>
              ))}
            </ol>
          )}
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Target className="h-3.5 w-3.5 shrink-0" />
            {settings.kpiTopBonus > 0 ? `1-е место — доп. оклад ${formatCurrency(settings.kpiTopBonus)}` : "Доп. оклад за 1-е место не задан"} · в топе — от{" "}
            {settings.kpiMinOrders} заказов
          </p>
        </Panel>
        <Panel eyebrow="Топ" title="По апсейлам">
          {byUpsell.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{loadingUpsell ? "Считаю апсейлы…" : `Апсейлов за ${noun} пока нет.`}</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {byUpsell.map((r) => (
                <li key={r.member.uid} className="flex min-w-0 items-center gap-2.5">
                  <PlaceMark place={r.upsellPlace} />
                  <MemberAvatar id={r.member.uid} name={r.member.name} nickname={r.member.nickname} photoURL={r.member.photoURL} className="h-7 w-7 shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-sm">{personLabel(r.member)}</span>
                  <span className="text-sm font-semibold tabular-nums" title={formatCurrency(r.upsellNet ?? 0)}>
                    {formatMoneyCompact(r.upsellNet ?? 0)}
                  </span>
                  {r.upsellPay > 0 ? <BonusChip amount={r.upsellPay} /> : null}
                </li>
              ))}
            </ol>
          )}
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5 shrink-0" />
            {settings.upsellPct}% от каждого апсейла после комиссии способа оплаты — в зарплату ОС
          </p>
        </Panel>
      </div>

      <Panel eyebrow="KPI и зарплата" title={`Все ОС за ${noun}`}>
        <ul className="flex flex-col gap-2">
          {rows.map((r) => {
            const me = r.member.uid === myUid;
            const s = r.summary;
            return (
              <li key={r.member.uid} className={cn("flex flex-col gap-2 rounded-xl border border-border/60 px-3 py-2.5", me && "border-primary/40 bg-primary/[0.06]")}>
                <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                  <PlaceMark place={r.kpiPlace} />
                  <MemberAvatar id={r.member.uid} name={r.member.name} nickname={r.member.nickname} photoURL={r.member.photoURL} className="h-8 w-8 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {personLabel(r.member)}
                      {me ? <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">вы</span> : null}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {formatNumber(s.total)} {ordersWord(s.total)}
                      {!r.kpiEligible && s.total > 0 ? ` · для KPI нужно от ${settings.kpiMinOrders}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-lg font-semibold leading-none tabular-nums">{r.kpiPct === null ? "—" : `${r.kpiPct}%`}</p>
                    <p className="text-[10px] text-muted-foreground">KPI</p>
                  </div>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted/60" aria-hidden>
                  <div className={cn("h-full rounded-full transition-[width] duration-500", kpiTone(r.kpiPct))} style={{ width: `${r.kpiPct ?? 0}%` }} />
                </div>
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  <Count label="Готово" n={r.done} tone="border-success/40 text-success" />
                  <Count label="В работе" n={s.busy} tone="border-primary/40 text-primary" />
                  <Count label="Ждём оплату" n={s.payment} tone="border-warning/40 text-warning" />
                  <Count label="Переделка" n={s.rework} />
                  <Count label="Заморозка" n={s.freeze} />
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border/50 pt-2 text-xs">
                  <span className="text-muted-foreground">
                    Апсейл{" "}
                    <span className="font-medium text-foreground tabular-nums" title={r.upsellGross !== null ? `вписано ${formatCurrency(r.upsellGross)}` : undefined}>
                      {r.upsellNet === null ? (loadingUpsell ? "…" : "—") : formatCurrency(r.upsellNet)}
                    </span>{" "}
                    → {settings.upsellPct}% = <span className="font-medium text-foreground tabular-nums">{formatCurrency(r.upsellPay)}</span>
                  </span>
                  {r.tier ? (
                    <span className="text-muted-foreground">
                      KPI от {r.tier.minPct}% → <span className="font-medium text-foreground">{formatCurrency(r.tier.amount)}</span>
                    </span>
                  ) : null}
                  {r.kpiTopPay > 0 ? (
                    <span className="text-muted-foreground">
                      топ-1 KPI → <span className="font-medium text-foreground">{formatCurrency(r.kpiTopPay)}</span>
                    </span>
                  ) : null}
                  <span className="ml-auto inline-flex items-center gap-1.5 font-medium">
                    <Gift className="h-3.5 w-3.5 text-success" />
                    доплаты <span className="tabular-nums text-success">{formatCurrency(r.totalPay)}</span>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-[11px] text-muted-foreground">
          KPI = заказы в «Готово» / все заказы ОС за {noun} (по столам технарей, по нику ОС). Пороги: {tiersText}.
        </p>
      </Panel>
    </>
  );
}

function Count({ label, n, tone }: { label: string; n: number; tone?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5", n === 0 && "opacity-50", tone)}>
      {label} <span className="font-semibold tabular-nums">{n}</span>
    </span>
  );
}
