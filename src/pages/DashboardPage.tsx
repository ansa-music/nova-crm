import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/common/EmptyState";
import { PersonalDeskSection } from "@/components/dashboard/PersonalDeskSection";
import {
  BonusChip,
  BonusTop,
  DailyChart,
  DoneLeaderboard,
  formatMoneyCompact,
  LeadersRow,
  LoadChart,
  MonthlyChart,
  ordersWord,
  OsBars,
  RatingLeaderboard,
  StatTile,
  StatusBars,
  ratingsWord,
} from "@/components/overview/OverviewParts";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentMonthKey } from "@/hooks/useCurrentMonthKey";
import {
  useDeskLoadHistory,
  useDeskLoads,
  useOrderRatingTotals,
  useOwnerDeskRecount,
  useTechRatings,
} from "@/hooks/useDeskLoads";
import { MonthlyRatingTop, type MonthlyTopEntry } from "@/components/technicians/MonthlyRatingTop";
import { useMembersRefresh } from "@/hooks/useMembersRefresh";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { osNickLabel } from "@/services/memberService";
import { currentMonthSubPageId, previousMonthKey } from "@/services/monthTabService";
import { monthTabNameForKey } from "@/services/subPageService";
import { DEFAULT_STATUS_OPTIONS } from "@/utils/columnOptions";
import { greetingByHour, greetingGlowShadow, hourInTimeZone, timeAgo, ymdPartsInTimeZone } from "@/utils/date";
import { formatCurrency, formatNumber } from "@/utils/format";
import {
  bonusForPlace,
  buildOverview,
  monthDoneRanking,
  monthlySeries,
  placeOf,
  rankByDone,
  rankByRating,
  recentMonthKeys,
} from "@/utils/overviewStats";
import { PageHeader } from "@/components/common/PageHeader";
import { effectiveTechLoadKinds, techLoadKindForOption } from "@/utils/techLoad";
import { ratingMonthKey, type StatusOption } from "@/types";
import { techBonusesOf } from "@/utils/payment";

const NO_OPTIONS: StatusOption[] = [];
const MONTHS_SHOWN = 6;

/**
 * «Дашборд» — one screen for every role. On top, what's yours: join
 * requests, your desk, today's orders, latest rows (PersonalDeskSection,
 * from the rows you may read). Below, the month for the whole workspace:
 * ratings by «Готово» and by ОС stars, KPIs, orders by day, load,
 * statuses, ОС and months — built only from aggregates every member may
 * read, so a Тимлид, an ОС or a Viewer sees the same numbers as the Owner.
 */
export default function DashboardPage() {
  const { activeWorkspace, activeWorkspaceId, members, pages } = useWorkspace();
  const permissions = usePermissions();
  const { profile } = useAuth();
  const monthKey = useCurrentMonthKey();
  const uid = profile?.uid ?? "";
  const enabled = permissions.isResolved;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // Список участников в браузере не живой — освежаем при открытии, но через
  // общий 5-минутный порог: иначе каждый возврат на дашборд перечитывал весь
  // список заново (~по чтению на участника, из дневной квоты Spark).
  useMembersRefresh(activeWorkspaceId, enabled, false);

  const monthKeys = useMemo(() => recentMonthKeys(monthKey, MONTHS_SHOWN), [monthKey]);
  const { loads, failed: loadsFailed, synced: loadsSynced } = useDeskLoads(activeWorkspaceId, enabled);
  const { ratings, failed: ratingsFailed } = useTechRatings(activeWorkspaceId, monthKey, enabled);
  const { totals: orderTotals } = useOrderRatingTotals(activeWorkspaceId, monthKey, enabled);
  const history = useDeskLoadHistory(activeWorkspaceId, monthKeys[0], enabled);
  useOwnerDeskRecount(enabled ? loads : null, loadsSynced);

  // Рейтинг на дашборде — ТОЛЬКО за текущий месяц, как и всё остальное на
  // этом экране. Прошлый месяц не исчезает: он закреплён карточкой сверху,
  // иначе первого числа дашборд показывал бы «оценок нет» и выглядел как
  // поломка, а не как начало нового месяца.
  const prevMonthKey = previousMonthKey(monthKey);
  const monthRatings = useMemo(
    () => (ratings ?? []).filter((r) => ratingMonthKey(r, monthKey) === monthKey),
    [ratings, monthKey]
  );
  const previousTop = useMemo(() => {
    const overallAcc = new Map<string, { sum: number; count: number }>();
    for (const r of ratings ?? []) {
      if (ratingMonthKey(r, monthKey) !== prevMonthKey) continue;
      const acc = overallAcc.get(r.technicianUid) ?? { sum: 0, count: 0 };
      acc.sum += r.stars;
      acc.count += 1;
      overallAcc.set(r.technicianUid, acc);
    }
    const ordersAcc = new Map<string, { sum: number; count: number }>();
    for (const t of orderTotals ?? []) {
      if (t.monthKey !== prevMonthKey) continue;
      const acc = ordersAcc.get(t.technicianUid) ?? { sum: 0, count: 0 };
      acc.sum += t.sum;
      acc.count += t.count;
      ordersAcc.set(t.technicianUid, acc);
    }
    const build = (source: Map<string, { sum: number; count: number }>): MonthlyTopEntry[] =>
      [...source.entries()]
        .flatMap(([technicianUid, acc]) => {
          const member = members.find((m) => m.uid === technicianUid);
          if (!member || acc.count === 0) return [];
          return [{ member, average: acc.sum / acc.count, count: acc.count }];
        })
        .sort((a, b) => b.average - a.average || b.count - a.count)
        .slice(0, 3);
    return { overall: build(overallAcc), orders: build(ordersAcc) };
  }, [ratings, orderTotals, members, monthKey, prevMonthKey]);

  const statusOptions = activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS;
  const responsibleOptions = activeWorkspace?.responsibleOptions ?? NO_OPTIONS;
  const kinds = useMemo(() => effectiveTechLoadKinds(activeWorkspace), [activeWorkspace]);
  const showPayment = useMemo(
    () => statusOptions.some((o) => techLoadKindForOption(o, kinds) === "payment"),
    [statusOptions, kinds]
  );

  const { day: today, month: monthIndex, year } = ymdPartsInTimeZone(now);
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

  const overview = useMemo(
    () =>
      buildOverview({
        members,
        pages,
        loads: loads ?? [],
        ratings: monthRatings,
        monthKey,
        statusOptions,
        kinds,
        responsibleOptions,
        currentTabOf: (desk) => currentMonthSubPageId(desk, monthKey),
        today,
        daysInMonth,
      }),
    [members, pages, loads, monthRatings, monthKey, statusOptions, kinds, responsibleOptions, today, daysInMonth]
  );

  const byDone = useMemo(() => rankByDone(overview.technicians), [overview]);
  // Премии технарям за места по «Готово» (Owner задаёт в «Настройки → Касса»).
  const bonuses = useMemo(() => techBonusesOf(activeWorkspace), [activeWorkspace]);
  // Итог прошлого месяца — по его архиву: первого числа премии не пропадают.
  const previousBonuses = useMemo(() => {
    const uids = new Set(overview.technicians.map((t) => t.member.uid));
    return monthDoneRanking({ history, monthKey: prevMonthKey, statusOptions, uids })
      .slice(0, 3)
      .flatMap((entry, index) => {
        const member = members.find((m) => m.uid === entry.uid);
        const bonus = bonusForPlace(bonuses, index, entry.doneTotal);
        return member && bonus > 0 ? [{ member, doneTotal: entry.doneTotal, bonus }] : [];
      });
  }, [overview, history, prevMonthKey, statusOptions, members, bonuses]);
  const byRating = useMemo(() => rankByRating(overview.technicians), [overview]);
  const unrated = useMemo(
    () => overview.technicians.filter((t) => t.desks.length > 0 && t.ratingCount === 0),
    [overview]
  );
  const byOrders = useMemo(
    () => overview.technicians.slice().sort((a, b) => b.summary.total - a.summary.total)[0] ?? null,
    [overview]
  );
  const months = useMemo(
    () =>
      monthlySeries({
        monthKeys,
        currentMonthKey: monthKey,
        history,
        currentTotals: {
          orders: overview.totals.orders,
          grandTotal: overview.totals.grandTotal,
          doneTotal: overview.totals.doneTotal,
        },
        deskIds: new Set(overview.technicians.flatMap((t) => t.desks.map((d) => d.id))),
        statusOptions,
      }),
    [monthKeys, monthKey, history, overview, statusOptions]
  );

  const myMember = members.find((m) => m.uid === uid) ?? null;
  const myOsValue = permissions.hasRole("os") ? myMember?.osNickValue ?? null : null;
  const myOsNick = myOsValue ? osNickLabel(myMember, responsibleOptions) : null;
  const myOsOrders = myOsValue ? overview.os.find((o) => o.osValue === myOsValue)?.count ?? 0 : 0;
  const myDonePlace = placeOf(byDone, uid);
  const myBonus = myDonePlace ? bonusForPlace(bonuses, myDonePlace - 1, byDone[myDonePlace - 1]?.doneTotal ?? 0) : 0;
  const myRatingPlace = placeOf(byRating, uid);
  const monthName = monthTabNameForKey(monthKey);
  const monthGenitive = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, monthIndex, 1)))
    .replace(/^\d+\s/, "");

  if (!permissions.isResolved || (loads === null && !loadsFailed)) {
    return (
      <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-4 p-5 sm:p-8">
        <Skeleton className="h-8 w-60" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-80 rounded-2xl" />
          <Skeleton className="h-80 rounded-2xl" />
        </div>
      </div>
    );
  }

  const { totals } = overview;
  const doneShare = totals.grandTotal > 0 ? totals.doneTotal / totals.grandTotal : null;
  const hour = hourInTimeZone(now);
  const who = profile?.nickname || profile?.name || "";

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-4 p-5 sm:p-8">
      <PageHeader
        className="mb-0"
        eyebrow={`Дашборд · ${monthName}`}
        title={`${greetingByHour(hour)}${who ? `, ${who}` : ""}`}
        titleStyle={{ textShadow: greetingGlowShadow(hour) }}
        description="Сверху — твоё, ниже — все технари за месяц: рейтинги, деньги и заказы."
        actions={
          totals.updatedAt > 0 ? (
            <p className="text-[11px] text-muted-foreground" title="Цифры обновляются, когда технари работают в своих столах">
              обновлено {timeAgo(totals.updatedAt)}
            </p>
          ) : undefined
        }
      />

      {loadsFailed && (
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Не удалось загрузить цифры столов. Обновите страницу.
        </p>
      )}
      {ratingsFailed && (
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Не удалось загрузить оценки. Обновите страницу.
        </p>
      )}

      <PersonalDeskSection />

      {(myDonePlace || myRatingPlace || myOsValue) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-primary/30 bg-primary/[0.06] px-4 py-2.5 text-sm">
          <span className="text-xs font-medium uppercase tracking-wide text-primary">Вы</span>
          {myDonePlace && (
            <span>
              <span className="font-semibold">#{myDonePlace}</span>
              <span className="text-muted-foreground"> из {byDone.length} по «Готово»</span>
              {myBonus > 0 ? (
                <span className="ml-1.5 inline-flex items-center gap-1 align-middle">
                  <span className="text-muted-foreground">— идёте на премию</span>
                  <BonusChip amount={myBonus} />
                </span>
              ) : null}
            </span>
          )}
          {myRatingPlace && (
            <span>
              <span className="font-semibold">#{myRatingPlace}</span>
              <span className="text-muted-foreground"> по оценкам</span>
            </span>
          )}
          {myOsValue && (
            <span>
              <span className="text-muted-foreground">ОС «{myOsNick}»: </span>
              <span className="font-semibold">
                {formatNumber(myOsOrders)} {ordersWord(myOsOrders)}
              </span>
              <span className="text-muted-foreground"> в этом месяце</span>
            </span>
          )}
        </div>
      )}

      {overview.technicians.length === 0 ? (
        <EmptyState
          eyebrow="Дашборд"
          title="Пока нет технарей"
          description="Здесь появятся рейтинги и графики, когда у участников с ролью «Технарь» будут столы."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <StatTile
              accent
              label="Готово"
              value={formatMoneyCompact(totals.doneTotal)}
              title={formatCurrency(totals.doneTotal)}
              meter={doneShare}
              sub={doneShare !== null ? `${Math.round(doneShare * 100)}% от общей суммы` : "сумм пока нет"}
            />
            <StatTile
              label="Общая сумма"
              value={formatMoneyCompact(totals.grandTotal)}
              title={formatCurrency(totals.grandTotal)}
              sub={totals.avgCheck ? `средний чек ${formatMoneyCompact(totals.avgCheck)}` : "—"}
            />
            <StatTile
              label="Заказов"
              value={formatNumber(totals.orders)}
              sub={`сегодня +${totals.today.orders} · 7 дней +${totals.week.orders}`}
            />
            <StatTile
              label="В работе"
              value={formatNumber(totals.summary.busy)}
              sub={[
                totals.summary.rework ? `переделка ${totals.summary.rework}` : null,
                showPayment && totals.summary.payment ? `ждём оплату ${totals.summary.payment}` : null,
                totals.summary.freeze ? `заморозка ${totals.summary.freeze}` : null,
              ]
                .filter(Boolean)
                .join(" · ") || "ничего не ждёт"}
            />
            <StatTile
              label="Свободны"
              value={`${totals.freeTechs} из ${totals.techs}`}
              sub={totals.busyTechs ? `заняты ${totals.busyTechs}` : "все свободны"}
            />
            <StatTile
              label="Средняя оценка"
              value={totals.ratingAvg !== null ? `${totals.ratingAvg.toFixed(1)} ★` : "—"}
              sub={totals.ratingCount ? `${totals.ratingCount} ${ratingsWord(totals.ratingCount)}` : "оценок нет"}
            />
          </div>

          <BonusTop monthLabel={monthTabNameForKey(prevMonthKey).toLowerCase()} entries={previousBonuses} />

          <MonthlyRatingTop
            monthLabel={monthTabNameForKey(prevMonthKey).toLowerCase()}
            overall={previousTop.overall}
            orders={previousTop.orders}
          />

          <LeadersRow byDone={byDone[0] ?? null} byRating={byRating[0] ?? null} byOrders={byOrders} myUid={uid} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <DoneLeaderboard ranked={byDone} myUid={uid} bonuses={bonuses} />
            <RatingLeaderboard ranked={byRating} unrated={unrated} myUid={uid} />
          </div>

          <DailyChart days={overview.days} today={today} monthName={monthGenitive} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
            <div className="min-w-0 lg:col-span-3">
              <LoadChart
                technicians={overview.technicians}
                showPayment={showPayment}
                myUid={uid}
                linkDesks={permissions.hasFullDeskAccess}
              />
            </div>
            <div className="min-w-0 lg:col-span-2">
              <StatusBars statusCounts={overview.statusCounts} statusOptions={statusOptions} total={totals.orders} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <OsBars os={overview.os} myOsValue={myOsValue} />
            <MonthlyChart months={months} />
          </div>

          <p className="text-center text-[11px] text-muted-foreground">
            Цифры считает каждый стол, пока технарь в нём работает; у Owner дашборд ещё и пересчитывает все столы.
            Пустые строки не считаются.
          </p>
        </>
      )}
    </div>
  );
}
