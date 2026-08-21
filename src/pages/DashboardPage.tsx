import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowUpRight, Briefcase, CalendarDays, ClipboardCheck, Settings2, Users, UserCog, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatCard } from "@/components/dashboard/StatCard";
import { RevenueChart } from "@/components/dashboard/RevenueChart";
import { StatusChart } from "@/components/dashboard/StatusChart";
import { RecentActivity } from "@/components/dashboard/RecentActivity";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useMultiPageRows } from "@/hooks/useMultiPageRows";
import { useHistoryLog } from "@/hooks/useHistoryLog";
import { usePermissions } from "@/hooks/usePermissions";
import { isResponsibleForPage } from "@/utils/permissions";
import { DEFAULT_STATUS_OPTIONS } from "@/utils/columnOptions";
import { updateDashboardPages } from "@/services/workspaceService";
import { formatCurrency } from "@/utils/format";
import { formatDate } from "@/utils/date";
import { useAnimatedNumber } from "@/hooks/useAnimatedNumber";
import { Link } from "react-router";

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

  const rowsByPage = useMultiPageRows(
    activeWorkspaceId,
    [clientsPage?.id, projectsPage?.id, ...myResponsiblePages.map((p) => p.id)].filter(
      (id): id is string => Boolean(id)
    )
  );

  const clientRows = clientsPage ? rowsByPage[clientsPage.id] ?? [] : [];
  const projectRows = projectsPage ? rowsByPage[projectsPage.id] ?? [] : [];

  const statusOptions = activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS;

  // Per-page "Готово" vs "Общий" breakdown for whatever pages I personally
  // own as Ответственный — mirrors the same currency+status total logic the
  // table itself uses (src/components/table/DataTable.tsx financialSummary),
  // just recomputed per page here so each card is self-contained.
  const myProgress = useMemo(() => {
    return myResponsiblePages.map((page) => {
      const priceCol = page.columns.find((c) => c.type === "currency");
      const statusCol = page.columns.find((c) => c.type === "status");
      const rows = rowsByPage[page.id] ?? [];
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
      return { page, doneTotal, grandTotal, percent, rowCount: rows.length };
    });
  }, [myResponsiblePages, rowsByPage, statusOptions]);

  const totalRevenue = useMemo(
    () => clientRows.reduce((sum, row) => sum + (Number(row.cells.amount) || 0), 0),
    [clientRows]
  );

  const activeEmployeesCount = members.filter((m) => m.status === "active").length;

  const revenueByMonth = useMemo(() => {
    const buckets = new Map<string, number>();
    clientRows.forEach((row) => {
      const label = formatDate(row.createdAt, "LLL yyyy");
      buckets.set(label, (buckets.get(label) ?? 0) + (Number(row.cells.amount) || 0));
    });
    return Array.from(buckets.entries()).map(([label, value]) => ({ label, value }));
  }, [clientRows]);

  const statusColumn = clientsPage?.columns.find((c) => c.key === "status");
  const statusDistribution = useMemo(() => {
    if (!statusColumn) return [];
    return statusOptions.map((opt) => ({
      name: opt.label,
      value: clientRows.filter((r) => r.cells.status === opt.value).length,
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

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow mb-2 text-primary">Рабочее пространство</p>
          <h1 className="text-3xl font-light tracking-tight sm:text-[2rem]">
            С возвращением{activeWorkspace ? `, ${activeWorkspace.name}` : ""} <span aria-hidden="true">👋</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Сводка по команде и продажам на {formatDate(Date.now(), "d MMMM")}
          </p>
        </div>
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
      </motion.div>

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
            {myProgress.map(({ page, doneTotal, grandTotal, percent, rowCount }) => (
              <MyProgressCard
                key={page.id}
                pageId={page.id}
                pageName={page.name}
                doneTotal={doneTotal}
                grandTotal={grandTotal}
                percent={percent}
                rowCount={rowCount}
              />
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
        <StatusChart title="Статусы клиентов" data={statusDistribution} />
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
  pageId,
  pageName,
  doneTotal,
  grandTotal,
  percent,
  rowCount,
}: {
  pageId: string;
  pageName: string;
  doneTotal: number;
  grandTotal: number;
  percent: number;
  rowCount: number;
}) {
  const animatedDone = useAnimatedNumber(doneTotal);
  const animatedTotal = useAnimatedNumber(grandTotal);
  const animatedPercent = useAnimatedNumber(percent);

  return (
    <Card className="overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card">
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <Link to={`/page/${pageId}`} className="truncate text-sm font-medium hover:text-primary">
            {pageName}
          </Link>
          <span className="shrink-0 text-xs text-muted-foreground">{rowCount} строк</span>
        </div>
        <div className="mb-2 flex items-end justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Готово</p>
            <p className="text-xl font-light tabular-nums text-success">{formatCurrency(animatedDone)}</p>
          </div>
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Общий</p>
            <p className="text-xl font-light tabular-nums">{formatCurrency(animatedTotal)}</p>
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
      </CardContent>
    </Card>
  );
}
