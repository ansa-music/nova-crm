import { useEffect, useMemo, useState } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeskCoverStrip } from "@/components/dashboard/DeskCoverStrip";
import { DeskChart, GoalVsDoneChart } from "@/components/dashboard/DeskChart";
import { LeaderboardWidget } from "@/components/dashboard/LeaderboardWidget";
import { MyProgressCard } from "@/components/dashboard/MyProgressCard";
import { KpiStatsRow } from "@/components/dashboard/KpiStatsRow";
import { WaitingForYou } from "@/components/dashboard/WaitingForYou";
import { TechnicianQueue } from "@/components/dashboard/TechnicianQueue";
import { StalledRowsPanel } from "@/components/dashboard/StalledRowsPanel";
import { RecentRowsPanel } from "@/components/dashboard/RecentRowsPanel";
import { RevenueChart } from "@/components/dashboard/RevenueChart";
import { StatusChart } from "@/components/dashboard/StatusChart";
import { EmptyState } from "@/components/common/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useDeskLayout } from "@/hooks/useDeskLayout";
import { useLeaderboard } from "@/hooks/useLeaderboard";
import { useMultiPageRows } from "@/hooks/useMultiPageRows";
import { useMultiPageSubPages } from "@/hooks/useMultiPageSubPages";
import { useMultiSubPageRows } from "@/hooks/useMultiSubPageRows";
import { usePermissions } from "@/hooks/usePermissions";
import { usePeopleDesks } from "@/hooks/usePeopleDesks";
import { useWorkspace } from "@/hooks/useWorkspace";
import { DeskStudioSheet } from "@/components/pagesnav/DeskStudioSheet";
import { CreatePageDialog } from "@/components/pagesnav/CreatePageDialog";
import { resolvedCoverUrl, personLabel } from "@/utils/peopleDesks";
import { greetingByHour, hourInTimeZone } from "@/utils/date";
import { DEFAULT_STATUS_OPTIONS } from "@/utils/columnOptions";
import { isResponsibleForPage } from "@/utils/permissions";
import { ordersByDateFromDesks, progressForPage, statusDistributionFromDesks } from "@/utils/deskProgress";
import { formatCurrency } from "@/utils/format";
import { updateLeaderboardEntry } from "@/services/leaderboardService";
import { useNavigate } from "react-router";
import type { LeaderboardEntry } from "@/types";

export default function DashboardPage() {
  const { activeWorkspace, activeWorkspaceId, members } = useWorkspace();
  const permissions = usePermissions();
  const { profile } = useAuth();
  const { myDesk, studioPages, isPersonalLanding, isLoadingWorkspaceData, ownerUid } = usePeopleDesks();
  const { layout: deskLayout } = useDeskLayout(profile?.uid);
  const [studioPageId, setStudioPageId] = useState<string | null>(null);
  const [createPageOpen, setCreatePageOpen] = useState(false);
  const [highlightedDeskId, setHighlightedDeskId] = useState<string | null>(null);
  const navigate = useNavigate();
  const studioPage = studioPages.find((p) => p.id === studioPageId) ?? (studioPageId && myDesk?.id === studioPageId ? myDesk : null);

  const progressPages = studioPages;

  const rowPageIds = useMemo(
    () => progressPages.filter((p) => !p.defaultSubPageId).map((p) => p.id),
    [progressPages]
  );
  const rowsByPage = useMultiPageRows(activeWorkspaceId, rowPageIds);

  const subPageMetaIds = useMemo(
    () => progressPages.filter((p) => p.defaultSubPageId).map((p) => p.id),
    [progressPages]
  );
  const subPagesByPage = useMultiPageSubPages(activeWorkspaceId, subPageMetaIds);
  const defaultSubPagePairs = useMemo(
    () =>
      progressPages
        .filter((p) => p.defaultSubPageId)
        .map((p) => ({ pageId: p.id, subPageId: p.defaultSubPageId as string })),
    [progressPages]
  );
  const rowsBySubPage = useMultiSubPageRows(activeWorkspaceId, defaultSubPagePairs);

  const statusOptions = activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS;

  const deskProgress = useMemo(
    () => progressPages.map((page) => progressForPage(page, subPagesByPage, rowsBySubPage, rowsByPage, statusOptions)),
    [progressPages, subPagesByPage, rowsBySubPage, rowsByPage, statusOptions]
  );

  const myDeskProgress = useMemo(
    () => (myDesk ? deskProgress.find((d) => d.page.id === myDesk.id) : undefined),
    [deskProgress, myDesk]
  );

  const myProgress = useMemo(
    () => (profile ? deskProgress.filter((p) => isResponsibleForPage(p.page, profile.uid)) : []),
    [deskProgress, profile]
  );

  useEffect(() => {
    if (!activeWorkspaceId || !profile) return;
    myProgress.forEach(({ page, doneTotal, grandTotal, percent }) => {
      updateLeaderboardEntry(activeWorkspaceId, {
        pageId: page.id,
        pageName: page.name,
        responsibleUserId: profile.uid,
        doneTotal,
        grandTotal,
        percent,
      }).catch(() => {
        /* best-effort */
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myProgress, activeWorkspaceId, profile?.uid]);

  const polledLeaderboard = useLeaderboard(activeWorkspaceId);

  const leaderboardEntries = useMemo(() => {
    const byPage = new Map<string, LeaderboardEntry>();
    // Shared /leaderboard is readable by every member, including for desks
    // this viewer cannot open (hiddenByResponsible). Live row overlay is
    // only the pages in this view — empty live rows must not wipe those
    // shared «Готово» totals.
    for (const entry of polledLeaderboard) byPage.set(entry.pageId, entry);
    for (const desk of deskProgress) {
      const uid = desk.page.responsibleUserId;
      if (!uid) continue;
      const existing = byPage.get(desk.page.id);
      const liveEmpty = desk.rowCount === 0 && desk.doneTotal === 0 && desk.grandTotal === 0;
      if (liveEmpty && existing) continue;
      byPage.set(desk.page.id, {
        pageId: desk.page.id,
        pageName: desk.page.name,
        responsibleUserId: uid,
        doneTotal: desk.doneTotal,
        grandTotal: desk.grandTotal,
        percent: desk.percent,
        updatedAt: Date.now(),
      });
    }
    return Array.from(byPage.values());
  }, [polledLeaderboard, deskProgress]);

  const deskBarData = useMemo(
    () =>
      deskProgress.map((desk) => {
        const member = members.find((m) => m.uid === desk.page.responsibleUserId);
        return {
          id: desk.page.id,
          name: desk.page.name,
          person: personLabel(member),
          doneTotal: desk.doneTotal,
        };
      }),
    [deskProgress, members]
  );

  if (isLoadingWorkspaceData) {
    return (
      <div className="mx-auto max-w-6xl p-5 sm:p-8">
        <Skeleton className="mb-4 h-8 w-56" />
        <Skeleton className="mb-6 aspect-[2.4/1] w-full rounded-[1.35rem]" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-72 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      </div>
    );
  }

  const hello = greetingByHour(hourInTimeZone(Date.now()));
  const who = profile?.nickname || profile?.name || "";
  const showCharts = deskLayout.showCharts;
  const showProgress = deskLayout.showProgress;
  const showBoard = deskLayout.showLeaderboard;
  const chartSource = isPersonalLanding ? myProgress : deskProgress;
  const chartStatus = statusDistributionFromDesks(chartSource, statusOptions);
  const chartOrders = ordersByDateFromDesks(chartSource);
  const chartBars = isPersonalLanding
    ? deskBarData.filter((d) => myProgress.some((p) => p.page.id === d.id))
    : deskBarData;

  const myDeskGoal = myDeskProgress?.page.monthlyGoal ?? 0;
  const myDeskGoalPercent =
    myDeskProgress && myDeskGoal > 0
      ? Math.min(100, Math.round((myDeskProgress.doneTotal / myDeskGoal) * 100))
      : null;

  const myProgressIds = new Set(myProgress.map((p) => p.page.id));
  const myProgressDuplicatesKpi =
    chartSource.length > 0 &&
    chartSource.length === myProgress.length &&
    chartSource.every((d) => myProgressIds.has(d.page.id));
  const showProgressCards = showProgress && myProgress.length > 0 && !myProgressDuplicatesKpi;

  const leaderboard = (
    <LeaderboardWidget
      entries={leaderboardEntries}
      members={members}
      myUid={profile?.uid}
      featured
    />
  );

  return (
    <div className="mx-auto max-w-6xl p-5 sm:p-8 lg:p-10">
      <p className="eyebrow mb-2 text-primary">Дашборд</p>
      <h1 className="font-serif text-[1.85rem] font-medium tracking-[-0.03em] sm:text-[2.2rem]">
        {hello}
        {who ? `, ${who}` : ""}
      </h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">
        Рейтинг и диаграммы по заказам на столах. Сроки как дедлайны сюда не входят — даты на листах это когда заказ пришёл.
      </p>

      {myDesk ? (
        <section className="relative mb-8 overflow-hidden rounded-[1.35rem] border border-border">
          <button type="button" className="block w-full text-left" onClick={() => navigate(`/page/${myDesk.id}`)}>
            <DeskCoverStrip coverUrl={resolvedCoverUrl(myDesk, ownerUid)} name={myDesk.name} ratio="hero" />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
          </button>
          <div className="pointer-events-none absolute inset-0 z-[1] flex flex-col justify-between p-4 sm:p-7">
            {permissions.canManagePage(myDesk) ? (
              <div className="pointer-events-auto self-start">
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11 rounded-full border-white/25 bg-white/10 px-4 text-white hover:bg-white/16 hover:text-white"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setStudioPageId(myDesk.id);
                  }}
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  Настроить стол
                </Button>
              </div>
            ) : (
              <div />
            )}
            <div>
              <p className="font-serif text-[1.65rem] font-medium tracking-[-0.03em] text-white sm:text-[2.15rem]">
                {myDesk.name}
              </p>
              {myDeskProgress ? (
                <div className="mt-3 flex flex-wrap gap-6 sm:gap-8">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-white/70">Общий</p>
                    <p className="mt-0.5 tabular text-lg font-medium text-white sm:text-xl">
                      {formatCurrency(myDeskProgress.grandTotal)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-white/70">Готово</p>
                    <p className="mt-0.5 tabular text-lg font-medium text-white sm:text-xl">
                      {formatCurrency(myDeskProgress.doneTotal)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-white/70">% цели</p>
                    <p className="mt-0.5 tabular text-lg font-medium text-white sm:text-xl">
                      {myDeskGoalPercent == null ? "—" : `${myDeskGoalPercent}%`}
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : (
        <div className="mb-8">
          <EmptyState
            className="rounded-2xl border border-border bg-card py-10"
            title="Своего стола пока нет"
            action={
              permissions.canCreatePages ? (
                <Button size="sm" className="min-h-11 gap-1.5" onClick={() => setCreatePageOpen(true)}>
                  <Settings2 className="h-3.5 w-3.5" />
                  Новый стол
                </Button>
              ) : undefined
            }
          />
        </div>
      )}

      <WaitingForYou />

      <TechnicianQueue desks={deskProgress} statusOptions={statusOptions} members={members} />

      <StalledRowsPanel desks={chartSource} statusOptions={statusOptions} members={members} />

      <KpiStatsRow desks={chartSource} statusOptions={statusOptions} />

      <RecentRowsPanel desks={deskProgress} statusOptions={statusOptions} members={members} />

      {showCharts && (
        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {chartBars.length > 0 && (
            <div className="lg:col-span-2">
              <DeskChart
                data={chartBars}
                activeId={highlightedDeskId}
                onHover={setHighlightedDeskId}
                onSelect={(id) => {
                  setHighlightedDeskId(id);
                  navigate(`/page/${id}`);
                }}
              />
            </div>
          )}
          <StatusChart title={isPersonalLanding ? "На моём столе" : "На столах"} data={chartStatus} />
          {chartSource.some((p) => (p.page.monthlyGoal ?? 0) > 0) ? (
            <GoalVsDoneChart
              doneTotal={chartSource.reduce((sum, p) => sum + p.doneTotal, 0)}
              goal={chartSource.reduce((sum, p) => sum + (p.page.monthlyGoal ?? 0), 0)}
            />
          ) : (
            <div className="desk-chart flex items-center rounded-2xl border border-border bg-card px-6 py-8 text-sm text-muted-foreground">
              Поставь цель на месяц в настройках стола — здесь появится сравнение с «Готово».
            </div>
          )}
        </div>
      )}

      {showCharts && chartOrders.length > 0 && (
        <div className="mb-6">
          <RevenueChart data={chartOrders} />
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-5 lg:grid-cols-5">
        {showProgressCards && (
          <div className="flex flex-col gap-4 lg:col-span-3">
            {myProgress.map((p) => (
              <MyProgressCard
                key={p.page.id}
                {...p}
                workspaceId={activeWorkspaceId ?? ""}
                large
                onCustomize={permissions.canManagePage(p.page) ? () => setStudioPageId(p.page.id) : undefined}
              />
            ))}
          </div>
        )}
        {showBoard && (
          <div className={showProgressCards ? "lg:col-span-2" : "lg:col-span-5"}>
            {leaderboard}
          </div>
        )}
      </div>

      <DeskStudioSheet
        page={studioPage}
        open={Boolean(studioPage)}
        onOpenChange={(open) => {
          if (!open) setStudioPageId(null);
        }}
        uid={profile?.uid}
      />
      <CreatePageDialog open={createPageOpen} onOpenChange={setCreatePageOpen} />
    </div>
  );
}
