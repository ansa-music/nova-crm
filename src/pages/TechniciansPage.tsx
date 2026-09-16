import { useEffect, useMemo, useRef, useState } from "react";
import { AtSign, HardHat, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";
import { TechLoadStatusDialog } from "@/components/technicians/TechLoadStatusDialog";
import {
  TechnicianCard,
  type TechnicianRater,
  type TechnicianRatingDetail,
} from "@/components/technicians/TechnicianCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentMonthKey } from "@/hooks/useCurrentMonthKey";
import { usePermissions } from "@/hooks/usePermissions";
import { refreshWorkspaceMembers, useWorkspace } from "@/hooks/useWorkspace";
import { refreshDeskLoadFromRows, subscribeDeskLoads } from "@/services/deskLoadService";
import { osNickLabel } from "@/services/memberService";
import { currentMonthSubPageId, isMonthlyDesk } from "@/services/monthTabService";
import { monthTabNameForKey } from "@/services/subPageService";
import { deleteTechRating, rateTechnician, subscribeTechRatings } from "@/services/techRatingService";
import { confirmDialog } from "@/utils/appDialog";
import { DEFAULT_STATUS_OPTIONS } from "@/utils/columnOptions";
import { personLabel } from "@/utils/peopleDesks";
import {
  addStatusCounts,
  addTechLoad,
  effectiveTechLoadKinds,
  EMPTY_TECH_LOAD,
  hasRecentOsOrder,
  statusBreakdown,
  summarizeDeskLoad,
  techLoadKindForOption,
  type StatusBreakdownItem,
  type TechLoadSummary,
} from "@/utils/techLoad";
import { cn } from "@/utils/cn";
import { memberHasRole, type DeskLoad, type StatusOption, type TechRating, type WorkspaceMember, type WorkspacePage } from "@/types";

type Filter = "all" | "free" | "busy" | "mine";

interface TechnicianRow {
  member: WorkspaceMember;
  desks: WorkspacePage[];
  summary: TechLoadSummary;
  breakdown: StatusBreakdownItem[];
  busy: boolean;
  /** Newest count among this person's desks; 0 when nothing was counted this month yet. */
  updatedAt: number;
  /** Viewer is an ОС with a nick: their orders at this Технар this month. */
  myOrders: { summary: TechLoadSummary; breakdown: StatusBreakdownItem[] } | null;
  ratings: TechRating[];
  /** A desk of this Технар with a recent order from the viewing ОС — proof for a first rating. */
  rateDeskId: string | null;
}

const NO_OPTIONS: StatusOption[] = [];

// Owner-only background recount: each desk's month tab at most this often
// per page load. Keyed by the tab, so a desk the month autopilot rolls over
// while this screen is open gets counted right away.
const REFRESH_EVERY_MS = 5 * 60 * 1000;
const lastRefreshAt = new Map<string, number>();

function ordersWord(n: number) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "заказ";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "заказа";
  return "заказов";
}

function isPermissionDenied(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "permission-denied";
}

/**
 * «Технари» — визитки Технарей: who is free right now, this month's orders
 * by status, ratings from ОС. Reads the DeskLoad aggregates, never anyone's
 * rows, so it works for an ОС who can't open a single desk.
 */
export default function TechniciansPage() {
  const { activeWorkspace, activeWorkspaceId, members, pages } = useWorkspace();
  const permissions = usePermissions();
  const { profile } = useAuth();
  const monthKey = useCurrentMonthKey();
  const [loads, setLoads] = useState<DeskLoad[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [ratings, setRatings] = useState<TechRating[] | null>(null);
  const [ratingsFailed, setRatingsFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const canSee = permissions.canSeeTechnicians;
  // Owner reads every desk and recounts them; the status mapping is a
  // workspace setting (Owner or Тимлид).
  const isOwner = permissions.hasFullDeskAccess;
  const canMapStatuses = permissions.canManageStatusVariants;
  // Ratings: Owner/Тимлид see who rated and may remove a rating (rules:
  // hasFullAccess by the REAL role, like canManageUsers); Admin only sees.
  const canModerateRatings = permissions.canManageUsers;
  const canSeeRatingDetails = canModerateRatings || permissions.role === "admin";
  const isOsViewer = permissions.hasRole("os");
  const uid = profile?.uid ?? "";

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // Other members' docs aren't live — refresh once so nicks, desks and
  // "last seen" are current when the screen opens.
  useEffect(() => {
    if (!activeWorkspaceId || !canSee) return;
    void refreshWorkspaceMembers(activeWorkspaceId).catch(() => undefined);
  }, [activeWorkspaceId, canSee]);

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

  useEffect(() => {
    setRatings(null);
    setRatingsFailed(false);
    if (!activeWorkspaceId || !canSee) return;
    return subscribeTechRatings(
      activeWorkspaceId,
      (next) => {
        setRatings(next);
        setRatingsFailed(false);
      },
      () => setRatingsFailed(true)
    );
  }, [activeWorkspaceId, canSee]);

  const responsibleOptions = activeWorkspace?.responsibleOptions ?? NO_OPTIONS;
  const statusOptions = activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS;
  const kinds = useMemo(() => effectiveTechLoadKinds(activeWorkspace), [activeWorkspace]);
  // The «Ждём оплату» tile only where some status actually means it.
  const showPayment = useMemo(
    () => statusOptions.some((o) => techLoadKindForOption(o, kinds) === "payment"),
    [statusOptions, kinds]
  );

  const loadsRef = useRef<DeskLoad[] | null>(null);
  loadsRef.current = loads;
  const loadsReady = loads !== null;
  const responsibleOptionsRef = useRef(responsibleOptions);
  responsibleOptionsRef.current = responsibleOptions;

  // Owner can read every desk: recount the month tabs directly so desks
  // nobody opened lately still show the truth. Everyone else relies on the
  // counts each desk publishes while its Технар works in it.
  useEffect(() => {
    if (!isOwner || !activeWorkspaceId || !uid || !loadsReady) return;
    const startedAt = Date.now();
    const desks = pages.filter((p) => {
      const subPageId = currentMonthSubPageId(p, monthKey);
      if (!subPageId || !isMonthlyDesk(p, members)) return false;
      const key = `${p.id}:${subPageId}`;
      if (startedAt - (lastRefreshAt.get(key) ?? 0) < REFRESH_EVERY_MS) return false;
      lastRefreshAt.set(key, startedAt);
      return true;
    });
    if (desks.length === 0) return;
    void (async () => {
      for (let i = 0; i < desks.length; i += 3) {
        await Promise.all(
          desks.slice(i, i + 3).map((desk) =>
            refreshDeskLoadFromRows(
              desk,
              monthKey,
              uid,
              loadsRef.current?.find((l) => l.pageId === desk.id),
              responsibleOptionsRef.current
            ).catch((error) => console.warn(`Не удалось пересчитать стол ${desk.id}:`, error))
          )
        );
      }
    })();
  }, [isOwner, activeWorkspaceId, uid, loadsReady, members, pages, monthKey]);

  const myMember = useMemo(() => members.find((m) => m.uid === uid) ?? null, [members, uid]);
  const myOsValue = isOsViewer ? myMember?.osNickValue ?? null : null;
  const myOsNick = isOsViewer ? osNickLabel(myMember, responsibleOptions) : null;

  const technicians = useMemo<TechnicianRow[]>(() => {
    const loadByPage = new Map((loads ?? []).map((l) => [l.pageId, l]));
    // Технари, plus anyone whose desk the Owner marked «Стол технаря».
    const flaggedOwners = new Set(pages.filter((p) => p.technicianDesk && p.responsibleUserId).map((p) => p.responsibleUserId));
    return members
      .filter((m) => m.status === "active" && (memberHasRole(m, "manager") || flaggedOwners.has(m.uid)))
      .map((member) => {
        const desks = pages
          .filter(
            (p) =>
              p.responsibleUserId === member.uid &&
              !p.isDashboard &&
              (memberHasRole(member, "manager") || Boolean(p.technicianDesk))
          )
          .sort((a, b) => a.order - b.order);
        let summary = EMPTY_TECH_LOAD;
        let updatedAt = 0;
        let myTotal = 0;
        let rateDeskId: string | null = null;
        const statusCounts: Record<string, number> = {};
        const myStatusCounts: Record<string, number> = {};
        for (const desk of desks) {
          const load = loadByPage.get(desk.id);
          if (!load) continue;
          // Rating proof may come from last month's counts too: the desk
          // keeps each ОС's last order day across the rollover.
          if (myOsValue && !rateDeskId && load.responsibleUserId === member.uid && hasRecentOsOrder(load, myOsValue, now)) {
            rateDeskId = desk.id;
          }
          const subPageId = currentMonthSubPageId(desk, monthKey);
          // No month tab yet, or counts from another month/tab: nothing
          // counted for this month on this desk.
          if (!subPageId || load.monthKey !== monthKey || load.subPageId !== subPageId) continue;
          summary = addTechLoad(summary, summarizeDeskLoad(load, statusOptions, kinds));
          addStatusCounts(statusCounts, load.statusCounts);
          if (myOsValue) {
            myTotal += load.osCounts?.[myOsValue] ?? 0;
            addStatusCounts(myStatusCounts, load.osStatusCounts?.[myOsValue]);
          }
          updatedAt = Math.max(updatedAt, load.updatedAt ?? 0);
        }
        return {
          member,
          desks,
          summary,
          breakdown: statusBreakdown(statusCounts, statusOptions, kinds),
          busy: summary.busy > 0,
          updatedAt,
          myOrders: myOsValue
            ? {
                summary: summarizeDeskLoad({ total: myTotal, statusCounts: myStatusCounts }, statusOptions, kinds),
                breakdown: statusBreakdown(myStatusCounts, statusOptions, kinds),
              }
            : null,
          ratings: (ratings ?? []).filter((r) => r.technicianUid === member.uid),
          rateDeskId,
        };
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
  }, [loads, ratings, members, pages, monthKey, statusOptions, kinds, myOsValue, now]);

  const withDesk = technicians.filter((t) => t.desks.length > 0);
  const freeCount = withDesk.filter((t) => !t.busy).length;
  const busyCount = withDesk.length - freeCount;
  const mineCount = technicians.filter((t) => (t.myOrders?.summary.total ?? 0) > 0).length;
  const myOrdersTotal = technicians.reduce((n, t) => n + (t.myOrders?.summary.total ?? 0), 0);
  const visible = technicians.filter((t) => {
    if (filter === "free") return t.desks.length > 0 && !t.busy;
    if (filter === "busy") return t.busy;
    if (filter === "mine") return (t.myOrders?.summary.total ?? 0) > 0;
    return true;
  });

  function raterFor(t: TechnicianRow): TechnicianRater | null {
    if (!isOsViewer || ratings === null || ratingsFailed || t.member.uid === uid) return null;
    const mine = t.ratings.find((r) => r.osUid === uid) ?? null;
    if (mine) return { state: "can-rate", nick: myOsNick ?? "", mine };
    if (!myOsValue || !myOsNick) return { state: "no-nick" };
    if (t.rateDeskId) return { state: "can-rate", nick: myOsNick, mine: null };
    return { state: "not-eligible", nick: myOsNick };
  }

  async function handleRate(t: TechnicianRow, stars: number) {
    if (!activeWorkspaceId) return;
    const mine = t.ratings.find((r) => r.osUid === uid) ?? null;
    const osValue = mine?.osValue ?? myOsValue;
    const pageId = mine?.pageId ?? t.rateDeskId;
    if (!osValue || !pageId) return;
    try {
      await rateTechnician({
        workspaceId: activeWorkspaceId,
        osUid: uid,
        technicianUid: t.member.uid,
        stars,
        osValue,
        pageId,
        existing: mine,
      });
      toast.success(mine ? "Оценка изменена" : "Оценка поставлена");
    } catch (error) {
      toast.error(
        isPermissionDenied(error)
          ? "Не получилось: у технаря нет недавнего заказа с вашим ником ОС"
          : "Не удалось сохранить оценку"
      );
    }
  }

  function raterLabel(rating: TechRating): string {
    const rater = members.find((m) => m.uid === rating.osUid);
    return (
      osNickLabel(rater, responsibleOptions) ??
      responsibleOptions.find((o) => o.value === rating.osValue)?.label ??
      (rater ? personLabel(rater) : null) ??
      "Бывший участник"
    );
  }

  function ratingDetailsFor(t: TechnicianRow): TechnicianRatingDetail[] | null {
    if (!canSeeRatingDetails) return null;
    return t.ratings
      .map((r) => ({ id: r.id, raterLabel: raterLabel(r), stars: r.stars, updatedAt: r.updatedAt }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async function handleDeleteRating(t: TechnicianRow, ratingId: string) {
    if (!activeWorkspaceId) return;
    const rating = t.ratings.find((r) => r.id === ratingId);
    const ok = await confirmDialog({
      title: "Удалить оценку?",
      description: rating
        ? `${raterLabel(rating)} → ${personLabel(t.member)}: ${rating.stars} из 5. ОС сможет оценить снова, если у технаря будет его недавний заказ.`
        : undefined,
      confirmLabel: "Удалить",
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteTechRating(activeWorkspaceId, ratingId);
      toast.success("Оценка удалена");
    } catch {
      toast.error("Не удалось удалить оценку");
    }
  }

  if (!permissions.isResolved) {
    return (
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-3 p-5 md:grid-cols-2">
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
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
  if (isOsViewer && myOsValue) {
    filters.push({ id: "mine", label: "С моими заказами", count: mineCount, active: "border-amber-400/50 bg-amber-400/15 text-amber-300" });
  }

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
        {canMapStatuses && activeWorkspaceId && (
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
        <div className="mx-auto flex max-w-6xl flex-col gap-3">
          {isOsViewer &&
            (myOsValue && myOsNick ? (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 font-medium text-amber-300">
                  <AtSign className="h-3 w-3" />
                  {myOsNick}
                </span>
                <span>
                  ваш ник ОС — технари ставят его у ваших заказов · в этом месяце:{" "}
                  <span className="font-mono tabular-nums text-foreground">{myOrdersTotal}</span> {ordersWord(myOrdersTotal)}
                </span>
              </p>
            ) : (
              <div className="flex items-start gap-2.5 rounded-xl border border-amber-400/35 bg-amber-400/10 px-3 py-2.5 text-sm">
                <AtSign className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                <p className="text-[13px] leading-5">
                  <span className="font-medium text-amber-200">У вас пока нет ника ОС.</span>{" "}
                  <span className="text-muted-foreground">
                    Его выдаёт Тимлид. Технари ставят ник у ваших заказов — тогда здесь будут видны ваши заказы и
                    можно будет оценивать технарей.
                  </span>
                </p>
              </div>
            ))}

          {loadFailed && (
            <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Не удалось загрузить загрузку технарей. Обновите страницу.
            </p>
          )}
          {ratingsFailed && !loadFailed && (
            <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Не удалось загрузить оценки. Обновите страницу.
            </p>
          )}

          {!loadFailed && loads === null && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
              <Skeleton className="h-64 rounded-2xl" />
              <Skeleton className="h-64 rounded-2xl" />
              <Skeleton className="h-64 rounded-2xl" />
            </div>
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
              {filter === "busy"
                ? "Сейчас все свободны."
                : filter === "mine"
                  ? "В этом месяце ваших заказов у технарей нет."
                  : "Сейчас все заняты."}
            </p>
          )}

          {loads !== null && visible.length > 0 && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {visible.map((t) => (
                <TechnicianCard
                  key={t.member.uid}
                  member={t.member}
                  isMe={t.member.uid === uid}
                  desks={t.desks}
                  deskLinks={isOwner}
                  showPayment={showPayment}
                  busy={t.busy}
                  summary={t.summary}
                  breakdown={t.breakdown}
                  updatedAt={t.updatedAt}
                  myOrders={t.myOrders}
                  rating={{
                    average: ratingsFailed || t.ratings.length === 0 ? null : t.ratings.reduce((n, r) => n + r.stars, 0) / t.ratings.length,
                    count: ratingsFailed ? 0 : t.ratings.length,
                  }}
                  rater={raterFor(t)}
                  onRate={(stars) => handleRate(t, stars)}
                  ratingDetails={ratingDetailsFor(t)}
                  onDeleteRating={canModerateRatings ? (id) => void handleDeleteRating(t, id) : undefined}
                />
              ))}
            </div>
          )}
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
