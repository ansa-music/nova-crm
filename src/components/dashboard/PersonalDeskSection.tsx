import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Plus, Settings2, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeskCoverStrip } from "@/components/dashboard/DeskCoverStrip";
import { RecentRowsPanel } from "@/components/dashboard/RecentRowsPanel";
import { TechnicianQueue } from "@/components/dashboard/TechnicianQueue";
import { WaitingForYou } from "@/components/dashboard/WaitingForYou";
import { CreatePageDialog } from "@/components/pagesnav/CreatePageDialog";
import { DeskStudioSheet } from "@/components/pagesnav/DeskStudioSheet";
import { useAuth } from "@/hooks/useAuth";
import { isFresh, isLoadedOk } from "@/hooks/useCachedBatchLoads";
import { useMultiPageRows } from "@/hooks/useMultiPageRows";
import { useMultiPageSubPages } from "@/hooks/useMultiPageSubPages";
import { subPageRowsKey, useMultiSubPageRows } from "@/hooks/useMultiSubPageRows";
import { usePeopleDesks } from "@/hooks/usePeopleDesks";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { publishLeaderboardEntries, type LeaderboardEntryDraft } from "@/services/leaderboardService";
import { DEFAULT_STATUS_OPTIONS } from "@/utils/columnOptions";
import { doneMonthTotal } from "@/utils/dashboardTrends";
import { nowOrderCounts, progressForPage } from "@/utils/deskProgress";
import { formatCurrency } from "@/utils/format";
import { resolvedCoverUrl } from "@/utils/peopleDesks";
import { isResponsibleForPage } from "@/utils/permissions";
import type { PageRow } from "@/types";

/**
 * Пауза перед записью leaderboard: строки столов приходят партиями, и
 * каждая партия пересчитывает все столы. Пишем то, на чём числа
 * успокоились, а не каждую промежуточную версию.
 */
const LEADERBOARD_PUBLISH_DEBOUNCE_MS = 3_000;

/**
 * The personal top of «Дашборд»: join requests (Owner/Тимлид), your own desk
 * with its money and monthly goal, today's orders and view requests for a
 * Технарь, and the latest rows of the desks you work with. Reads rows of
 * those desks only — the workspace-wide part below it is built from
 * aggregates. Also keeps the shared leaderboard entries (desk cover
 * progress on «Столы») fresh, like the old desk dashboard did.
 */
export function PersonalDeskSection() {
  const { activeWorkspace, activeWorkspaceId, members } = useWorkspace();
  const permissions = usePermissions();
  const { profile } = useAuth();
  const { myDesk, studioPages, ownerUid } = usePeopleDesks();
  const [studioPageId, setStudioPageId] = useState<string | null>(null);
  const [createPageOpen, setCreatePageOpen] = useState(false);
  const navigate = useNavigate();
  const studioPage =
    studioPages.find((p) => p.id === studioPageId) ?? (studioPageId && myDesk?.id === studioPageId ? myDesk : null);

  const rowPageIds = useMemo(() => studioPages.filter((p) => !p.defaultSubPageId).map((p) => p.id), [studioPages]);
  // Свои столы — всегда с сервера (см. bypass в useCachedBatchLoads).
  const myUid = profile?.uid ?? "";
  const ownPageIds = useMemo(
    () => new Set(studioPages.filter((p) => p.responsibleUserId === myUid).map((p) => p.id)),
    [studioPages, myUid]
  );
  const rowLoads = useMultiPageRows(activeWorkspaceId, rowPageIds, (pageId) => ownPageIds.has(pageId));
  const rowsByPage = rowLoads.data;
  const defaultSubPagePairs = useMemo(
    () =>
      studioPages
        .filter((p) => p.defaultSubPageId)
        .map((p) => ({ pageId: p.id, subPageId: p.defaultSubPageId as string })),
    [studioPages]
  );
  // Колонки — только вкладки по умолчанию (одно чтение на стол), строки — её же.
  const subPageLoads = useMultiPageSubPages(activeWorkspaceId, defaultSubPagePairs, (pair) => ownPageIds.has(pair.pageId));
  const subPagesByPage = subPageLoads.data;
  const subRowLoads = useMultiSubPageRows(activeWorkspaceId, defaultSubPagePairs, (pair) => ownPageIds.has(pair.pageId));
  const rowsBySubPage = subRowLoads.data;
  const statusOptions = activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS;

  const deskProgress = useMemo(
    () =>
      studioPages.map((page) => {
        // progressForPage ищет строки вкладки по её id, а id месячных вкладок
        // одинаковый на всех столах — даём ему строки именно этого стола.
        const tabId = page.defaultSubPageId;
        const tabRows = tabId ? rowsBySubPage[subPageRowsKey(page.id, tabId)] : undefined;
        const ownTabRows: Record<string, PageRow[]> = tabId && tabRows ? { [tabId]: tabRows } : {};
        return progressForPage(page, subPagesByPage, ownTabRows, rowsByPage, statusOptions);
      }),
    [studioPages, subPagesByPage, rowsBySubPage, rowsByPage, statusOptions]
  );
  // Числа стола известны, только когда его строки (и колонки вкладки по
  // умолчанию) реально прочитаны. Пока грузится или чтение упало, у
  // progressForPage выходит «0 ₸ / 0%» — это «не знаем», а не ноль: такие
  // нули мигали на обложке своего стола и уходили в leaderboard.
  const knownDeskIds = useMemo(
    () =>
      new Set(
        studioPages
          .filter((p) =>
            p.defaultSubPageId
              ? isLoadedOk(subPageLoads, p.id) && isLoadedOk(subRowLoads, subPageRowsKey(p.id, p.defaultSubPageId))
              : isLoadedOk(rowLoads, p.id)
          )
          .map((p) => p.id)
      ),
    [studioPages, rowLoads, subPageLoads, subRowLoads]
  );
  // Все загрузчики получили все свои ключи (пусть и с ошибкой) — пересчёт
  // больше не будет дёргаться от каждой новой партии строк.
  const loadsComplete =
    rowPageIds.every((id) => id in rowsByPage) &&
    defaultSubPagePairs.every(
      (p) => p.pageId in subPagesByPage && subPageRowsKey(p.pageId, p.subPageId) in rowsBySubPage
    );
  const myDeskProgress = useMemo(
    () => (myDesk && knownDeskIds.has(myDesk.id) ? deskProgress.find((d) => d.page.id === myDesk.id) : undefined),
    [deskProgress, myDesk, knownDeskIds]
  );
  const myProgress = useMemo(
    () => (profile ? deskProgress.filter((p) => isResponsibleForPage(p.page, profile.uid)) : []),
    [deskProgress, profile]
  );
  const publishDesks = permissions.role === "owner" ? deskProgress : myProgress;

  // В общий leaderboard — только столы, прочитанные с сервера в этот заход:
  // цифры из 15-минутного кэша могли бы затереть свежие, записанные технарём.
  const freshDeskIds = useMemo(
    () =>
      new Set(
        studioPages
          .filter((p) =>
            p.defaultSubPageId
              ? isFresh(subPageLoads, p.id) && isFresh(subRowLoads, subPageRowsKey(p.id, p.defaultSubPageId))
              : isFresh(rowLoads, p.id)
          )
          .map((p) => p.id)
      ),
    [studioPages, rowLoads, subPageLoads, subRowLoads]
  );

  const leaderboardEntries = useMemo((): LeaderboardEntryDraft[] => {
    if (!loadsComplete) return [];
    return publishDesks.flatMap((desk) => {
      const uid = desk.page.responsibleUserId;
      if (!uid || !knownDeskIds.has(desk.page.id) || !freshDeskIds.has(desk.page.id)) return [];
      const pieces = nowOrderCounts([desk], statusOptions);
      return [
        {
          pageId: desk.page.id,
          pageName: desk.page.name,
          responsibleUserId: uid,
          doneTotal: desk.doneTotal,
          grandTotal: desk.grandTotal,
          percent: desk.percent,
          openCount: pieces.open,
          doneCount: pieces.done,
        },
      ];
    });
  }, [loadsComplete, publishDesks, knownDeskIds, freshDeskIds, statusOptions]);
  // Таймер сбрасывается только когда сдвинулись сами числа, а не ссылки
  // на массивы (statusOptions и столы пересоздаются на любом снимке).
  const leaderboardKey = useMemo(() => JSON.stringify(leaderboardEntries), [leaderboardEntries]);

  useEffect(() => {
    if (!activeWorkspaceId || !profile || leaderboardEntries.length === 0) return;
    const workspaceId = activeWorkspaceId;
    const entries = leaderboardEntries;
    const timer = window.setTimeout(() => {
      void publishLeaderboardEntries(workspaceId, entries);
    }, LEADERBOARD_PUBLISH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaderboardKey, activeWorkspaceId, profile?.uid]);

  const myDeskGoal = myDeskProgress?.page.monthlyGoal ?? 0;
  // monthlyGoal is a per-MONTH target: compare it with this month's «Готово».
  const myDeskDoneThisMonth = myDeskProgress ? doneMonthTotal([myDeskProgress], statusOptions) : 0;
  const myDeskGoalPercent =
    myDeskProgress && myDeskGoal > 0 ? Math.min(100, Math.round((myDeskDoneThisMonth / myDeskGoal) * 100)) : null;
  // A Технарь without a desk yet: offer to create it right here.
  const offerNewDesk = !myDesk && permissions.deskCreatorRole === "manager" && permissions.canCreatePages;

  return (
    <div className="flex flex-col gap-4 empty:hidden [&>*]:!mb-0">
      <WaitingForYou />

      {myDesk ? (
        <section className="relative overflow-hidden rounded-[1.35rem] border border-border">
          <button type="button" className="block w-full text-left" onClick={() => navigate(`/page/${myDesk.id}`)}>
            <DeskCoverStrip coverUrl={resolvedCoverUrl(myDesk, ownerUid)} name={myDesk.name} ratio="hero" />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
          </button>
          <div className="pointer-events-none absolute inset-0 z-[1] flex flex-col justify-between p-4 sm:p-7">
            <div className="pointer-events-auto flex flex-wrap items-center gap-2 self-start">
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 rounded-full border-white/25 bg-white/10 px-4 text-white hover:bg-white/16 hover:text-white"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  navigate(`/page/${myDesk.id}`);
                }}
              >
                <Table2 className="h-3.5 w-3.5" />
                Открыть стол
              </Button>
              {permissions.canManagePage(myDesk) ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11 min-w-11 rounded-full border-white/25 bg-white/10 px-3 text-white hover:bg-white/16 hover:text-white sm:px-4"
                  title="Настроить стол"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setStudioPageId(myDesk.id);
                  }}
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  <span className="sr-only sm:not-sr-only">Настроить стол</span>
                </Button>
              ) : null}
            </div>
            <div>
              <p className="font-serif text-[1.65rem] font-medium tracking-[-0.03em] text-white sm:text-[2.15rem]">{myDesk.name}</p>
              {myDeskProgress ? (
                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 sm:gap-8">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-white/70">Общий</p>
                    <p className="mt-0.5 tabular text-lg font-medium text-white sm:text-xl">{formatCurrency(myDeskProgress.grandTotal)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-white/70">Готово</p>
                    <p className="mt-0.5 tabular text-lg font-medium text-white sm:text-xl">{formatCurrency(myDeskProgress.doneTotal)}</p>
                  </div>
                  {/* Цель задана не у всех столов: метрика с прочерком занимала
                      место рядом с деньгами и ничего не сообщала. */}
                  {myDeskGoalPercent != null && (
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-wide text-white/70">% цели</p>
                      <p className="mt-0.5 tabular text-lg font-medium text-white sm:text-xl">{myDeskGoalPercent}%</p>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : offerNewDesk ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-primary/40 bg-primary/[0.05] px-4 py-3">
          <p className="text-sm">
            <span className="font-medium">Своего стола пока нет.</span>{" "}
            <span className="text-muted-foreground">Создайте его — заказы, месячные вкладки и место в рейтинге появятся сразу.</span>
          </p>
          <Button size="sm" className="gap-1.5" onClick={() => setCreatePageOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Новый стол
          </Button>
        </div>
      ) : null}

      <TechnicianQueue desks={deskProgress} statusOptions={statusOptions} members={members} />

      <RecentRowsPanel desks={deskProgress} statusOptions={statusOptions} members={members} />

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
