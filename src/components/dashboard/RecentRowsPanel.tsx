import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { StatusBadge } from "@/components/table/StatusBadge";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/cn";
import { formatCurrency } from "@/utils/format";
import { formatDate, timeAgo } from "@/utils/date";
import { collectRecentRows, matchesRecentStatusFilter } from "@/utils/recentRows";
import type { PageProgress } from "@/utils/deskProgress";
import type { StatusOption, WorkspaceMember } from "@/types";

export function RecentRowsPanel({
  desks,
  statusOptions,
  members,
}: {
  desks: PageProgress[];
  statusOptions: StatusOption[];
  members: WorkspaceMember[];
}) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<string | null>(null);
  const items = useMemo(() => collectRecentRows(desks, statusOptions, members), [desks, statusOptions, members]);
  const visible = items.filter((row) => matchesRecentStatusFilter(row, filter));

  if (items.length === 0) return null;

  const pills: { value: string | null; label: string }[] = [
    { value: null, label: "Все" },
    ...statusOptions.slice(0, 6).map((o) => ({ value: o.value, label: o.label })),
  ];

  return (
    <section className="mb-6 rounded-2xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <p className="mr-auto text-sm font-medium">Последние строки</p>
        <div className="flex flex-wrap gap-1.5">
          {pills.map((pill) => (
            <Button
              key={pill.label}
              type="button"
              size="sm"
              variant="ghost"
              className={cn(
                "h-7 rounded-full px-3 text-[11px]",
                filter === pill.value && "bg-primary/15 text-primary hover:bg-primary/20"
              )}
              onClick={() => setFilter(pill.value)}
            >
              {pill.label}
            </Button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium">Название</th>
              <th className="px-3 py-2 font-medium">Ответственный</th>
              <th className="px-3 py-2 font-medium">Статус</th>
              <th className="px-3 py-2 font-medium">Цена</th>
              <th className="px-3 py-2 font-medium">Дата</th>
              <th className="px-4 py-2 font-medium">Обновлено</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
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
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">
                    {row.dateMs ? formatDate(row.dateMs, "d MMM") : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {row.updatedAt ? timeAgo(row.updatedAt) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
