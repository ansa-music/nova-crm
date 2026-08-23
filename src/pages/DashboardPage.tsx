import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowUpRight,
  Briefcase,
  CalendarDays,
  ClipboardCheck,
  Download,
  Pencil,
  Settings2,
  Trophy,
  Users,
  UserCog,
  Wallet,
} from "lucide-react";
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

  const heroGreeting = (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
    >
      <div>
        <p className="eyebrow mb-2 text-primary">{isPersonalLanding ? "Моё рабочее пространство" : "Рабочее пространство"}</p>
        <h1 className="text-3xl font-light tracking-tight sm:text-[2rem]">
          С возвращением{profile ? `, ${profile.nickname || profile.name}` : ""} <span aria-hidden="true">👋</span>
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {isPersonalLanding
            ? `Ваш прогресс на ${formatDate(Date.now(), "d MMMM")}`
            : `Сводка по команде и продажам на ${formatDate(Date.now(), "d MMMM")}`}
        </p>
      </div>
      {!isPersonalLanding && (
        <div className="flex items-center gap-2">
          {permissions.canManageWorkspace && (
            <DashboardSourcePicker
              workspaceId={activeWorkspaceId ?? ""}
              pages={visiblePages}
              clientsPageId={activeWorkspace?.dashboardClientsPageId}
              projectsPageId={activeWorkspace?.dashboardProjectsPageId}
            />
          )}
          <Button variant="outline" className="w-fit gap-2">
            <CalendarDays className="h-4 w-4" /> Сегодня
            <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </div>
      )}
    </motion.div>
  );

  // ---- Manager (and below): personal landing only — their own page(s),
  // no company-wide numbers they don't have access to anyway. ----
  if (isPersonalLanding) {
    return (
      <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
        {heroGreeting}

        {myProgress.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Вы пока не назначены Ответственным ни за одну страницу — как только вас назначат, здесь появится
              ваш личный прогресс.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="flex flex-col gap-4 lg:col-span-2">
              {myProgress.map((p) => (
                <MyProgressCard key={p.page.id} {...p} workspaceId={activeWorkspaceId ?? ""} large />
              ))}
            </div>
            <LeaderboardWidget entries={leaderboardEntries} members={members} myUid={profile?.uid} />
          </div>
        )}
      </div>
    );
  }

  // ---- Owner/Admin: full company-wide dashboard ----
  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
      {heroGreeting}

      {myProgress.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="mb-6"
        >
          <p className="eyebrow mb-3 flex items-center gap-1.5 text-primary">
            <ClipboardCheck className="h-3.5 w-3.5" /> Мой прогресс
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {myProgress.map((p) => (
              <MyProgressCard key={p.page.id} {...p} workspaceId={activeWorkspaceId ?? ""} />
            ))}
          </div>
        </motion.div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Клиенты" value={String(clientRows.length)} animatedValue={clientRows.length} formatAnimatedValue={(n) => String(Math.round(n))} icon={Users} color="248 79% 62%" delay={0} />
        <StatCard label="Доход" value={formatCurrency(totalRevenue)} animatedValue={totalRevenue} formatAnimatedValue={(n) => formatCurrency(n)} icon={Wallet} color="158 64% 40%" delay={0.05} />
        <StatCard label="Проекты" value={String(projectRows.length)} animatedValue={projectRows.length} formatAnimatedValue={(n) => String(Math.round(n))} icon={Briefcase} color="275 72% 57%" delay={0.1} />
        <StatCard label="Сотрудники" value={String(activeEmployeesCount)} animatedValue={activeEmployeesCount} formatAnimatedValue={(n) => String(Math.round(n))} icon={UserCog} color="196 82% 46%" delay={0.15} />
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
    <Card className="overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card">
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
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Готово</p>
            <p className={cn(large ? "text-2xl" : "text-xl", "font-light tabular-nums text-success")}>{formatCurrency(animatedDone)}</p>
          </div>
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Общий</p>
            <p className={cn(large ? "text-2xl" : "text-xl", "font-light tabular-nums")}>{formatCurrency(animatedTotal)}</p>
          </div>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
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
                onKeyDown={(e) => e.key === "Enter" && saveGoal()}
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
  members: { uid: string; name?: string; nickname?: string; photoURL?: string | null; lastActiveAt?: number }[];
  myUid?: string;
}) {
  const ranked = useMemo(() => [...entries].sort((a, b) => b.percent - a.percent || b.doneTotal - a.doneTotal), [entries]);

  return (
    <Card>
      <CardContent className="p-4">
        <p className="eyebrow mb-3 flex items-center gap-1.5 text-primary">
          <Trophy className="h-3.5 w-3.5" /> Рейтинг
        </p>
        {ranked.length === 0 ? (
          <p className="text-xs text-muted-foreground">Пока нет ни одной страницы с назначенным Ответственным.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {ranked.map((entry, i) => {
              const member = members.find((m) => m.uid === entry.responsibleUserId);
              return (
                <div key={entry.pageId} className="flex items-center gap-2.5">
                  <span className="w-4 shrink-0 text-center text-xs font-mono text-muted-foreground">{i + 1}</span>
                  <MemberAvatar
                    id={entry.responsibleUserId}
                    name={member?.name}
                    nickname={member?.nickname}
                    photoURL={member?.photoURL}
                    className={cn("h-7 w-7 shrink-0", entry.responsibleUserId === myUid && "ring-2 ring-primary")}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{entry.pageName}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {member ? (member.nickname || member.name) : "—"}
                      {member?.lastActiveAt ? ` · был(а) ${timeAgo(member.lastActiveAt)}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-primary">{entry.percent}%</span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
