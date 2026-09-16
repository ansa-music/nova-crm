import { useEffect, useMemo, useRef, useState } from "react";
import { HardHat, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { EmptyState } from "@/components/common/EmptyState";
import { TechLoadStatusDialog } from "@/components/technicians/TechLoadStatusDialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentMonthKey } from "@/hooks/useCurrentMonthKey";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { refreshDeskLoadFromRows, subscribeDeskLoads } from "@/services/deskLoadService";
import { currentMonthSubPageId } from "@/services/monthTabService";
import { monthTabNameForKey } from "@/services/subPageService";
import { DEFAULT_STATUS_OPTIONS } from "@/utils/columnOptions";
import { timeAgo } from "@/utils/date";
import { canSeeTechnicians } from "@/utils/permissions";
import { personLabel } from "@/utils/peopleDesks";
import { addTechLoad, EMPTY_TECH_LOAD, summarizeDeskLoad, type TechLoadSummary } from "@/utils/techLoad";
import { cn } from "@/utils/cn";
import type { DeskLoad, WorkspaceMember, WorkspacePage } from "@/types";

type Filter = "all" | "free" | "busy";

interface TechnicianRow {
  member: WorkspaceMember;
  desks: WorkspacePage[];
  summary: TechLoadSummary;
  busy: boolean;
  /** Newest count among this person's desks; 0 when nothing was counted this month yet. */
  updatedAt: number;
}

// Owner-only background recount, at most this often per workspace per page load.
const REFRESH_EVERY_MS = 5 * 60 * 1000;
const lastRefreshAt = new Map<string, number>();

function ordersWord(n: number) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "заказ";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "заказа";
  return "заказов";
}

function Pill({ tone, children }: { tone: "free" | "busy" | "rework" | "freeze"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4",
        tone === "free" && "border-success/45 bg-success/12 text-success",
        tone === "busy" && "border-destructive/45 bg-destructive/12 text-destructive",
        tone === "rework" && "border-warning/45 bg-warning/12 text-warning",
        tone === "freeze" && "border-cyan-400/45 bg-cyan-400/12 text-cyan-300"
      )}
    >
      {children}
    </span>
  );
}

/**
 * «Технари» — who of the Технари is free right now, from this month's
 * orders only. Reads the DeskLoad aggregates, never anyone's rows, so it
 * works for an ОС who can't open a single desk.
 */
export default function TechniciansPage() {
  const { activeWorkspace, activeWorkspaceId, members, pages } = useWorkspace();
  const permissions = usePermissions();
  const { profile } = useAuth();
  const monthKey = useCurrentMonthKey();
  const [loads, setLoads] = useState<DeskLoad[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);

  const canSee = permissions.isResolved && canSeeTechnicians(permissions.role);
  const isOwner = permissions.isWorkspaceOwner || permissions.realRole === "owner";
  const uid = profile?.uid ?? "";

  useEffect(() => {
    setLoads(null);
    setLoadFailed(false);
    if (!activeWorkspaceId || !canSee) return;
    return subscribeDeskLoads(
      activeWorkspaceId,
      (next) => {
        setLoads(next);
        setLoadFailed(false);
      },
      // A denied read is "unknown", not "everyone is free" — never show
      // an empty list as if it were real data.
      () => setLoadFailed(true)
    );
  }, [activeWorkspaceId, canSee]);

  const loadsRef = useRef<DeskLoad[] | null>(null);
  loadsRef.current = loads;
  const loadsReady = loads !== null;

  // Owner can read every desk: recount the month tabs directly so desks
  // nobody opened lately still show the truth. Everyone else relies on the
  // counts each desk publishes while its Технар works in it.
  useEffect(() => {
    if (!isOwner || !activeWorkspaceId || !uid || !loadsReady) return;
    const last = lastRefreshAt.get(activeWorkspaceId) ?? 0;
    if (Date.now() - last < REFRESH_EVERY_MS) return;
    lastRefreshAt.set(activeWorkspaceId, Date.now());
    const technicianUids = new Set(members.filter((m) => m.role === "manager").map((m) => m.uid));
    const desks = pages.filter(
      (p) => p.responsibleUserId && technicianUids.has(p.responsibleUserId) && currentMonthSubPageId(p, monthKey)
    );
    void (async () => {
      for (let i = 0; i < desks.length; i += 3) {
        await Promise.all(
          desks.slice(i, i + 3).map((desk) =>
            refreshDeskLoadFromRows(
              desk,
              monthKey,
              uid,
              loadsRef.current?.find((l) => l.pageId === desk.id)
            ).catch((error) => console.warn(`Не удалось пересчитать стол ${desk.id}:`, error))
          )
        );
      }
    })();
  }, [isOwner, activeWorkspaceId, uid, loadsReady, members, pages, monthKey]);

  const statusOptions = activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS;
  const kinds = activeWorkspace?.techLoadStatusKinds;

  const technicians = useMemo<TechnicianRow[]>(() => {
    const loadByPage = new Map((loads ?? []).map((l) => [l.pageId, l]));
    return members
      .filter((m) => m.status === "active" && m.role === "manager")
      .map((member) => {
        const desks = pages
          .filter((p) => p.responsibleUserId === member.uid && !p.isDashboard)
          .sort((a, b) => a.order - b.order);
        let summary = EMPTY_TECH_LOAD;
        let updatedAt = 0;
        for (const desk of desks) {
          const subPageId = currentMonthSubPageId(desk, monthKey);
          const load = loadByPage.get(desk.id);
          // No month tab yet, or counts from another month/tab: nothing
          // counted for this month on this desk.
          if (!subPageId || !load || load.monthKey !== monthKey || load.subPageId !== subPageId) continue;
          summary = addTechLoad(summary, summarizeDeskLoad(load, statusOptions, kinds));
          updatedAt = Math.max(updatedAt, load.updatedAt ?? 0);
        }
        return { member, desks, summary, busy: summary.busy > 0, updatedAt };
      })
      // Whoever can take an order soonest comes first: free, free with a
      // rework pending, busy (fewest in work first), and people without a
      // desk last — they can't take orders at all yet.
      .sort((a, b) => {
        const rank = (t: TechnicianRow) => (t.desks.length === 0 ? 3 : t.busy ? 2 : t.summary.rework > 0 ? 1 : 0);
        return (
          rank(a) - rank(b) ||
          a.summary.busy - b.summary.busy ||
          a.summary.total - b.summary.total ||
          personLabel(a.member).localeCompare(personLabel(b.member), "ru")
        );
      });
  }, [loads, members, pages, monthKey, statusOptions, kinds]);

  const freeCount = technicians.filter((t) => !t.busy).length;
  const busyCount = technicians.length - freeCount;
  const visible = technicians.filter((t) => filter === "all" || (filter === "busy" ? t.busy : !t.busy));

  if (!permissions.isResolved) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-2.5 p-5">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-16 rounded-xl" />
      </div>
    );
  }

  if (!canSee) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <ShieldCheck className="h-8 w-8 text-muted-foreground" />
        <p className="text-lg font-semibold">Доступ ограничен</p>
        <p className="text-sm text-muted-foreground">Эта страница недоступна в режиме просмотра.</p>
      </div>
    );
  }

  const filters: { id: Filter; label: string; count: number; active: string }[] = [
    { id: "all", label: "Все", count: technicians.length, active: "border-primary/50 bg-primary/15 text-primary" },
    { id: "free", label: "Свободны", count: freeCount, active: "border-success/50 bg-success/15 text-success" },
    { id: "busy", label: "Заняты", count: busyCount, active: "border-destructive/50 bg-destructive/15 text-destructive" },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="page-header">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <HardHat className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h1 className="page-title">Технари</h1>
          <p className="text-[11px] text-muted-foreground">Заказы за {monthTabNameForKey(monthKey).toLowerCase()}</p>
        </div>
        <div className="flex-1" />
        {isOwner && activeWorkspaceId && (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setStatusDialogOpen(true)}>
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Статусы</span>
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-3 sm:px-6">
        {filters.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setFilter(item.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              filter === item.id
                ? item.active
                : "border-border bg-background/40 text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            {item.label}
            <span className="tabular-nums text-[10px] opacity-80">{item.count}</span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          {loadFailed && (
            <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Не удалось загрузить загрузку технарей. Обновите страницу.
            </p>
          )}

          {!loadFailed && loads === null && (
            <>
              <Skeleton className="h-[4.5rem] rounded-xl" />
              <Skeleton className="h-[4.5rem] rounded-xl" />
              <Skeleton className="h-[4.5rem] rounded-xl" />
            </>
          )}

          {loads !== null && technicians.length === 0 && (
            <EmptyState
              eyebrow="Технари"
              title="Пока нет технарей"
              description="Здесь появятся участники с ролью «Технар» и их заказы за текущий месяц."
            />
          )}

          {loads !== null && technicians.length > 0 && visible.length === 0 && (
            <p className="py-16 text-center text-sm text-muted-foreground">
              {filter === "busy" ? "Сейчас все свободны." : "Сейчас все заняты."}
            </p>
          )}

          {loads !== null &&
            visible.map(({ member, desks, summary, busy, updatedAt }) => {
              const mine = member.uid === uid;
              const details = [
                desks.length > 0 ? desks.map((d) => d.name).join(", ") : "стола нет",
                busy ? `в работе ${summary.busy}` : null,
                desks.length > 0 ? (updatedAt ? `обновлено ${timeAgo(updatedAt)}` : "в этом месяце ещё не открывал стол") : null,
              ].filter(Boolean);
              return (
                <div
                  key={member.uid}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border border-border/60 bg-card/60 px-3 py-3 sm:px-4",
                    mine && "ring-1 ring-primary/30"
                  )}
                >
                  <MemberAvatar
                    id={member.uid}
                    name={member.name}
                    nickname={member.nickname}
                    photoURL={member.photoURL}
                    className="h-9 w-9 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="min-w-0 truncate text-sm font-medium">
                        {personLabel(member) || member.email || "—"}
                        {mine ? " · ты" : ""}
                      </p>
                      {busy ? <Pill tone="busy">Занят</Pill> : <Pill tone="free">Свободен</Pill>}
                      {summary.rework > 0 && <Pill tone="rework">переделка {summary.rework}</Pill>}
                      {summary.freeze > 0 && <Pill tone="freeze">заморозка {summary.freeze}</Pill>}
                    </div>
                    <p className="mt-1 truncate text-[11px] text-muted-foreground">{details.join(" · ")}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono text-lg leading-none tabular-nums">{summary.total}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">{ordersWord(summary.total)}</p>
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {statusDialogOpen && activeWorkspaceId && (
        <TechLoadStatusDialog
          workspaceId={activeWorkspaceId}
          statusOptions={statusOptions}
          kinds={kinds}
          onClose={() => setStatusDialogOpen(false)}
        />
      )}
    </div>
  );
}
