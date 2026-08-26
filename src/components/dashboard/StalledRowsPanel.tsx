import { useMemo } from "react";
import { useNavigate } from "react-router";
import { Hourglass } from "lucide-react";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { StatusBadge } from "@/components/table/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { formatOrderDate, timeAgo } from "@/utils/date";
import { formatCurrency } from "@/utils/format";
import { isResponsibleForPage } from "@/utils/permissions";
import { collectStalledRows, type RecentRowItem } from "@/utils/recentRows";
import type { PageProgress } from "@/utils/deskProgress";
import type { StatusOption, WorkspaceMember } from "@/types";

/** Owner: desks they already see (chartSource). Technician: own desk only. Viewer: hidden. */
export function StalledRowsPanel({
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
  const navigate = useNavigate();
  const uid = profile?.uid ?? "";
  const isTechnician = permissions.isResolved && permissions.role === "manager";
  const isOwner = permissions.isResolved && permissions.role === "owner";

  const scopedDesks = useMemo(() => {
    if (isTechnician && uid) return desks.filter((d) => isResponsibleForPage(d.page, uid));
    if (isOwner) return desks;
    return [];
  }, [desks, isTechnician, isOwner, uid]);

  const items = useMemo(
    () => collectStalledRows(scopedDesks, statusOptions, members),
    [scopedDesks, statusOptions, members]
  );

  if (!isTechnician && !isOwner) return null;
  if (items.length === 0) return null;

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Hourglass className="h-4 w-4 text-primary" />
          Застопорилось
          <Badge variant="outline">{items.length}</Badge>
        </CardTitle>
        <CardDescription>
          Не «Готово» и без обновлений больше трёх дней. Смотрим правку строки, не дату заказа.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="flex flex-col gap-2 px-4 pb-4 md:hidden">
          {items.map((row) => (
            <StalledRowCard
              key={`${row.pageId}:${row.id}`}
              row={row}
              members={members}
              statusOptions={statusOptions}
              onOpen={() => navigate(`/page/${row.pageId}`)}
            />
          ))}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 font-medium">Название</th>
                <th className="px-3 py-2 font-medium">Ответственный</th>
                <th className="px-3 py-2 font-medium">Статус</th>
                <th className="px-3 py-2 font-medium">Цена</th>
                <th className="px-4 py-2 font-medium">Обновлено</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                const member = members.find((m) => m.uid === row.responsibleUid);
                return (
                  <tr
                    key={`${row.pageId}:${row.id}`}
                    className="cursor-pointer border-t border-border/70 hover:bg-primary/5"
                    onClick={() => navigate(`/page/${row.pageId}`)}
                  >
                    <td className="px-4 py-2.5">
                      <p className="truncate font-medium">{row.title}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{row.pageName}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-2">
                        {member ? (
                          <MemberAvatar
                            id={member.uid}
                            name={member.name}
                            nickname={member.nickname}
                            photoURL={member.photoURL}
                            className="h-6 w-6"
                          />
                        ) : null}
                        <span className="truncate text-xs">{row.responsibleLabel}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge value={row.statusValue} options={statusOptions} />
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">{formatCurrency(row.price)}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {row.updatedAt ? timeAgo(row.updatedAt) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function StalledRowCard({
  row,
  members,
  statusOptions,
  onOpen,
}: {
  row: RecentRowItem;
  members: WorkspaceMember[];
  statusOptions: StatusOption[];
  onOpen: () => void;
}) {
  const member = members.find((m) => m.uid === row.responsibleUid);
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
      <div className="flex items-center gap-2">
        {member ? (
          <MemberAvatar
            id={member.uid}
            name={member.name}
            nickname={member.nickname}
            photoURL={member.photoURL}
            className="h-6 w-6"
          />
        ) : null}
        <span className="truncate text-xs text-muted-foreground">{row.responsibleLabel}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="tabular-nums text-foreground">{formatCurrency(row.price)}</span>
        {row.dateMs ? <span>пришёл {formatOrderDate(row.dateMs)}</span> : null}
        <span>{row.updatedAt ? timeAgo(row.updatedAt) : "—"}</span>
      </div>
    </button>
  );
}
