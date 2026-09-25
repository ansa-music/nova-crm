import { DeskEditAccessButton } from "@/components/desks/DeskEditAccessButton";
import { useEffect, useMemo, useState } from "react";
import { AtSign, CalendarDays, LayoutGrid, ListOrdered, Search, SlidersHorizontal } from "lucide-react";
import { Link } from "react-router";
import { AccessDenied } from "@/components/common/AccessDenied";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { useUrlState } from "@/hooks/useUrlState";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/common/EmptyState";
import { MonthlyRatingTop, type MonthlyTopEntry } from "@/components/technicians/MonthlyRatingTop";
import { ScoreRateButton } from "@/components/technicians/ScoreRating";
import { TechLoadStatusDialog } from "@/components/technicians/TechLoadStatusDialog";
import {
  TechnicianCard,
  type TechnicianOrderItem,
  type TechnicianOsShare,
  type TechnicianRatingDetail,
} from "@/components/technicians/TechnicianCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentMonthKey } from "@/hooks/useCurrentMonthKey";
import {
  useDeskLoads,
  useOrderRatings,
  useOrderRatingTotals,
  useOwnerDeskRecount,
  useTechSchedules,
} from "@/hooks/useDeskLoads";
import { useMembersRefresh } from "@/hooks/useMembersRefresh";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { osNickLabel } from "@/services/memberService";
import { subscribeMyOsOrders } from "@/services/osOrdersService";
import { useSbBackend } from "@/services/sb/sbCollections";
import { currentMonthSubPageId, previousMonthKey } from "@/services/monthTabService";
import { monthTabNameForKey } from "@/services/subPageService";
import { orderRatingId, rateOrder, RatingDeniedError, removeOrderRating } from "@/services/orderRatingService";
import { confirmDialog } from "@/utils/appDialog";
import { DEFAULT_STATUS_OPTIONS } from "@/utils/columnOptions";
import { formatOrderDate, timeAgo, ymdInTimeZone } from "@/utils/date";
import { personLabel, worksAsTechnician } from "@/utils/peopleDesks";
import {
  addStatusCounts,
  addTechLoad,
  effectiveTechLoadKinds,
  EMPTY_TECH_LOAD,
  statusBreakdown,
  summarizeDeskLoad,
  techLoadKindForOption,
  NO_STATUS_KEY,
  type StatusBreakdownItem,
  type TechLoadSummary,
} from "@/utils/techLoad";
import { PageHeader, pageChipClass } from "@/components/common/PageHeader";
import { cn } from "@/utils/cn";
import {
  averageOfTotals,
  formatScheduleHours,
  memberHasRole,
  scheduleDayKey,
  scheduleHoursOf,
  scheduleStateOf,
  type OrderRating,
  type OrderRatingTotals,
  type OsOrders,
  type StatusOption,
  type TechSchedule,
  type WorkspaceMember,
  type WorkspacePage,
} from "@/types";

type Filter = "all" | "free" | "busy" | "away" | "nodesk" | "mine";
const FILTERS: readonly Filter[] = ["all", "free", "busy", "away", "nodesk", "mine"];
/** ОС only: the technician cards, or their own orders as one list. */
type View = "techs" | "orders";

interface TechnicianRow {
  member: WorkspaceMember;
  desks: WorkspacePage[];
  summary: TechLoadSummary;
  breakdown: StatusBreakdownItem[];
  busy: boolean;
  /** Newest count among this person's desks; 0 when nothing was counted this month yet. */
  updatedAt: number;
  /** Viewer is an ОС with a nick: their orders at this Технарь this month. */
  myOrders: { summary: TechLoadSummary; breakdown: StatusBreakdownItem[]; items: TechnicianOrderItem[] } | null;
  /** Management view: orders per ОС this month. */
  osShares: TechnicianOsShare[] | null;
  /** Итоги оценок заказов ЭТОГО месяца (1–10) — единственная оценка технаря. */
  orderTotals: OrderRatingTotals[];
}

const NO_OPTIONS: StatusOption[] = [];

function ordersWord(n: number) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "заказ";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "заказа";
  return "заказов";
}

/** Средняя оценка заказов — тай-брейк в сортировке равных по заказам. */
function ratingScore(row: TechnicianRow): number | null {
  return averageOfTotals(row.orderTotals);
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
  const [osOrderDocs, setOsOrderDocs] = useState<OsOrders[]>([]);
  // Фильтр — в адресе (`?f=free`): F5 не сбрасывает, ссылку можно отдать.
  const [filter, setFilter] = useUrlState<Filter>("f", "all", { values: FILTERS });
  const [view, setView] = useState<View>("techs");
  const [orderQuery, setOrderQuery] = useState("");
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);

  const canSee = permissions.canSeeTechnicians;
  // Owner reads every desk and recounts them; the status mapping is a
  // workspace setting (Owner or Тимлид).
  const isOwner = permissions.hasFullDeskAccess;
  const canMapStatuses = permissions.canManageStatusVariants;
  // Разбивка заказов по ОС — Owner/Тимлид/Admin. Сами оценки (в них названия
  // заказов) видит и снимает только Owner: Тимлид содержимого столов не видит.
  const canSeeRatingDetails = permissions.canManageUsers || permissions.role === "admin";
  const canModerateRatings = permissions.actsAsOwner;
  const isOsViewer = permissions.hasRole("os");
  const uid = profile?.uid ?? "";

  // Other members' docs aren't live — refresh so nicks, desks and "last
  // seen" are current when the screen opens. Через общий 5-минутный порог:
  // «Технари» ↔ «Дашборд» туда-обратно иначе перечитывали список каждый раз.
  useMembersRefresh(activeWorkspaceId, canSee, false);

  // A denied read is "unknown", not "everyone is free" — never show an
  // empty list as if it were real data (loadFailed/ratingsFailed).
  const { loads, failed: loadFailed, synced: loadsSynced } = useDeskLoads(activeWorkspaceId, canSee);
  const { totals: orderTotals, failed: ratingsFailed } = useOrderRatingTotals(activeWorkspaceId, monthKey, canSee);
  // График нужен прямо здесь: у кого сегодня выходной, карточка гаснет — без
  // этого «Свободен» у отсутствующего читался как «можно отдать заказ».
  const { schedules, failed: schedulesFailed, retry: retrySchedules } = useTechSchedules(activeWorkspaceId, monthKey, canSee);
  const todayKey = scheduleDayKey(ymdInTimeZone(Date.now()));
  const scheduleByUid = useMemo(() => {
    const map = new Map<string, TechSchedule>();
    for (const s of schedules) map.set(s.uid, s);
    return map;
  }, [schedules]);
  useOwnerDeskRecount(canSee ? loads : null, loadsSynced);

  // Оценки живут месяцами. Текущий месяц — то, что сейчас ставят и меняют;
  // прошлый — закрытый итог, он висит наверху, чтобы в первых числах экран
  // не выглядел так, будто технарей никто никогда не оценивал.
  const prevMonthKey = previousMonthKey(monthKey);
  const monthOrderTotals = useMemo(
    () => (orderTotals ?? []).filter((t) => t.monthKey === monthKey),
    [orderTotals, monthKey]
  );
  const prevOrderTotals = useMemo(
    () => (orderTotals ?? []).filter((t) => t.monthKey === prevMonthKey),
    [orderTotals, prevMonthKey]
  );
  // Свои оценки заказов — чтобы в «Мои заказы» было видно, что уже оценено.
  const { ratings: myOrderRatings, backend: ratingsBackend } = useOrderRatings(
    activeWorkspaceId,
    isOsViewer && uid ? { kind: "os", uid } : null,
    monthKey,
    canSee
  );
  const myRatingByOrder = useMemo(() => {
    const map = new Map<string, OrderRating>();
    for (const r of myOrderRatings ?? []) map.set(r.id, r);
    return map;
  }, [myOrderRatings]);
  const scoreOf = (item: TechnicianOrderItem) => myRatingByOrder.get(orderRatingId(item.pageId, item.rowId))?.score ?? null;
  // Owner: все оценки месяца — кто какой заказ как оценил, снять несправедливую.
  const { ratings: allOrderRatings } = useOrderRatings(
    activeWorkspaceId,
    canModerateRatings ? { kind: "all" } : null,
    monthKey,
    canSee
  );

  const responsibleOptions = activeWorkspace?.responsibleOptions ?? NO_OPTIONS;
  const statusOptions = activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS;
  const kinds = useMemo(() => effectiveTechLoadKinds(activeWorkspace), [activeWorkspace]);
  // The «Ждём оплату» tile only where some status actually means it.
  const showPayment = useMemo(
    () => statusOptions.some((o) => techLoadKindForOption(o, kinds) === "payment"),
    [statusOptions, kinds]
  );


  const myMember = useMemo(() => members.find((m) => m.uid === uid) ?? null, [members, uid]);
  const myOsValue = isOsViewer ? myMember?.osNickValue ?? null : null;
  const myOsNick = isOsViewer ? osNickLabel(myMember, responsibleOptions) : null;

  // The ОС's own order lists, one doc per desk — only their nick's docs
  // are readable, so the query filters on exactly that. Где они лежат
  // (Firestore или Supabase `os_orders`) — ключ `osOrders` в sbCollections;
  // null — документ workspace ещё не пришёл, подписываться рано (иначе старт
  // читал бы Firestore и тут же переподписывался).
  const osOrdersBackend = useSbBackend(activeWorkspace, "osOrders");
  useEffect(() => {
    setOsOrderDocs([]);
    if (!activeWorkspaceId || !canSee || !myOsValue || !osOrdersBackend) return;
    return subscribeMyOsOrders(
      activeWorkspaceId,
      myOsValue,
      (docs) => setOsOrderDocs(docs),
      () => setOsOrderDocs([]),
      osOrdersBackend
    );
  }, [activeWorkspaceId, canSee, myOsValue, osOrdersBackend]);

  const statusMeta = useMemo(() => {
    const byValue = new Map(statusOptions.map((o) => [o.value, o]));
    const byLabel = new Map(statusOptions.map((o) => [o.label.trim().toLowerCase(), o]));
    return (raw: string): { label: string; color: string | null; key: string } => {
      if (!raw) return { label: "Без статуса", color: null, key: NO_STATUS_KEY };
      const option = byValue.get(raw) ?? byLabel.get(raw.toLowerCase());
      return option ? { label: option.label, color: option.color, key: option.value } : { label: raw, color: null, key: raw };
    };
  }, [statusOptions]);

  const technicians = useMemo<TechnicianRow[]>(() => {
    const loadByPage = new Map((loads ?? []).map((l) => [l.pageId, l]));
    // Кто работает за столом: Технарь или Owner (`worksAsTechnician`), плюс
    // столы, помеченные «Стол технаря» руками.
    const flaggedOwners = new Set(pages.filter((p) => p.technicianDesk && p.responsibleUserId).map((p) => p.responsibleUserId));
    return members
      .filter((m) => m.status === "active" && (worksAsTechnician(m) || flaggedOwners.has(m.uid)))
      .map((member) => {
        const desks = pages
          .filter(
            (p) =>
              p.responsibleUserId === member.uid &&
              !p.isDashboard &&
              (worksAsTechnician(member) || Boolean(p.technicianDesk))
          )
          .sort((a, b) => a.order - b.order);
        let summary = EMPTY_TECH_LOAD;
        let updatedAt = 0;
        let myTotal = 0;
        const statusCounts: Record<string, number> = {};
        const myStatusCounts: Record<string, number> = {};
        const myItems: TechnicianOrderItem[] = [];
        const osCounts: Record<string, number> = {};
        for (const desk of desks) {
          const load = loadByPage.get(desk.id);
          if (!load) continue;
          const subPageId = currentMonthSubPageId(desk, monthKey);
          // No month tab yet, or counts from another month/tab: nothing
          // counted for this month on this desk.
          if (!subPageId || load.monthKey !== monthKey || load.subPageId !== subPageId) continue;
          summary = addTechLoad(summary, summarizeDeskLoad(load, statusOptions, kinds));
          addStatusCounts(statusCounts, load.statusCounts);
          addStatusCounts(osCounts, load.osCounts);
          if (myOsValue && (load.osCounts?.[myOsValue] ?? 0) > 0) {
            myTotal += load.osCounts?.[myOsValue] ?? 0;
            addStatusCounts(myStatusCounts, load.osStatusCounts?.[myOsValue]);
            // The list is trusted only next to live counts for the same tab.
            const doc = osOrderDocs.find((d) => d.pageId === desk.id);
            if (doc && doc.monthKey === monthKey && doc.subPageId === subPageId) {
              for (const order of doc.orders) {
                const meta = statusMeta(order.status);
                myItems.push({
                  pageId: desk.id,
                  tabId: subPageId,
                  rowId: order.rowId,
                  title: order.title,
                  statusLabel: meta.label,
                  statusColor: meta.color,
                  date: order.date,
                  updatedAt: order.updatedAt,
                });
              }
            }
          }
          updatedAt = Math.max(updatedAt, load.updatedAt ?? 0);
        }
        myItems.sort((a, b) => b.updatedAt - a.updatedAt);
        const osShares: TechnicianOsShare[] = Object.entries(osCounts)
          .map(([osValue, count]) => {
            const option = responsibleOptions.find((o) => o.value === osValue);
            return { osValue, label: option?.label ?? osValue, color: option?.color ?? null, count };
          })
          .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ru"));
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
                items: myItems,
              }
            : null,
          osShares: canSeeRatingDetails ? osShares : null,
          orderTotals: monthOrderTotals.filter((t) => t.technicianUid === member.uid),
        };
      })
      // Своя карточка первой — это личное удобство и к ранжированию
      // отношения не имеет. Дальше по АКТУАЛЬНОСТИ: сначала те, у кого
      // больше заказов за месяц, при равном числе заказов выше тот, у кого
      // выше оценка. Технари без стола в самом низу — заказов у них быть
      // не может вообще, и держать их среди работающих бессмысленно.
      //
      // Раньше сортировка была «кто свободен раньше», то есть занятый
      // технарь с девятью заказами падал ниже пустого. Для вопроса «кому
      // отдать следующий заказ» это правильно, но экран читают ещё и как
      // «кто тут вообще работает», и там это давало ровно обратный порядок.
      // Свободен/занят никуда не делся — он на бейдже и в фильтрах сверху.
      .sort((a, b) => {
        if (a.member.uid === uid) return -1;
        if (b.member.uid === uid) return 1;
        if ((a.desks.length === 0) !== (b.desks.length === 0)) return a.desks.length === 0 ? 1 : -1;
        return (
          b.summary.total - a.summary.total ||
          (ratingScore(b) ?? -1) - (ratingScore(a) ?? -1) ||
          personLabel(a.member).localeCompare(personLabel(b.member), "ru")
        );
      });
  }, [loads, monthOrderTotals, members, pages, monthKey, statusOptions, kinds, myOsValue, osOrderDocs, statusMeta, responsibleOptions, canSeeRatingDetails, uid]);

  // «Мои заказы»: every order of the viewing ОС across technicians, grouped by
  // status in the shared list's order, newest first inside a group.
  const myOrderGroups = useMemo(() => {
    if (!myOsValue) return [];
    const q = orderQuery.trim().toLowerCase();
    const groups = new Map<string, { label: string; color: string | null; rank: number; items: (TechnicianOrderItem & { member: WorkspaceMember })[] }>();
    for (const t of technicians) {
      for (const item of t.myOrders?.items ?? []) {
        if (q && !item.title.toLowerCase().includes(q) && !personLabel(t.member).toLowerCase().includes(q)) continue;
        const key = item.statusLabel;
        const group = groups.get(key) ?? {
          label: item.statusLabel,
          color: item.statusColor,
          rank: (() => {
            const idx = statusOptions.findIndex((o) => o.label === item.statusLabel);
            return idx < 0 ? statusOptions.length + (item.statusColor ? 0 : 1) : idx;
          })(),
          items: [],
        };
        group.items.push({ ...item, member: t.member });
        groups.set(key, group);
      }
    }
    return [...groups.values()]
      .map((g) => ({ ...g, items: g.items.sort((a, b) => b.updatedAt - a.updatedAt) }))
      .sort((a, b) => a.rank - b.rank);
  }, [technicians, myOsValue, orderQuery, statusOptions]);
  const myOrderItemsCount = myOrderGroups.reduce((n, g) => n + g.items.length, 0);

  // «Свободен/занят» — это про стол: у кого стола нет, тот ни свободен, ни
  // занят, ему просто некуда отдать заказ. Раньше такие люди попадали в счёт
  // «Все», но не попадали ни под один чип и терялись внизу списка — цифры не
  // сходились, и понять, куда делись двое, по экрану было нельзя.
  const withDesk = technicians.filter((t) => t.desks.length > 0);
  // Кого сегодня нет по графику, тот ни «свободен», ни «занят». Карточка у
  // такого человека уже гасла и писала «ВЫХОДНОЙ», но счётчик и фильтр
  // «Свободны» его по-прежнему брали — «можно отдать заказ» читалось ровно у
  // того, кого нет, хотя «Заказы» его из «Рандома» уже исключали.
  const isAway = (t: TechnicianRow) => dayOffOf(t.member.uid) !== null;
  const present = withDesk.filter((t) => !isAway(t));
  const freeCount = present.filter((t) => !t.busy).length;
  const busyCount = present.filter((t) => t.busy).length;
  const awayCount = withDesk.length - present.length;
  const noDeskCount = technicians.length - withDesk.length;
  const mineCount = technicians.filter((t) => (t.myOrders?.summary.total ?? 0) > 0).length;
  const myOrdersTotal = technicians.reduce((n, t) => n + (t.myOrders?.summary.total ?? 0), 0);
  /** Сегодня по графику человека нет — карточка гаснет и метится. */
  function dayOffOf(memberUid: string): { state: "off" | "excused" } | null {
    const state = scheduleStateOf(scheduleByUid.get(memberUid), todayKey);
    return state === "work" ? null : { state };
  }

  /** Гибридная смена на сегодня: «12:00–15:00». */
  function hoursOf(memberUid: string): string | null {
    const hours = scheduleHoursOf(scheduleByUid.get(memberUid), todayKey);
    return hours ? formatScheduleHours(hours) : null;
  }

  const visible = technicians.filter((t) => {
    if (filter === "free") return t.desks.length > 0 && !isAway(t) && !t.busy;
    // Условие про стол обязано совпадать с busyCount, иначе чип показывает
    // одно число, а список под ним — другое.
    if (filter === "busy") return t.desks.length > 0 && !isAway(t) && t.busy;
    if (filter === "away") return t.desks.length > 0 && isAway(t);
    if (filter === "nodesk") return t.desks.length === 0;
    if (filter === "mine") return (t.myOrders?.summary.total ?? 0) > 0;
    return true;
  });

  // Топ прошлого месяца по оценкам заказов. Порог в одну оценку намеренный:
  // одна оценка — это всё же оценка, а не шум.
  const previousTop = useMemo(() => {
    const byTech = new Map<string, OrderRatingTotals[]>();
    for (const t of prevOrderTotals) byTech.set(t.technicianUid, [...(byTech.get(t.technicianUid) ?? []), t]);
    const entries: MonthlyTopEntry[] = [];
    for (const [technicianUid, totals] of byTech) {
      const member = members.find((m) => m.uid === technicianUid);
      const average = averageOfTotals(totals);
      if (member && average !== null) entries.push({ member, average, count: totals.reduce((n, t) => n + t.count, 0) });
    }
    return entries.sort((a, b) => b.average - a.average || b.count - a.count).slice(0, 3);
  }, [prevOrderTotals, members]);

  /**
   * Оценка заказа, 1–10. `null` — снять. Кто вправе, решает база: заказ
   * должен быть этого ОС (в Supabase — по самой строке заказа).
   */
  async function handleRateOrder(item: TechnicianOrderItem, technicianUid: string, score: number | null) {
    if (!activeWorkspaceId || !myOsValue) return;
    const previous = myRatingByOrder.get(orderRatingId(item.pageId, item.rowId)) ?? null;
    if (score === null && !previous) return;
    try {
      if (score === null && previous) {
        await removeOrderRating(activeWorkspaceId, previous);
        toast.success("Оценка снята");
        return;
      }
      await rateOrder({
        workspaceId: activeWorkspaceId,
        backend: ratingsBackend ?? "firestore",
        pageId: item.pageId,
        tabId: item.tabId,
        rowId: item.rowId,
        osUid: uid,
        osValue: myOsValue,
        technicianUid,
        score,
        title: item.title,
        monthKey,
        previous,
      });
      toast.success(previous ? `Оценка изменена: ${score} из 10` : `Заказ оценён: ${score} из 10`);
    } catch (error) {
      toast.error(error instanceof RatingDeniedError ? error.message : "Не удалось сохранить оценку");
    }
  }

  function raterLabel(rating: OrderRating): string {
    const rater = members.find((m) => m.uid === rating.osUid);
    return (
      (rater ? personLabel(rater) : null) ??
      responsibleOptions.find((o) => o.value === rating.osValue)?.label ??
      rating.osValue ??
      "ОС"
    );
  }

  function ratingDetailsFor(t: TechnicianRow): TechnicianRatingDetail[] | null {
    if (!canModerateRatings || !allOrderRatings) return null;
    return allOrderRatings
      .filter((r) => r.technicianUid === t.member.uid && r.monthKey === monthKey)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((r) => ({ id: r.id, raterLabel: raterLabel(r), title: r.title, score: r.score, updatedAt: r.updatedAt }));
  }

  async function handleDeleteRating(t: TechnicianRow, ratingId: string) {
    if (!activeWorkspaceId) return;
    const rating = allOrderRatings?.find((r) => r.id === ratingId);
    if (!rating) return;
    const ok = await confirmDialog({
      title: "Снять оценку?",
      description: `${raterLabel(rating)} → ${personLabel(t.member)}: ${rating.score} из 10${rating.title ? ` за «${rating.title}»` : ""}. ОС сможет оценить заказ снова.`,
      confirmLabel: "Снять",
      destructive: true,
    });
    if (!ok) return;
    try {
      await removeOrderRating(activeWorkspaceId, rating);
      toast.success("Оценка снята");
    } catch (error) {
      toast.error(error instanceof RatingDeniedError ? error.message : "Не удалось снять оценку");
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
    return <AccessDenied reason="Эта страница недоступна в режиме просмотра." backTo={{ to: "/dashboard", label: "Дашборд" }} />;
  }

  const filters: { id: Filter; label: string; count: number; active: string }[] = [
    { id: "all", label: "Все", count: technicians.length, active: "border-primary/50 bg-primary/15 text-primary" },
    { id: "free", label: "Свободны", count: freeCount, active: "border-success/50 bg-success/15 text-success" },
    { id: "busy", label: "Заняты", count: busyCount, active: "border-destructive/50 bg-destructive/15 text-destructive" },
  ];
  if (awayCount > 0) {
    filters.push({ id: "away", label: "Сегодня нет", count: awayCount, active: "border-destructive/50 bg-destructive/15 text-destructive" });
  }
  if (noDeskCount > 0) {
    filters.push({ id: "nodesk", label: "Без стола", count: noDeskCount, active: "border-border bg-muted/60 text-foreground" });
  }
  if (isOsViewer && myOsValue) {
    filters.push({ id: "mine", label: "С моими заказами", count: mineCount, active: "border-amber-400/50 bg-amber-400/15 text-amber-300" });
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl p-5 sm:p-8 lg:p-10">
      <PageHeader
        eyebrow="Студия"
        title="Технари"
        description={`Кто сейчас свободен и сколько заказов за ${monthTabNameForKey(monthKey).toLowerCase()}.`}
        actions={
          <>
        {/* Owner: кто правит столы технарей — все, никто или выборочно. */}
        {(permissions.actsAsOwner) && <DeskEditAccessButton />}
        {isOsViewer && myOsValue && (
          <div className="flex shrink-0 rounded-lg border border-border p-0.5" role="tablist" aria-label="Вид">
            <button
              type="button"
              role="tab"
              aria-selected={view === "techs"}
              onClick={() => setView("techs")}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium transition-colors",
                view === "techs" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Технари</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "orders"}
              onClick={() => setView("orders")}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium transition-colors",
                view === "orders" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <ListOrdered className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Мои заказы</span>
              <span className="tabular-nums opacity-80">{myOrdersTotal}</span>
            </button>
          </div>
        )}
        {activeWorkspaceId && (
          <Button asChild variant="outline" size="sm" className="min-h-11 gap-1.5 sm:min-h-0">
            <Link to="/schedule">
              <CalendarDays className="h-3.5 w-3.5" />
              График
            </Link>
          </Button>
        )}
        {canMapStatuses && activeWorkspaceId && (
          <Button variant="outline" size="sm" className="min-h-11 gap-1.5 sm:min-h-0" onClick={() => setStatusDialogOpen(true)}>
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Статусы
          </Button>
        )}
          </>
        }
        filters={
          view === "orders"
            ? undefined
            : filters.map((item) => (
                <button key={item.id} type="button" onClick={() => setFilter(item.id)} className={pageChipClass(filter === item.id, item.active)}>
                  {item.label}
                  <span className="tabular-nums text-[10px] opacity-80">{item.count}</span>
                </button>
              ))
        }
      />

      <div>
        <div className="flex flex-col gap-3">
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
          {schedulesFailed && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
              <span className="min-w-0 flex-1">График не прочитан — выходные на карточках сейчас не видны.</span>
              <button
                type="button"
                onClick={retrySchedules}
                className="min-h-11 shrink-0 font-medium underline underline-offset-2 sm:min-h-0"
              >
                Повторить
              </button>
            </div>
          )}
          {ratingsFailed && !loadFailed && (
            <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Не удалось загрузить оценки. Обновите страницу.
            </p>
          )}

          {loads !== null && (
            <MonthlyRatingTop monthLabel={monthTabNameForKey(prevMonthKey).toLowerCase()} entries={previousTop} />
          )}

          {!loadFailed && loads === null && (
            <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))]">
              <Skeleton className="h-64 rounded-2xl" />
              <Skeleton className="h-64 rounded-2xl" />
              <Skeleton className="h-64 rounded-2xl" />
            </div>
          )}

          {view === "orders" && myOsValue && loads !== null && (
            // Список заказов — это лента строк, а не сетка: на широком экране
            // он растягивался на всю ширину стола, и звёзды уезжали от названия
            // заказа метров на сорок. Ограничиваем ширину как у переписки.
            <div className="flex w-full max-w-3xl flex-col gap-3">
              <div className="relative max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={orderQuery}
                  onChange={(e) => setOrderQuery(e.target.value)}
                  placeholder="Клиент или технарь"
                  className="h-9 pl-8"
                />
              </div>
              {myOrderGroups.length === 0 && (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  {orderQuery
                    ? "Ничего не нашли."
                    : myOrdersTotal > 0
                      ? "Список появится, когда технари откроют свои столы."
                      : "В этом месяце у технарей нет заказов с вашим ником."}
                </p>
              )}
              {myOrderGroups.map((group) => (
                <section key={group.label} className="overflow-hidden rounded-2xl border border-border/70 bg-card/70">
                  <header className="flex items-center gap-2 border-b border-border/60 px-4 py-2">
                    <span
                      className={cn("h-2 w-2 shrink-0 rounded-full", !group.color && "bg-muted-foreground/60")}
                      style={group.color ? { backgroundColor: `hsl(${group.color})` } : undefined}
                    />
                    <span className="text-sm font-medium">{group.label}</span>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">{group.items.length}</span>
                  </header>
                  <ul className="divide-y divide-border/50">
                    {group.items.map((item) => (
                      <li key={`${item.member.uid}:${item.rowId}`} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                        <MemberAvatar
                          id={item.member.uid}
                          name={item.member.name}
                          nickname={item.member.nickname}
                          photoURL={item.member.photoURL}
                          className="h-7 w-7 shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate" title={item.title || undefined}>
                            {item.title || <span className="italic text-muted-foreground">Без названия</span>}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {personLabel(item.member)}
                            {item.date !== null ? ` · ${formatOrderDate(item.date)}` : ""}
                            {item.updatedAt ? ` · изменено ${timeAgo(item.updatedAt)}` : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <ScoreRateButton
                            value={scoreOf(item)}
                            onRate={(score) => handleRateOrder(item, item.member.uid, score)}
                            label={`Заказ «${item.title || "без названия"}»`}
                          />
                          <Link
                            to={`/messages/${item.member.uid}`}
                            className="text-[11px] font-medium text-primary hover:underline"
                          >
                            Написать
                          </Link>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              {myOrderItemsCount > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Показаны заказы за {monthTabNameForKey(monthKey).toLowerCase()}; список каждый технарь обновляет, работая в своём столе.
                </p>
              )}
            </div>
          )}

          {view === "techs" && loads !== null && technicians.length === 0 && (
            <EmptyState
              eyebrow="Технари"
              title="Пока нет технарей"
              description="Здесь появятся участники с ролью «Технарь» и их заказы за текущий месяц."
            />
          )}

          {view === "techs" && loads !== null && technicians.length > 0 && visible.length === 0 && (
            <p className="py-16 text-center text-sm text-muted-foreground">
              {filter === "mine"
                ? "В этом месяце ваших заказов у технарей нет."
                : filter === "nodesk"
                  ? "У всех технарей есть стол."
                  : filter === "away"
                    ? "Сегодня все на месте."
                    : // «Свободны»/«Заняты» пусты: не «все заняты», если на
                      // самом деле никого нет на месте.
                      present.length === 0 && awayCount > 0
                      ? "Сегодня все технари со столом отсутствуют."
                      : filter === "busy"
                        ? "Сейчас все свободны."
                        : "Сейчас все заняты."}
            </p>
          )}

          {view === "techs" && loads !== null && visible.length > 0 && (
            <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))]">
              {visible.map((t) => (
                <TechnicianCard
                  key={t.member.uid}
                  member={t.member}
                  isMe={t.member.uid === uid}
                  dayOff={dayOffOf(t.member.uid)}
                  todayHours={hoursOf(t.member.uid)}
                  desks={t.desks}
                  deskLinks={isOwner}
                  showPayment={showPayment}
                  busy={t.busy}
                  summary={t.summary}
                  breakdown={t.breakdown}
                  updatedAt={t.updatedAt}
                  myOrders={t.myOrders}
                  osShares={t.osShares}
                  rating={{
                    average: ratingsFailed ? null : averageOfTotals(t.orderTotals),
                    count: ratingsFailed ? 0 : t.orderTotals.reduce((n, o) => n + o.count, 0),
                  }}
                  orderScoreOf={scoreOf}
                  onRateOrder={
                    isOsViewer && myOsValue && t.member.uid !== uid
                      ? (item, score) => handleRateOrder(item, t.member.uid, score)
                      : undefined
                  }
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
