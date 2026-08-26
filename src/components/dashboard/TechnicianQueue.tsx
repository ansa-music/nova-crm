import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Check, ClipboardList, X } from "lucide-react";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { StatusBadge } from "@/components/table/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useViewRequests } from "@/hooks/useViewRequests";
import { useWorkspace } from "@/hooks/useWorkspace";
import { formatOrderDate, timeAgo } from "@/utils/date";
import { displayNameOf } from "@/utils/displayName";
import { formatCurrency } from "@/utils/format";
import { isResponsibleForPage } from "@/utils/permissions";
import { collectTodayOrderRows, type RecentRowItem } from "@/utils/recentRows";
import type { PageProgress } from "@/utils/deskProgress";
import type { StatusOption, ViewRequest, WorkspaceMember } from "@/types";

/** Technician (effective role manager / Технар) queue. Owner has WaitingForYou — not duplicated here. Viewer: hidden. */
export function TechnicianQueue({
  desks,
  statusOptions,
  members,
}: {
  desks: PageProgress[];
  statusOptions: StatusOption[];
  members: WorkspaceMember[];
}) {
  const { profile } = useAuth();
  const permissions = usePermissions();
  const { activeWorkspaceId, pages } = useWorkspace();
  // App shell already subscribed (NotificationBell / useOpenApprovedDesk). Shared hook — no extra onSnapshot.
  const { requests, resolveRequest } = useViewRequests(activeWorkspaceId, profile?.uid ?? null);
  const navigate = useNavigate();
  const [busyId, setBusyId] = useState<string | null>(null);

  const uid = profile?.uid ?? "";
  const isTechnician = permissions.isResolved && permissions.role === "manager";

  const todayRows = useMemo(
    () => (uid && isTechnician ? collectTodayOrderRows(desks, statusOptions, members, uid) : []),
    [desks, statusOptions, members, uid, isTechnician]
  );

  const pendingRequests = useMemo(() => {
    if (!uid || !isTechnician) return [];
    const myPageIds = new Set<string>();
    for (const desk of desks) {
      if (isResponsibleForPage(desk.page, uid)) myPageIds.add(desk.page.id);
    }
    for (const page of pages) {
      if (isResponsibleForPage(page, uid)) myPageIds.add(page.id);
    }
    return requests
      .filter(
        (r) =>
          r.status === "pending" &&
          r.fromUid !== uid &&
          r.toUid === uid &&
          myPageIds.has(r.pageId)
      )
      .sort((a, b) => a.createdAt - b.createdAt);
  }, [requests, desks, pages, uid, isTechnician]);

  if (!isTechnician || !activeWorkspaceId) return null;
  if (pendingRequests.length === 0 && todayRows.length === 0) return null;

  async function handleResolve(request: ViewRequest, status: "approved" | "denied") {
    setBusyId(request.id);
    try {
      const page =
        pages.find((p) => p.id === request.pageId) ?? desks.find((d) => d.page.id === request.pageId)?.page;
      await resolveRequest(request, page, status, displayNameOf(profile));
      toast.success(status === "approved" ? "Доступ открыт" : "Запрос отклонён");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : status === "approved"
            ? "Не удалось принять"
            : "Не удалось отклонить"
      );
    } finally {
      setBusyId(null);
    }
  }

  const count = pendingRequests.length + todayRows.length;
  const myDeskPage =
    desks.find((d) => isResponsibleForPage(d.page, uid))?.page ??
    pages.find((pg) => isResponsibleForPage(pg, uid)) ??
    null;

  return (
    <Card className="mb-6">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-primary" />
            На сегодня
            <Badge variant="outline">{count}</Badge>
          </CardTitle>
          <CardDescription>
            Кто просит смотреть стол и заказы, которые пришли сегодня. Это не дедлайн.
          </CardDescription>
        </div>
        {myDeskPage ? (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() => navigate(`/page/${myDeskPage.id}`)}
          >
            Открыть стол
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {pendingRequests.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Просят смотреть</p>
            {pendingRequests.map((request) => (
              <div
                key={request.id}
                className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center"
              >
                <MemberAvatar id={request.fromUid} name={request.fromName} className="h-8 w-8" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{request.fromName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    хочет смотреть «{request.pageName}» · {timeAgo(request.createdAt)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 sm:shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-11 flex-1 gap-1.5 sm:flex-none"
                    disabled={busyId === request.id}
                    onClick={() => void handleResolve(request, "denied")}
                  >
                    <X className="h-3.5 w-3.5" /> Отклонить
                  </Button>
                  <Button
                    size="sm"
                    className="min-h-11 flex-1 gap-1.5 sm:flex-none"
                    disabled={busyId === request.id}
                    onClick={() => void handleResolve(request, "approved")}
                  >
                    <Check className="h-3.5 w-3.5" /> Принять
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {todayRows.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Пришло сегодня</p>
            {todayRows.map((row) => (
              <TodayOrderCard
                key={`${row.pageId}:${row.id}`}
                row={row}
                statusOptions={statusOptions}
                onOpen={() => navigate(`/page/${row.pageId}?row=${encodeURIComponent(row.id)}`)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TodayOrderCard({
  row,
  statusOptions,
  onOpen,
}: {
  row: RecentRowItem;
  statusOptions: StatusOption[];
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full flex-col gap-2 rounded-lg border border-border p-3 text-left hover:bg-primary/5"
      onClick={onOpen}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{row.title}</p>
          <p className="truncate text-[11px] text-muted-foreground">{row.pageName}</p>
        </div>
        <StatusBadge value={row.statusValue} options={statusOptions} />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="tabular-nums text-foreground">{formatCurrency(row.price)}</span>
        <span>{row.dateMs ? `пришёл ${formatOrderDate(row.dateMs)}` : "дата не указана"}</span>
      </div>
    </button>
  );
}
