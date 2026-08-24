import { useEffect, useMemo, useRef, useState } from "react";
import {
  Briefcase,
  ClipboardCheck,
  Download,
  Pencil,
  Settings2,
  Trophy,
  Users,
  UserCog,
  Wallet,
} from "lucide-react";
import { deskEase, gsap, useGSAP } from "@/lib/gsap";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatCard } from "@/components/dashboard/StatCard";
import { RevenueChart } from "@/components/dashboard/RevenueChart";
import { StatusChart } from "@/components/dashboard/StatusChart";
import { RecentActivity } from "@/components/dashboard/RecentActivity";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useMultiPageRows } from "@/hooks/useMultiPageRows";
import { useMultiPageSubPages } from "@/hooks/useMultiPageSubPages";
import { useMultiSubPageRows } from "@/hooks/useMultiSubPageRows";
import { useHistoryLog } from "@/hooks/useHistoryLog";
import { useLeaderboard } from "@/hooks/useLeaderboard";
import { usePermissions } from "@/hooks/usePermissions";
import { isResponsibleForPage } from "@/utils/permissions";
import { DEFAULT_STATUS_OPTIONS } from "@/utils/columnOptions";
import { updateDashboardPages } from "@/services/workspaceService";
import { setPageMonthlyGoal } from "@/services/pageService";
import { updateLeaderboardEntry } from "@/services/leaderboardService";
import { downloadCsv } from "@/utils/csv";
import { formatCurrency } from "@/utils/format";
import { formatDate, timeAgo } from "@/utils/date";
import { useAnimatedNumber } from "@/hooks/useAnimatedNumber";
import { Link } from "react-router";
import type { LeaderboardEntry, PageColumn, PageRow, WorkspacePage } from "@/types";

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

export default function DashboardPage() {
  const { activeWorkspace, activeWorkspaceId, pages, members, isLoadingWorkspaceData } = useWorkspace();
  const permissions = usePermissions();
  const { profile } = useAuth();

  // Only aggregate stats from pages the current viewer can actually open —
  // Owner sees everything, everyone else only their allowed pages. Without
  // this filter, a regular member's Dashboard would leak revenue/client
  // counts pulled from pages they have no access to.
  const visiblePages = useMemo(
    () => pages.filter((p) => permissions.canAccessPage(p)),
    [pages, permissions]
  );

  const clientsPage =
    visiblePages.find((p) => p.id === activeWorkspace?.dashboardClientsPageId) ??
    // Falls back to the old name-guessing heuristic only until an Owner
    // explicitly picks a page — see the "Таблица для дашборда" picker below.
    visiblePages.find((p) => p.name.toLowerCase().includes("клиент"));
  const projectsPage =
    visiblePages.find((p) => p.id === activeWorkspace?.dashboardProjectsPageId) ??
    visiblePages.find((p) => p.name.toLowerCase().includes("проект"));

  // Pages where I'M the assigned "Ответственный" — these get their own
  // personal "мой прогресс" card below, regardless of what they're named.
  const myResponsiblePages = useMemo(
    () => (profile ? visiblePages.filter((p) => isResponsibleForPage(p, profile.uid)) : []),
    [visiblePages, profile]
  );

  // Manager (and Viewer, though they'd rarely have a page) get a personal
  // landing instead of company-wide numbers they have no access to anyway —
  // Owner/Admin keep the full picture.
  const isPersonalLanding = permissions.role !== "owner" && permissions.role !== "admin";

  const rowsByPage = useMultiPageRows(
    activeWorkspaceId,
    [clientsPage?.id, projectsPage?.id, ...myResponsiblePages.map((p) => p.id)].filter(
      (id): id is string => Boolean(id)
    )
  );

  // Each manager's actual work usually lives inside a SPECIFIC tab (subpage)
  // of their page — whichever one they've marked "открывается по умолчанию"
  // (defaultSubPageId) — not in the page's own top-level "Основная" table.
  // Reading only page.columns/rowsByPage[page.id] here made the dashboard
  // show 0 for everyone whose real numbers live in a tab. Fetch each
  // responsible page's subpage list so we can resolve that default tab's
  // OWN columns/rows instead.
  const subPagesByPage = useMultiPageSubPages(activeWorkspaceId, myResponsiblePages.map((p) => p.id));
  const defaultSubPagePairs = useMemo(
    () =>
      myResponsiblePages
        .filter((p) => p.defaultSubPageId)
        .map((p) => ({ pageId: p.id, subPageId: p.defaultSubPageId as string })),
    [myResponsiblePages]
  );
  const rowsBySubPage = useMultiSubPageRows(activeWorkspaceId, defaultSubPagePairs);

  const clientRows = clientsPage ? rowsByPage[clientsPage.id] ?? [] : [];
  const projectRows = projectsPage ? rowsByPage[projectsPage.id] ?? [] : [];

  const statusOptions = activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS;

  // Per-page "Готово" vs "Общий" breakdown for whatever pages I personally
  // own as Ответственный — mirrors the same currency+status total logic the
  // table itself uses (src/components/table/DataTable.tsx financialSummary),
  // just recomputed per page here so each card is self-contained. Sources
  // from the page's default tab (see above) when one is set, otherwise
  // falls back to the page's own top-level table exactly as before.
  const myProgress = useMemo(() => {
    return myResponsiblePages.map((page) => {
      const defaultSubPage = page.defaultSubPageId
        ? subPagesByPage[page.id]?.find((s) => s.id === page.defaultSubPageId)
        : undefined;
      const columns = defaultSubPage ? defaultSubPage.columns : page.columns;
      const rows = defaultSubPage ? rowsBySubPage[defaultSubPage.id] ?? [] : rowsByPage[page.id] ?? [];

      const priceCol = columns.find((c) => c.type === "currency");
      const statusCol = columns.find((c) => c.type === "status");
      let grandTotal = 0;
      let doneTotal = 0;
      for (const row of rows) {
        const raw = Number(row.cells[priceCol?.key ?? "price"] ?? 0) || 0;
        grandTotal += raw;
        if (statusCol) {
          const rawStatus = String(row.cells[statusCol.key] ?? "");
          const label = statusOptions.find((o) => o.value === rawStatus)?.label ?? rawStatus;
          if (label.toLowerCase().includes("готов")) doneTotal += raw;
        }
      }
      const percent = grandTotal > 0 ? Math.round((doneTotal / grandTotal) * 100) : 0;
      return { page, doneTotal, grandTotal, percent, rowCount: rows.length, columns, rows };
    });
  }, [myResponsiblePages, rowsByPage, subPagesByPage, rowsBySubPage, statusOptions]);

  // Keep my own leaderboard entry (entries) fresh as a side effect of
  // simply looking at my own numbers — see src/services/leaderboardService.ts
  // for why there's no server-side job doing this instead.
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
        /* best-effort — a leaderboard hiccup should never break the dashboard itself */
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myProgress, activeWorkspaceId, profile?.uid]);

  const leaderboardEntries = useLeaderboard(activeWorkspaceId);

  const clientAmountColumn = clientsPage?.columns.find((c) => c.type === "currency");

  const totalRevenue = useMemo(() => {
    if (!clientAmountColumn) return 0;
    return clientRows.reduce((sum, row) => sum + (Number(row.cells[clientAmountColumn.key]) || 0), 0);
  }, [clientRows, clientAmountColumn]);

  const activeEmployeesCount = members.filter((m) => m.status === "active").length;

  const revenueByMonth = useMemo(() => {
    if (!clientAmountColumn) return [];
    const buckets = new Map<string, number>();
    clientRows.forEach((row) => {
      const label = formatDate(row.createdAt, "LLL yyyy");
      buckets.set(label, (buckets.get(label) ?? 0) + (Number(row.cells[clientAmountColumn.key]) || 0));
    });
    return Array.from(buckets.entries()).map(([label, value]) => ({ label, value }));
  }, [clientRows, clientAmountColumn]);

  const statusColumn = clientsPage?.columns.find((c) => c.type === "status");
  const statusDistribution = useMemo(() => {
    if (!statusColumn) return [];
    return statusOptions.map((opt) => ({
      name: opt.label,
      value: clientRows.filter((r) => r.cells[statusColumn.key] === opt.value).length,
      color: opt.color,
    }));
  }, [statusColumn, clientRows, statusOptions]);

  // The history/audit log is Owner-only per firestore.rules — don't even
  // subscribe for anyone else, or every non-owner would hit a guaranteed
  // permission-denied on their very first Dashboard load.
  const { entries: historyEntries } = useHistoryLog(permissions.canViewHistory ? activeWorkspaceId : null);


  const openClientCount = useMemo(() => {
    if (!statusColumn) return 0;
    return clientRows.filter((r) => {
      const raw = String(r.cells[statusColumn.key] ?? "");
      const label = statusOptions.find((o) => o.value === raw)?.label ?? raw;
      return !label.toLowerCase().includes("готов");
    }).length;
  }, [clientRows, statusColumn, statusOptions]);

  const attentionItems = useMemo(() => {
    const items: { label: string; detail: string; href: string }[] = [];
    myProgress.forEach((p) => {
      if (p.grandTotal > 0 && p.percent < 100) {
        items.push({
          label: p.page.name,
          detail: `${p.percent}% готово · ещё ${formatCurrency(p.grandTotal - p.doneTotal)}`,
          href: `/page/${p.page.id}`,
        });
      }
    });
    if (clientsPage && openClientCount > 0) {
      items.push({
        label: clientsPage.name,
        detail: `${openClientCount} записей ещё не в «Готово»`,
        href: `/page/${clientsPage.id}`,
      });
    }
    return items.slice(0, 5);
  }, [myProgress, clientsPage, openClientCount]);

  const deskRef = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const nodes = deskRef.current?.querySelectorAll(".desk-metric, .desk-attention");
      if (!nodes?.length) return;
      gsap.fromTo(nodes, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.32, stagger: 0.05, ease: deskEase });
    },
    { scope: deskRef, dependencies: [isLoadingWorkspaceData] }
  );

  if (isLoadingWorkspaceData) {
    return (
      <div className="p-6">
        <Skeleton className="mb-6 h-8 w-64" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      </div>
    );
  }


  const dateLine = formatDate(Date.now(), "d MMMM");
  const name = profile ? profile.nickname || profile.name : "";

  const greeting = (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="eyebrow mb-2 text-primary">Сегодня · {dateLine}</p>
        <h1 className="display text-[1.9rem] leading-[1.15] sm:text-[2.15rem]">
          {name ? `Добрый день, ${name}` : "Добрый день"}
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
          {isPersonalLanding
            ? "Стол на сегодня: ваш прогресс и то, что ещё требует внимания."
            : "Стол на сегодня — не виджеты, а то, что требует внимания, и как движется работа."}
        </p>
      </div>
      {!isPersonalLanding && permissions.canManageWorkspace && (
        <DashboardSourcePicker
          workspaceId={activeWorkspaceId ?? ""}
          pages={visiblePages}
          clientsPageId={activeWorkspace?.dashboardClientsPageId}
          projectsPageId={activeWorkspace?.dashboardProjectsPageId}
        />
      )}
    </div>
  );

  if (isPersonalLanding) {
    return (
      <div ref={deskRef} className="mx-auto max-w-5xl p-4 sm:p-6 lg:p-8">
        {greeting}
        {myProgress.length === 0 ? (
          <div className="desk-cluster px-8 py-16 text-center">
            <p className="eyebrow mb-3 text-primary">Стол</p>
            <p className="display text-[1.4rem]">Пока нет страниц в ответственности</p>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
              Как только вас назначат Ответственным, здесь появится личный прогресс.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
            <div className="flex flex-col gap-4 lg:col-span-3">
              {attentionItems.length > 0 && (
                <div className="desk-cluster desk-attention p-5">
                  <p className="eyebrow mb-3 text-primary">Что требует внимания</p>
                  <div className="flex flex-col">
                    {attentionItems.map((item) => (
                      <Link
                        key={item.href + item.detail}
                        to={item.href}
                        className="flex items-baseline justify-between gap-3 border-t border-border/60 py-2.5 first:border-t-0 first:pt-0"
                      >
                        <span className="truncate text-sm font-medium">{item.label}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{item.detail}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
              {myProgress.map((p) => (
                <MyProgressCard key={p.page.id} {...p} workspaceId={activeWorkspaceId ?? ""} large />
              ))}
            </div>
            <div className="lg:col-span-2">
              <LeaderboardWidget entries={leaderboardEntries} members={members} myUid={profile?.uid} />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={deskRef} className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
      {greeting}

      <div className="desk-cluster mb-6">
        <div className="grid grid-cols-2 divide-x divide-border/60 lg:grid-cols-4">
          <StatCard label="Клиенты" value={String(clientRows.length)} animatedValue={clientRows.length} formatAnimatedValue={(n) => String(Math.round(n))} icon={Users} color="248 79% 62%" />
          <StatCard label="Доход" value={formatCurrency(totalRevenue)} animatedValue={totalRevenue} formatAnimatedValue={(n) => formatCurrency(n)} icon={Wallet} color="158 64% 40%" />
          <StatCard label="Проекты" value={String(projectRows.length)} animatedValue={projectRows.length} formatAnimatedValue={(n) => String(Math.round(n))} icon={Briefcase} color="275 72% 57%" />
          <StatCard label="Команда" value={String(activeEmployeesCount)} animatedValue={activeEmployeesCount} formatAnimatedValue={(n) => String(Math.round(n))} icon={UserCog} color="196 82% 46%" />
        </div>
        <div className="grid grid-cols-1 divide-y divide-border/60 border-t border-border/60 lg:grid-cols-5 lg:divide-x lg:divide-y-0">
          <div className="desk-attention p-5 lg:col-span-3">
            <p className="eyebrow mb-3 text-primary">Что требует внимания</p>
            {attentionItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">На столе спокойно — открытых хвостов нет.</p>
            ) : (
              <div className="flex flex-col">
                {attentionItems.map((item) => (
                  <Link
                    key={item.href + item.detail}
                    to={item.href}
                    className="flex items-baseline justify-between gap-3 border-t border-border/50 py-2.5 first:border-t-0 first:pt-0 hover:text-primary"
                  >
                    <span className="truncate text-sm font-medium">{item.label}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{item.detail}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
          <div className="p-5 lg:col-span-2">
            <p className="eyebrow mb-3 flex items-center gap-1.5 text-primary">
              <ClipboardCheck className="h-3.5 w-3.5" /> Прогресс
            </p>
            {myProgress.length === 0 ? (
              <p className="text-sm text-muted-foreground">Нет страниц в вашей ответственности.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {myProgress.map((p) => (
                  <Link key={p.page.id} to={`/page/${p.page.id}`} className="block">
                    <div className="mb-1 flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium">{p.page.name}</span>
                      <span className="font-mono text-[11px] tabular text-muted-foreground">{p.percent}%</span>
                    </div>
                    <div className="h-px overflow-hidden bg-muted">
                      <div className="h-full bg-success" style={{ width: `${Math.min(100, p.percent)}%` }} />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RevenueChart data={revenueByMonth} />
        </div>
        <div className="flex flex-col gap-4">
          <StatusChart title="Статусы клиентов" data={statusDistribution} />
          <LeaderboardWidget entries={leaderboardEntries} members={members} myUid={profile?.uid} />
        </div>
      </div>

      {permissions.canViewHistory && <RecentActivity entries={historyEntries} />}
    </div>
  );
}

function DashboardSourcePicker({
  workspaceId,
  pages,
  clientsPageId,
  projectsPageId,
}: {
  workspaceId: string;
  pages: { id: string; name: string }[];
  clientsPageId?: string;
  projectsPageId?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" title="Таблица для дашборда">
          <Settings2 className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <p className="mb-3 text-sm font-medium">Таблица для дашборда</p>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Клиенты / доход / статусы</Label>
            <Select
              value={clientsPageId ?? "__auto__"}
              onValueChange={(v) => updateDashboardPages(workspaceId, { clientsPageId: v === "__auto__" ? null : v })}
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__auto__">Определять по названию</SelectItem>
                {pages.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Проекты</Label>
            <Select
              value={projectsPageId ?? "__auto__"}
              onValueChange={(v) => updateDashboardPages(workspaceId, { projectsPageId: v === "__auto__" ? null : v })}
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__auto__">Определять по названию</SelectItem>
                {pages.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MyProgressCard({
  workspaceId,
  page,
  doneTotal,
  grandTotal,
  percent,
  rowCount,
  columns,
  rows,
  large,
}: {
  workspaceId: string;
  page: WorkspacePage;
  doneTotal: number;
  grandTotal: number;
  percent: number;
  rowCount: number;
  columns: PageColumn[];
  rows: PageRow[];
  large?: boolean;
}) {
  const animatedDone = useAnimatedNumber(doneTotal);
  const animatedTotal = useAnimatedNumber(grandTotal);
  const animatedPercent = useAnimatedNumber(percent);

  const [editingGoal, setEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState(String(page.monthlyGoal ?? ""));
  const goal = page.monthlyGoal ?? 0;
  const goalPercent = goal > 0 ? Math.min(100, Math.round((doneTotal / goal) * 100)) : null;

  async function saveGoal() {
    const value = Number(goalInput);
    await setPageMonthlyGoal(workspaceId, page.id, Number.isFinite(value) && value > 0 ? value : null);
    setEditingGoal(false);
  }

  function handleExport() {
    const header = columns.map((c) => c.label);
    const lines = rows.map((row) => columns.map((c) => String(row.cells[c.key] ?? "")));
    downloadCsv(`${page.name}.csv`, header, lines);
  }

  return (
    <Card className="overflow-hidden border-border/70 bg-card/70">
      <CardContent className={large ? "p-6" : "p-4"}>
        <div className="mb-3 flex items-center justify-between">
          <Link to={`/page/${page.id}`} className={large ? "truncate text-lg font-medium hover:text-primary" : "truncate text-sm font-medium hover:text-primary"}>
            {page.name}
          </Link>
          <div className="flex shrink-0 items-center gap-1">
            <span className="text-xs text-muted-foreground">{rowCount} строк</span>
            <Button variant="ghost" size="icon" className="h-6 w-6" title="Скачать мой отчёт (CSV)" onClick={handleExport}>
              <Download className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <div className="mb-2 flex items-end justify-between">
          <div>
            <p className="eyebrow">Готово</p>
            <p className={cn(large ? "text-2xl" : "text-xl", "display tabular text-success")}>{formatCurrency(animatedDone)}</p>
          </div>
          <div className="text-right">
            <p className="eyebrow">Общий</p>
            <p className={cn(large ? "text-2xl" : "text-xl", "display tabular")}>{formatCurrency(animatedTotal)}</p>
          </div>
        </div>
        <div className="h-px w-full overflow-hidden bg-muted">
          <div
            className="h-full rounded-full bg-success transition-all"
            style={{ width: `${Math.min(100, animatedPercent)}%` }}
          />
        </div>
        <p className="mt-1.5 text-right text-xs font-medium text-muted-foreground">
          {Math.round(animatedPercent)}% готово
        </p>

        <div className="mt-3 border-t border-border pt-3">
          {editingGoal ? (
            <div className="flex items-center gap-2">
              <Input
                autoFocus
                type="number"
                value={goalInput}
                onChange={(e) => setGoalInput(e.target.value)}
                placeholder="Например, 200000"
                className="h-8"
                onKeyDown={(e) => e.code === "Enter" && saveGoal()}
              />
              <Button size="sm" className="h-8" onClick={saveGoal}>
                Сохранить
              </Button>
            </div>
          ) : (
            <button
              className="flex w-full items-center justify-between text-left"
              onClick={() => {
                setGoalInput(String(page.monthlyGoal ?? ""));
                setEditingGoal(true);
              }}
            >
              {goal > 0 ? (
                <>
                  <span className="text-xs text-muted-foreground">
                    План: <span className="font-medium text-foreground">{formatCurrency(goal)}</span>
                  </span>
                  <span className="flex items-center gap-1 text-xs font-medium text-primary">
                    {goalPercent}% от плана <Pencil className="h-3 w-3" />
                  </span>
                </>
              ) : (
                <span className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                  <Pencil className="h-3 w-3" /> Поставить личный план на месяц
                </span>
              )}
            </button>
          )}
          {goal > 0 && !editingGoal && (
            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${goalPercent}%` }} />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function LeaderboardWidget({
  entries,
  members,
  myUid,
}: {
  entries: LeaderboardEntry[];
  members: { uid: string; name?: string; nickname?: string; photoURL?: string | null; lastActiveAt?: number; status: string; role: string }[];
  myUid?: string;
}) {
  // Ranked by total sum "Готово" (not %) — a small page fully done
  // shouldn't outrank someone who closed 5x more in absolute terms. Every
  // active member appears, even at 0 with no page yet, so this reads as
  // the whole team's board, not just a list of whoever has data so far. A
  // person responsible for more than one page has their totals summed
  // into one row.
  const ranked = useMemo(() => {
    return members
      .filter((m) => m.status === "active")
      .map((member) => {
        const myEntries = entries.filter((e) => e.responsibleUserId === member.uid);
        const doneTotal = myEntries.reduce((sum, e) => sum + e.doneTotal, 0);
        const grandTotal = myEntries.reduce((sum, e) => sum + e.grandTotal, 0);
        const pageNames = myEntries.map((e) => e.pageName);
        return { member, doneTotal, grandTotal, pageNames };
      })
      .sort((a, b) => b.doneTotal - a.doneTotal);
  }, [entries, members]);

  return (
    <Card>
      <CardContent className="p-4">
        <p className="eyebrow mb-3 flex items-center gap-1.5 text-primary">
          <Trophy className="h-3.5 w-3.5" /> Рейтинг по сумме «Готово»
        </p>
        {ranked.length === 0 ? (
          <p className="text-xs text-muted-foreground">В команде пока нет активных участников.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {ranked.map(({ member, doneTotal, pageNames }, i) => (
              <div key={member.uid} className="flex items-center gap-2.5">
                <span className="w-5 shrink-0 text-center font-mono text-[11px] tabular text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                <MemberAvatar
                  id={member.uid}
                  name={member.name}
                  nickname={member.nickname}
                  photoURL={member.photoURL}
                  className={cn("h-7 w-7 shrink-0", member.uid === myUid && "ring-2 ring-primary")}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{member.nickname || member.name || "—"}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {pageNames.length > 0 ? pageNames.join(", ") : "нет страницы"}
                    {member.lastActiveAt ? ` · был(а) ${timeAgo(member.lastActiveAt)}` : ""}
                  </p>
                </div>
                <span className="shrink-0 font-mono text-sm tabular text-primary">{formatCurrency(doneTotal)}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
