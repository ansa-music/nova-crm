import { useMemo } from "react";
import { motion } from "framer-motion";
import { Briefcase, Users, UserCog, Wallet } from "lucide-react";
import { StatCard } from "@/components/dashboard/StatCard";
import { RevenueChart } from "@/components/dashboard/RevenueChart";
import { StatusChart } from "@/components/dashboard/StatusChart";
import { RecentActivity } from "@/components/dashboard/RecentActivity";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useMultiPageRows } from "@/hooks/useMultiPageRows";
import { useHistoryLog } from "@/hooks/useHistoryLog";
import { usePermissions } from "@/hooks/usePermissions";
import { formatCurrency } from "@/utils/format";
import { formatDate } from "@/utils/date";

export default function DashboardPage() {
  const { activeWorkspace, activeWorkspaceId, pages, members, isLoadingWorkspaceData } = useWorkspace();
  const permissions = usePermissions();

  // Only aggregate stats from pages the current viewer can actually open —
  // Owner sees everything, everyone else only their allowed pages. Without
  // this filter, a regular member's Dashboard would leak revenue/client
  // counts pulled from pages they have no access to.
  const visiblePages = useMemo(
    () => pages.filter((p) => permissions.canAccessPage(p)),
    [pages, permissions]
  );

  const clientsPage = visiblePages.find((p) => p.name.toLowerCase().includes("клиент"));
  const projectsPage = visiblePages.find((p) => p.name.toLowerCase().includes("проект"));

  const rowsByPage = useMultiPageRows(
    activeWorkspaceId,
    [clientsPage?.id, projectsPage?.id].filter((id): id is string => Boolean(id))
  );

  const clientRows = clientsPage ? rowsByPage[clientsPage.id] ?? [] : [];
  const projectRows = projectsPage ? rowsByPage[projectsPage.id] ?? [] : [];

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
    if (!statusColumn?.statusOptions) return [];
    return statusColumn.statusOptions.map((opt) => ({
      name: opt.label,
      value: clientRows.filter((r) => r.cells.status === opt.value).length,
      color: opt.color,
    }));
  }, [statusColumn, clientRows]);

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
    <div className="mx-auto max-w-7xl p-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          С возвращением{activeWorkspace ? `, ${activeWorkspace.name}` : ""} 👋
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Обзор ключевых показателей workspace на {formatDate(Date.now(), "d MMMM")}
        </p>
      </motion.div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Клиенты" value={String(clientRows.length)} icon={Users} color="243 75% 59%" delay={0} />
        <StatCard label="Доход" value={formatCurrency(totalRevenue)} icon={Wallet} color="152 60% 40%" delay={0.05} />
        <StatCard label="Проекты" value={String(projectRows.length)} icon={Briefcase} color="271 81% 56%" delay={0.1} />
        <StatCard label="Сотрудники" value={String(activeEmployeesCount)} icon={UserCog} color="199 89% 48%" delay={0.15} />
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
