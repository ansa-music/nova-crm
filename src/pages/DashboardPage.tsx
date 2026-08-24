import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Download, Pencil, Settings2 } from "lucide-react";
import { deskEase, gsap, useGSAP } from "@/lib/gsap";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import type { LeaderboardEntry, PageColumn, PageRow, StatusOption, SubPage, WorkspacePage } from "@/types";

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

function personLabel(member?: { name?: string; nickname?: string } | null) {
  if (!member) return "";
  return member.nickname || member.name || "";
}

interface PageProgress {
  page: WorkspacePage;
  doneTotal: number;
  grandTotal: number;
  percent: number;
  rowCount: number;
  openCount: number;
  columns: PageColumn[];
  rows: PageRow[];
}

function progressForPage(
  page: WorkspacePage,
  subPagesByPage: Record<string, SubPage[]>,
  rowsBySubPage: Record<string, PageRow[]>,
  rowsByPage: Record<string, PageRow[]>,
  statusOptions: StatusOption[]
): PageProgress {
  const defaultSubPage = page.defaultSubPageId
    ? subPagesByPage[page.id]?.find((s) => s.id === page.defaultSubPageId)
    : undefined;
  const columns = defaultSubPage ? defaultSubPage.columns : page.columns;
  const rows = defaultSubPage ? rowsBySubPage[defaultSubPage.id] ?? [] : rowsByPage[page.id] ?? [];

  const priceCol = columns.find((c) => c.type === "currency");
  const statusCol = columns.find((c) => c.type === "status");
  let grandTotal = 0;
  let doneTotal = 0;
  let openCount = 0;
  for (const row of rows) {
    const raw = Number(row.cells[priceCol?.key ?? "price"] ?? 0) || 0;
    grandTotal += raw;
    if (statusCol) {
      const rawStatus = String(row.cells[statusCol.key] ?? "");
      const label = statusOptions.find((o) => o.value === rawStatus)?.label ?? rawStatus;
      if (label.toLowerCase().includes("готов")) doneTotal += raw;
      else openCount += 1;
    }
  }
  const percent = grandTotal > 0 ? Math.round((doneTotal / grandTotal) * 100) : 0;
  return { page, doneTotal, grandTotal, percent, rowCount: rows.length, openCount, columns, rows };
}

export default function DashboardPage() {
  const { activeWorkspace, activeWorkspaceId, pages, members, isLoadingWorkspaceData } = useWorkspace();
  const permissions = usePermissions();
  const { profile } = useAuth();

  const visiblePages = useMemo(
    () => pages.filter((p) => permissions.canAccessPage(p)),
    [pages, permissions]
  );

  const clientsPage =
    visiblePages.find((p) => p.id === activeWorkspace?.dashboardClientsPageId) ??
    visiblePages.find((p) => p.name.toLowerCase().includes("клиент"));
  const projectsPage =
    visiblePages.find((p) => p.id === activeWorkspace?.dashboardProjectsPageId) ??
    visiblePages.find((p) => p.name.toLowerCase().includes("проект"));

  const isPersonalLanding = permissions.role !== "owner" && permissions.role !== "admin";

  // Owner/admin check-in needs progress for EVERY visible desk, not only
  // pages the current person runs. Personal landing still uses the same
  // default-tab resolution (defaultSubPageId).
  const progressPageIds = useMemo(() => visiblePages.map((p) => p.id), [visiblePages]);
  const rowPageIds = useMemo(() => {
    const ids = new Set(progressPageIds);
    if (clientsPage?.id) ids.add(clientsPage.id);
    if (projectsPage?.id) ids.add(projectsPage.id);
    return Array.from(ids);
  }, [progressPageIds, clientsPage?.id, projectsPage?.id]);

  const rowsByPage = useMultiPageRows(activeWorkspaceId, rowPageIds);
  const subPagesByPage = useMultiPageSubPages(activeWorkspaceId, progressPageIds);
  const defaultSubPagePairs = useMemo(
    () =>
      visiblePages
        .filter((p) => p.defaultSubPageId)
        .map((p) => ({ pageId: p.id, subPageId: p.defaultSubPageId as string })),
    [visiblePages]
  );
  const rowsBySubPage = useMultiSubPageRows(activeWorkspaceId, defaultSubPagePairs);

  const clientRows = clientsPage ? rowsByPage[clientsPage.id] ?? [] : [];
  const statusOptions = activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS;

  const deskProgress = useMemo(
    () =>
      visiblePages.map((page) =>
        progressForPage(page, subPagesByPage, rowsBySubPage, rowsByPage, statusOptions)
      ),
    [visiblePages, subPagesByPage, rowsBySubPage, rowsByPage, statusOptions]
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
        /* best-effort — a leaderboard hiccup should never break the dashboard itself */
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myProgress, activeWorkspaceId, profile?.uid]);

  const leaderboardEntries = useLeaderboard(activeWorkspaceId);

  const clientAmountColumn = clientsPage?.columns.find((c) => c.type === "currency");

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

  const { entries: historyEntries } = useHistoryLog(permissions.canViewHistory ? activeWorkspaceId : null);

  const attentionItems = useMemo(() => {
    const items: { label: string; detail: string; href: string }[] = [];
    const source = isPersonalLanding ? myProgress : deskProgress;
    source.forEach((p) => {
      const unfinished = (p.grandTotal > 0 && p.percent < 100) || p.openCount > 0;
      if (!unfinished) return;
      const member = members.find((m) => m.uid === p.page.responsibleUserId);
      const who = personLabel(member);
      const remaining = p.grandTotal - p.doneTotal;
      const detail =
        p.grandTotal > 0 && p.percent < 100
          ? `${p.percent}% готово · в деле ещё ${formatCurrency(remaining)}`
          : p.openCount > 0
            ? `${p.openCount} записей ещё в деле`
            : "дело не закрыто";
      items.push({
        label: isPersonalLanding ? p.page.name : who ? `${who} · ${p.page.name}` : p.page.name,
        detail,
        href: `/page/${p.page.id}`,
      });
    });
    return items.slice(0, 6);
  }, [deskProgress, myProgress, isPersonalLanding, members]);

  const deskRef = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const nodes = deskRef.current?.querySelectorAll(".desk-row, .desk-attention, .desk-home");
      if (!nodes?.length) return;
      gsap.fromTo(nodes, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.32, stagger: 0.05, ease: deskEase });
    },
    { scope: deskRef, dependencies: [isLoadingWorkspaceData] }
  );

  if (isLoadingWorkspaceData) {
    return (
      <div className="p-6">
        <Skeleton className="mb-6 h-8 w-64" />
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
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
        <p className="eyebrow mb-2 text-primary">
          {isPersonalLanding ? `Это твоё дело · ${dateLine}` : `Проверка столов · ${dateLine}`}
        </p>
        <h1 className="display text-[1.9rem] leading-[1.15] sm:text-[2.15rem]">
          {name ? (isPersonalLanding ? `Привет, ${name}` : `Добрый день, ${name}`) : isPersonalLanding ? "Привет" : "Добрый день"}
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
          {isPersonalLanding
            ? "Открой свой лист, поставь цель и смотри, как идёт дело — рядом с другими людьми на своих столах."
            : "У каждого листа свой человек. Ты заходишь посмотреть, как идёт дело."}
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

  const leaderboard = (
    <LeaderboardWidget
      entries={leaderboardEntries}
      members={members}
      myUid={profile?.uid}
      featured={isPersonalLanding}
    />
  );

  if (isPersonalLanding) {
    return (
      <div ref={deskRef} className="mx-auto max-w-5xl p-4 sm:p-6 lg:p-8">
        {greeting}
        {myProgress.length === 0 ? (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
            <div className="desk-cluster desk-home px-8 py-14 text-center lg:col-span-3">
              <p className="eyebrow mb-3 text-primary">Стол</p>
              <p className="display text-[1.4rem]">Пока нет своего листа</p>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                Когда появится — откроешь его здесь и поведёшь своё дело. Пока просто подожди.
              </p>
            </div>
            <div className="desk-home lg:col-span-2">{leaderboard}</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
            <div className="flex flex-col gap-4 lg:col-span-3">
              {myProgress.map((p) => (
                <div key={p.page.id} className="desk-home">
                  <MyProgressCard {...p} workspaceId={activeWorkspaceId ?? ""} large />
                </div>
              ))}
              {attentionItems.length > 0 && (
                <div className="desk-cluster desk-attention p-5">
                  <p className="eyebrow mb-3 text-primary">Ещё в деле</p>
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
            </div>
            <div className="desk-home lg:col-span-2">{leaderboard}</div>
          </div>
        )}
      </div>
    );
  }

  const showCharts = revenueByMonth.length > 0 || statusDistribution.some((d) => d.value > 0);

  return (
    <div ref={deskRef} className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
      {greeting}

      <div className="desk-cluster mb-6">
        <div className="flex items-baseline justify-between gap-3 px-5 py-4">
          <div>
            <p className="eyebrow text-primary">Столы</p>
            <p className="mt-1 text-sm text-muted-foreground">Лист и человек, который ведёт на нём своё дело.</p>
          </div>
          <span className="font-mono text-[11px] tabular text-muted-foreground">{deskProgress.length}</span>
        </div>
        {deskProgress.length === 0 ? (
          <p className="border-t border-border/60 px-5 py-8 text-sm text-muted-foreground">Пока нет листов.</p>
        ) : (
          <div>
            {deskProgress.map((desk) => {
              const member = members.find((m) => m.uid === desk.page.responsibleUserId);
              const who = personLabel(member);
              const empty = !desk.page.responsibleUserId || !member;
              return (
                <div key={desk.page.id} className="desk-row">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    {empty ? (
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-[10px] text-muted-foreground">
                        —
                      </div>
                    ) : (
                      <MemberAvatar
                        id={member.uid}
                        name={member.name}
                        nickname={member.nickname}
                        photoURL={member.photoURL}
                        className="h-9 w-9 shrink-0"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{empty ? "пока без человека" : who}</p>
                      <Link to={`/page/${desk.page.id}`} className="truncate text-[13px] text-muted-foreground hover:text-primary">
                        {desk.page.name}
                      </Link>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-end gap-5 sm:gap-7">
                    <div className="text-right">
                      <p className="eyebrow">Готово</p>
                      <p className="font-mono text-sm tabular text-success">{formatCurrency(desk.doneTotal)}</p>
                    </div>
                    <div className="text-right">
                      <p className="eyebrow">Общий</p>
                      <p className="font-mono text-sm tabular">{formatCurrency(desk.grandTotal)}</p>
                    </div>
                    <div className="w-12 text-right">
                      <p className="eyebrow">%</p>
                      <p className="font-mono text-sm tabular">{desk.percent}</p>
                    </div>
                    <p className="hidden w-36 text-right text-[11px] text-muted-foreground sm:block">
                      {member?.lastActiveAt ? `заходил ${timeAgo(member.lastActiveAt)}` : " "}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mb-6 grid grid-cols-1 gap-5 lg:grid-cols-5">
        <div className="desk-cluster desk-attention p-5 lg:col-span-3">
          <p className="eyebrow mb-3 text-primary">Ещё в деле</p>
          {attentionItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">Все столы закрыли своё дело — спокойно.</p>
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
        <div className="lg:col-span-2">{leaderboard}</div>
      </div>

      {showCharts && (
        <div className="mb-8 opacity-80">
          <p className="eyebrow mb-3 text-muted-foreground">Цифры с листа — не главное</p>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <RevenueChart data={revenueByMonth} />
            </div>
            <StatusChart title="Статусы" data={statusDistribution} />
          </div>
        </div>
      )}

      {permissions.canViewHistory && (
        <div>
          <p className="eyebrow mb-3 text-muted-foreground">Что менялось</p>
          <RecentActivity entries={historyEntries} />
        </div>
      )}
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
        <Button variant="outline" size="icon" title="Откуда брать цифры с листа">
          <Settings2 className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <p className="mb-3 text-sm font-medium">Цифры с листа</p>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Доход / статусы</Label>
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
            <Label className="text-xs text-muted-foreground">Второй лист</Label>
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
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow mb-1 text-primary">Мой стол</p>
            <Link
              to={`/page/${page.id}`}
              className={large ? "truncate text-lg font-medium hover:text-primary" : "truncate text-sm font-medium hover:text-primary"}
            >
              {page.name}
            </Link>
            <p className="mt-0.5 text-xs text-muted-foreground">{rowCount} записей</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" title="Скачать мой отчёт (CSV)" onClick={handleExport}>
              <Download className="h-3.5 w-3.5" />
            </Button>
            {large && (
              <Button asChild size="sm" className="h-8">
                <Link to={`/page/${page.id}`}>
                  Открыть лист <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            )}
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
        <p className="mt-1.5 text-right text-xs font-medium text-muted-foreground">{Math.round(animatedPercent)}% готово</p>

        <div className="mt-4 rounded-md border border-border/70 bg-muted/30 p-3">
          <p className="eyebrow mb-2 text-primary">Моя цель</p>
          {editingGoal ? (
            <div className="flex items-center gap-2">
              <Input
                autoFocus
                type="number"
                value={goalInput}
                onChange={(e) => setGoalInput(e.target.value)}
                placeholder="Например, 200000"
                className="h-9"
                onKeyDown={(e) => e.code === "Enter" && saveGoal()}
              />
              <Button size="sm" className="h-9" onClick={saveGoal}>
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
                  <span className="text-sm">
                    <span className="text-muted-foreground">На месяц: </span>
                    <span className="font-medium">{formatCurrency(goal)}</span>
                  </span>
                  <span className="flex items-center gap-1 text-xs font-medium text-primary">
                    {goalPercent}% <Pencil className="h-3 w-3" />
                  </span>
                </>
              ) : (
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
                  <Pencil className="h-3.5 w-3.5" /> Поставить свою цель на месяц
                </span>
              )}
            </button>
          )}
          {goal > 0 && !editingGoal && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
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
  featured,
}: {
  entries: LeaderboardEntry[];
  members: {
    uid: string;
    name?: string;
    nickname?: string;
    photoURL?: string | null;
    lastActiveAt?: number;
    status: string;
    role: string;
  }[];
  myUid?: string;
  featured?: boolean;
}) {
  // Ranked by total sum «Готово» (not %). A small list fully done shouldn't
  // outrank someone who closed more in absolute terms. Every active person
  // appears, even at 0 with no list yet. Several lists for one person sum
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
    <Card className={featured ? "h-full border-border/70 bg-card/70" : "border-border/70 bg-card/70"}>
      <CardContent className={featured ? "p-5 sm:p-6" : "p-4"}>
        <p className="eyebrow mb-1 text-primary">Как ведут дело</p>
        <p className={cn(featured ? "mb-4 text-base font-medium" : "mb-3 text-sm font-medium")}>рейтинг по сумме «Готово»</p>
        {ranked.length === 0 ? (
          <p className="text-xs text-muted-foreground">Пока никого нет на столах.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {ranked.map(({ member, doneTotal, pageNames }, i) => {
              const mine = member.uid === myUid;
              return (
                <div
                  key={member.uid}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2 py-2",
                    mine && "bg-primary/10 ring-1 ring-primary/40"
                  )}
                >
                  <span className="w-5 shrink-0 text-center font-mono text-[11px] tabular text-muted-foreground">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <MemberAvatar
                    id={member.uid}
                    name={member.name}
                    nickname={member.nickname}
                    photoURL={member.photoURL}
                    className={cn("h-8 w-8 shrink-0", mine && "ring-2 ring-primary")}
                  />
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-sm font-medium", mine && "text-primary")}>
                      {personLabel(member) || "—"}
                      {mine ? " · ты" : ""}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {pageNames.length > 0 ? pageNames.join(", ") : "нет листа"}
                      {member.lastActiveAt ? ` · заходил ${timeAgo(member.lastActiveAt)}` : ""}
                    </p>
                  </div>
                  <span className={cn("shrink-0 font-mono tabular", featured ? "text-base" : "text-sm", mine ? "text-primary" : "text-foreground")}>
                    {formatCurrency(doneTotal)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
