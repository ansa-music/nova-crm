import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { CalendarClock, Clock3, ExternalLink, Hand, Inbox, Link2, Phone, Plus, Shuffle, Trash2, Undo2, UserCheck, Users, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/EmptyState";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { IssueOrderDialog, type IssueOrderForm } from "@/components/orders/IssueOrderDialog";
import { AssignOrderDialog } from "@/components/orders/AssignOrderDialog";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useCurrentMonthKey } from "@/hooks/useCurrentMonthKey";
import { useDeskLoads, useTechSchedules } from "@/hooks/useDeskLoads";
import { currentBusyUids, effectiveTechLoadKinds } from "@/utils/techLoad";
import { currentMonthSubPageId } from "@/services/monthTabService";
import { DEFAULT_STATUS_OPTIONS } from "@/utils/columnOptions";
import {
  assignOrder,
  createOrder,
  deleteOrder,
  pickRandomCandidate,
  setOrderCancelled,
  setOrderClaim,
  subscribeOrders,
  takeOrderToDesk,
  unassignOrder,
  type OrderCandidate,
} from "@/services/orderService";
import { parseOptionalNumber } from "@/utils/quickOrder";
import { displayNameOf } from "@/utils/displayName";
import { formatCurrency } from "@/utils/format";
import { almatyNoonMillis, formatOrderDate, timeAgo, ymdInTimeZone } from "@/utils/date";
import { hasFullAccess } from "@/utils/permissions";
import { confirmDialog } from "@/utils/appDialog";
import { parseHttpUrl } from "@/utils/httpUrl";
import { PageHeader, pageChipClass } from "@/components/common/PageHeader";
import { cn } from "@/utils/cn";
import { memberHasRole, scheduleDayKey, scheduleStateOf, WORK_ORDER_STATUS_LABELS, WORK_ORDER_URGENCY_LABELS, type WorkOrder, type WorkOrderStatus, type WorkOrderUrgency, type WorkspaceMember, type TechSchedule } from "@/types";

const TABS: WorkOrderStatus[] = ["open", "assigned", "taken", "cancelled"];

/** «YYYY-MM-DD» из поля даты → полдень этого дня по Алматы (или null). */
function deadlineMillis(raw: string): number | null {
  if (!raw) return null;
  const [y, m, d] = raw.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const ms = almatyNoonMillis(y, m - 1, d);
  return Number.isFinite(ms) ? ms : null;
}

/** «Нейтральный» ничем не помечаем — бейдж только там, где он что-то значит. */
const URGENCY_TONE: Record<Exclude<WorkOrderUrgency, "normal">, string> = {
  urgent: "border-amber-400/45 bg-amber-400/12 text-amber-200",
  fire: "border-destructive/50 bg-destructive/15 text-destructive",
};

const STATUS_TONE: Record<WorkOrderStatus, string> = {
  open: "border-primary/40 bg-primary/12 text-primary",
  assigned: "border-amber-400/40 bg-amber-400/12 text-amber-200",
  taken: "border-success/40 bg-success/12 text-success",
  cancelled: "border-border bg-muted/60 text-muted-foreground",
};

/**
 * «Заказы» — биржа между ОС и технарями. ОС/Тимлид/Owner выдаёт заказ,
 * технари откликаются, выдающий отдаёт заказ одному из них (или рандому),
 * назначенный забирает его в свой стол — строка заполняется сама.
 * Подписка на заказы живёт только пока открыта эта страница.
 */
export default function OrdersPage() {
  const { profile } = useAuth();
  const permissions = usePermissions();
  const { activeWorkspace, activeWorkspaceId, members, pages } = useWorkspace();
  const monthKey = useCurrentMonthKey();
  const [orders, setOrders] = useState<WorkOrder[] | null>(null);
  const [tab, setTab] = useState<WorkOrderStatus>("open");
  const [issueOpen, setIssueOpen] = useState(false);
  // Храним ID, а не снимок: диалог «Кому отдать» обязан видеть отклики,
  // пришедшие уже после открытия, иначе «Рандом» считает claims пустыми и
  // отдаёт заказ НЕ откликнувшемуся.
  const [assignForId, setAssignForId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [ordersError, setOrdersError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const uid = profile?.uid ?? "";
  const myName = displayNameOf(profile);
  const canIssue = permissions.isResolved && (hasFullAccess(permissions.role) || permissions.hasRole("os"));
  const canClaim = permissions.isResolved && permissions.hasRole("manager");
  const fullAccess = permissions.isResolved && hasFullAccess(permissions.role);
  const myMembership = useMemo(() => members.find((m) => m.uid === uid) ?? null, [members, uid]);
  const myDesk = useMemo(() => pages.find((p) => p.responsibleUserId === uid) ?? null, [pages, uid]);

  const osOptions = activeWorkspace?.responsibleOptions ?? [];
  /** Свой ник ОС: подставляется по умолчанию, но список открыт — можно выставить на любого. */
  const myOs = useMemo(
    () => (myMembership?.osNickValue ? (osOptions.find((o) => o.value === myMembership.osNickValue) ?? { value: myMembership.osNickValue, label: myMembership.osNick ?? myMembership.osNickValue, color: "0 0% 50%" }) : null),
    [myMembership?.osNickValue, myMembership?.osNick, osOptions]
  );

  // График и загрузка столов — ровно для двух запретов на отклик: «сегодня
  // выходной» и «уже есть заказ в работе». Оба живут только пока открыта
  // эта страница (см. лимиты слушателей в CLAUDE.md).
  const {
    schedules,
    failed: schedulesFailed,
    retry: retrySchedules,
  } = useTechSchedules(activeWorkspaceId, monthKey, permissions.isResolved);
  const { loads } = useDeskLoads(activeWorkspaceId, permissions.isResolved);
  const todayKey = scheduleDayKey(ymdInTimeZone(Date.now()));
  const kinds = useMemo(() => effectiveTechLoadKinds(activeWorkspace), [activeWorkspace]);
  const statusOptions = activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS;

  const scheduleByUid = useMemo(() => {
    const map = new Map<string, TechSchedule>();
    for (const sc of schedules) map.set(sc.uid, sc);
    return map;
  }, [schedules]);

  /**
   * У кого прямо сейчас есть заказ «в работе». Считаем по тем же
   * агрегатам deskLoad и тем же правилам статусов, что и «Технари», —
   * иначе «занят» на двух экранах означал бы разное.
   */
  const inWorkUids = useMemo(
    () =>
      currentBusyUids({
        pages,
        loads: loads ?? [],
        monthKey,
        statusOptions,
        kinds,
        currentTabOf: (page) => currentMonthSubPageId(page, monthKey),
      }),
    [pages, loads, monthKey, statusOptions, kinds]
  );

  /** Почему этот технарь сейчас не может взять заказ — null, если может. */
  function blockReasonFor(technicianUid: string): string | null {
    const state = scheduleStateOf(scheduleByUid.get(technicianUid), todayKey);
    if (state === "off") return "сегодня выходной";
    if (state === "excused") return "отпросился";
    if (inWorkUids.has(technicianUid)) return "уже есть заказ в работе";
    return null;
  }

  const technicians = useMemo(
    () => members.filter((m) => m.status === "active" && Boolean(m.uid) && memberHasRole(m, "manager")),
    [members]
  );
  const deskByUid = useMemo(() => {
    const map = new Map<string, string>();
    for (const page of pages) if (page.responsibleUserId) map.set(page.responsibleUserId, page.name);
    return map;
  }, [pages]);

  useEffect(() => {
    setOrders(null);
    setOrdersError(false);
    if (!activeWorkspaceId) return;
    return subscribeOrders(
      activeWorkspaceId,
      (rows) => {
        setOrdersError(false);
        setOrders(rows);
      },
      (error) => {
        // Отказ в чтении НЕЛЬЗЯ отдавать как «заказов нет» (см. «Критические
        // уроки» в CLAUDE.md): пустой экран с кнопкой «Выдать заказ»
        // неотличим от пустой биржи, и ОС выдаёт дубль. onSnapshot после
        // ошибки сам не переподключается — нужен явный повтор.
        console.error("subscribeOrders failed:", error);
        setOrdersError(true);
      }
    );
  }, [activeWorkspaceId, reloadKey]);

  const counts = useMemo(() => {
    const c: Record<WorkOrderStatus, number> = { open: 0, assigned: 0, taken: 0, cancelled: 0 };
    for (const o of orders ?? []) c[o.status] += 1;
    return c;
  }, [orders]);
  const visible = useMemo(() => (orders ?? []).filter((o) => o.status === tab), [orders, tab]);
  /** Живой заказ для диалога — он переживает отклики, выдачу и отмену. */
  const assignFor = useMemo(() => (assignForId ? ((orders ?? []).find((o) => o.id === assignForId) ?? null) : null), [orders, assignForId]);

  /** Откроется ли стол, в который уехал заказ, у смотрящего. */
  function canOpenTakenDesk(pageId: string): boolean {
    const page = pages.find((p) => p.id === pageId);
    return Boolean(page) && permissions.canAccessPage(page!);
  }

  function candidatesFor(order: WorkOrder): Array<OrderCandidate & { member: WorkspaceMember; deskName: string | null }> {
    return technicians.map((m) => ({
      uid: m.uid,
      name: displayNameOf(m),
      hasDesk: deskByUid.has(m.uid),
      claimedAt: order.claims[m.uid]?.at ?? null,
      blockedReason: blockReasonFor(m.uid),
      absentToday: scheduleStateOf(scheduleByUid.get(m.uid), todayKey) !== "work",
      member: m,
      deskName: deskByUid.get(m.uid) ?? null,
    }));
  }

  const myBlockReason = canClaim ? blockReasonFor(uid) : null;
  /**
   * Выходной и «отпросился» снимает ТОЛЬКО руководство: график — документ
   * Тимлида, и кнопки «вышел на смену» у человека больше нет.
   */
  const isScheduleBlock = myBlockReason === "сегодня выходной" || myBlockReason === "отпросился";

  async function withBusy(id: string, fn: () => Promise<void>, fail: string) {
    setBusyId(id);
    try {
      await fn();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : fail);
    } finally {
      setBusyId(null);
    }
  }

  async function handleIssue(form: IssueOrderForm) {
    if (!activeWorkspaceId || !profile) return;
    const os = osOptions.find((o) => o.value === form.osValue) ?? (form.osValue === myOs?.value ? myOs : null);
    try {
      await createOrder({
        workspaceId: activeWorkspaceId,
        client: form.client,
        phone: form.phone,
        link: form.link,
        // Полдень по Алматы, как все календарные даты в проекте: строка
        // «2026-10-01T00:00:00» читается как ЛОКАЛЬНОЕ время устройства, и у
        // ОС в другом часовом поясе и бейдж, и ячейка в столе показывали день назад.
        deadline: deadlineMillis(form.deadline),
        urgency: form.urgency,
        price: parseOptionalNumber(form.price),
        persons: parseOptionalNumber(form.persons),
        minutes: parseOptionalNumber(form.minutes),
        note: form.note,
        osValue: os?.value ?? "",
        osLabel: os?.label ?? "",
        createdBy: profile.uid,
        createdByName: myName,
        technicianUids: technicians.map((m) => m.uid).filter((id) => id !== profile.uid),
      });
      setTab("open");
      toast.success("Заказ выдан", { description: "Технари получили уведомление." });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось выдать заказ");
      throw error;
    }
  }

  async function handleAssign(order: WorkOrder, candidate: OrderCandidate) {
    if (!activeWorkspaceId || !profile) return;
    await assignOrder({ workspaceId: activeWorkspaceId, order, technician: { uid: candidate.uid, name: candidate.name }, actorUid: profile.uid, actorName: myName });
    toast.success(`Заказ выдан: ${candidate.name}`);
  }

  async function handleRandom(order: WorkOrder) {
    const candidates = candidatesFor(order);
    const pick = pickRandomCandidate(candidates);
    if (!pick) {
      const withDesk = candidates.filter((c) => c.hasDesk);
      toast.error(
        withDesk.length > 0
          ? "Сегодня все технари со столом на выходном — выдайте вручную"
          : "Некому выдать: ни у кого нет стола"
      );
      return;
    }
    await handleAssign(order, pick);
  }

  async function handleTake(order: WorkOrder) {
    if (!activeWorkspaceId || !profile || !myDesk) return;
    await withBusy(
      order.id,
      async () => {
        await takeOrderToDesk({ workspaceId: activeWorkspaceId, order, page: myDesk, workspace: activeWorkspace, members, monthKey, me: { uid: profile.uid, name: myName } });
        toast.success("Заказ в столе", { description: `Строка добавлена в «${myDesk.name}».` });
      },
      "Не удалось забрать заказ"
    );
  }

  if (!permissions.isResolved) return null;

  return (
    <div className="mx-auto w-full min-w-0 max-w-4xl p-5 sm:p-8">
      <PageHeader
        eyebrow="Студия"
        title="Заказы"
        description={
          canClaim
            ? "Откликнитесь на открытый заказ; выданный вам — заберите в стол."
            : canIssue
              ? "Выдайте заказ — технари откликнутся, вы выберете, кому отдать."
              : "Что сейчас в работе между ОС и технарями."
        }
        actions={
          canIssue ? (
            <Button className="min-h-11 gap-1.5 sm:min-h-0" onClick={() => setIssueOpen(true)}>
              <Plus className="h-4 w-4" /> Выдать заказ
            </Button>
          ) : undefined
        }
        filters={TABS.map((status) => (
          <button key={status} type="button" onClick={() => setTab(status)} className={pageChipClass(tab === status)}>
            {status === "open" ? "Открытые" : status === "assigned" ? "Выданные" : status === "taken" ? "В столах" : "Отменённые"}
            <span className="tabular-nums text-[10px] opacity-80">{counts[status]}</span>
          </button>
        ))}
      />

      {schedulesFailed && (
        <div className="mb-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
            <span className="min-w-0 flex-1">График не прочитан — выходные сейчас не учитываются ни в откликах, ни в «Рандоме».</span>
            <button
              type="button"
              onClick={retrySchedules}
              className="min-h-11 shrink-0 font-medium underline underline-offset-2 sm:min-h-0"
            >
              Повторить
            </button>
          </div>
        </div>
      )}

      {ordersError ? (
        <EmptyState
          eyebrow="Заказы"
          title="Не удалось загрузить заказы"
          description="Список не прочитался — это не значит, что заказов нет. Проверьте доступ и повторите."
          action={
            <Button variant="outline" onClick={() => setReloadKey((v) => v + 1)}>
              Повторить
            </Button>
          }
        />
      ) : orders === null ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Загружаем заказы…</p>
      ) : visible.length === 0 ? (
        <EmptyState
          eyebrow="Заказы"
          title={tab === "open" ? "Открытых заказов нет" : tab === "assigned" ? "Выданных заказов нет" : tab === "taken" ? "В столы пока ничего не забрали" : "Отменённых нет"}
          description={tab === "open" && canIssue ? "Нажмите «Выдать заказ» — технари получат уведомление." : undefined}
          action={tab === "open" && canIssue ? <Button className="gap-1.5" onClick={() => setIssueOpen(true)}><Plus className="h-4 w-4" /> Выдать заказ</Button> : undefined}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((order) => {
            const mine = order.createdBy === uid;
            const canManage = fullAccess || (canIssue && mine);
            const isAssignee = order.assignedUid === uid;
            const claimed = Boolean(order.claims[uid]);
            const claimants = Object.values(order.claims).sort((a, b) => a.at - b.at);
            const busy = busyId === order.id;
            return (
              <article key={order.id} className={cn("rounded-2xl border bg-card/70 p-4", isAssignee && order.status === "assigned" ? "border-primary/50 shadow-[0_0_0_1px_hsl(var(--primary)/0.2)]" : "border-border/70")}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[15px] font-semibold">{order.client}</span>
                      <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em]", STATUS_TONE[order.status])}>
                        {WORK_ORDER_STATUS_LABELS[order.status]}
                      </span>
                      {order.urgency && order.urgency !== "normal" && (
                        <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]", URGENCY_TONE[order.urgency])}>
                          {WORK_ORDER_URGENCY_LABELS[order.urgency]}
                        </span>
                      )}
                      {isAssignee && order.status === "assigned" && (
                        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">выдан вам</span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {order.osLabel ? `ОС ${order.osLabel} · ` : ""}
                      {order.createdByName} · {timeAgo(order.createdAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {order.price != null && (
                      <span className="tabular font-medium text-foreground">{formatCurrency(order.price)}</span>
                    )}
                    {order.deadline != null && (
                      <span className="inline-flex items-center gap-1 tabular font-medium text-foreground">
                        <CalendarClock className="h-3.5 w-3.5 text-primary" /> до {formatOrderDate(order.deadline)}
                      </span>
                    )}
                    {order.minutes != null && (
                      <span className="inline-flex items-center gap-1 tabular"><Clock3 className="h-3.5 w-3.5" /> {order.minutes} мин</span>
                    )}
                    {order.persons != null && (
                      <span className="inline-flex items-center gap-1 tabular"><Users className="h-3.5 w-3.5" /> {order.persons} перс</span>
                    )}
                    {order.phone && (
                      <a href={`tel:${order.phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1 tabular hover:text-foreground"><Phone className="h-3.5 w-3.5" /> {order.phone}</a>
                    )}
                    {/* Только настоящий http(s)-адрес: «instagram.com/x» без схемы
                        браузер считает относительным и уводит внутрь CRM. */}
                    {parseHttpUrl(order.link) ? (
                      <a
                        href={parseHttpUrl(order.link)!.toString()}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        <Link2 className="h-3.5 w-3.5" /> клиент
                      </a>
                    ) : order.link ? (
                      <span className="inline-flex items-center gap-1" title={order.link}>
                        <Link2 className="h-3.5 w-3.5" /> ссылка без https
                      </span>
                    ) : null}
                  </div>
                </div>

                {order.note && <p className="mt-2 text-sm text-muted-foreground">{order.note}</p>}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {order.status === "open" && (
                    claimants.length > 0 ? (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Hand className="h-3.5 w-3.5 text-primary" />
                        <span className="flex -space-x-1.5">
                          {claimants.slice(0, 5).map((c) => {
                            const m = members.find((x) => x.uid === c.uid);
                            return <MemberAvatar key={c.uid} id={c.uid} name={m?.name ?? c.name} nickname={m?.nickname} photoURL={m?.photoURL} className="h-6 w-6 ring-2 ring-background" />;
                          })}
                        </span>
                        <span>{claimants.map((c) => c.name).join(", ")}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Откликов пока нет</span>
                    )
                  )}
                  {order.status === "assigned" && order.assignedName && (
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <UserCheck className="h-3.5 w-3.5 text-amber-300" /> {order.assignedName}
                      {order.assignedAt ? ` · ${timeAgo(order.assignedAt)}` : ""}
                    </span>
                  )}
                  {order.status === "taken" && (
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Inbox className="h-3.5 w-3.5 text-success" /> {order.assignedName}
                      {/* Ссылка только тому, кто стол реально откроет: ОС и чужой
                          технарь упирались в «нет доступа» — выглядело поломкой. */}
                      {order.takenPageId && canOpenTakenDesk(order.takenPageId) && (
                        <Link to={`/page/${order.takenPageId}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                          открыть стол <ExternalLink className="h-3 w-3" />
                        </Link>
                      )}
                    </span>
                  )}

                  <div className="ml-auto flex flex-wrap gap-1.5">
                    {/* Отклик закрыт, если сегодня выходной / отпросился или
                        уже есть заказ в работе. Отозвать свой старый отклик
                        при этом МОЖНО — иначе он навсегда повиснет на заказе
                        у человека, которого сегодня нет. */}
                    {order.status === "open" && canClaim && myBlockReason && !claimed && (
                      <span className="inline-flex items-center gap-1.5 rounded-lg border border-warning/40 bg-warning/[0.08] px-2.5 py-1 text-[11px] text-warning">
                        Отклик закрыт: {myBlockReason}
                        {/* Отметку ставит руководство, но попросить её можно —
                            запрос живёт в «Графике», туда и ведём. */}
                        {isScheduleBlock && (
                          <Link to="/schedule" className="font-medium underline underline-offset-2 hover:no-underline">
                            попросить отметку
                          </Link>
                        )}
                      </span>
                    )}
                    {order.status === "open" && canClaim && (!myBlockReason || claimed) && (
                      <Button
                        size="sm"
                        variant={claimed ? "outline" : "default"}
                        className="h-8 gap-1.5"
                        disabled={busy}
                        onClick={() =>
                          void withBusy(
                            order.id,
                            async () => {
                              if (!activeWorkspaceId) return;
                              await setOrderClaim(activeWorkspaceId, order, { uid, name: myName }, !claimed);
                            },
                            "Не удалось откликнуться"
                          )
                        }
                      >
                        <Hand className="h-3.5 w-3.5" /> {claimed ? "Отозвать отклик" : "Откликнуться"}
                      </Button>
                    )}
                    {/* Обычно заказ уезжает в стол сам (useOrderAutoPickup), и эта
                        кнопка просто не успевает попасться на глаза. Она нужна
                        для случая, когда автозапись не прошла: нет своего стола
                        или запись упала — тогда видно, что делать. */}
                    {order.status === "assigned" && isAssignee && (
                      <Button size="sm" className="h-8 gap-1.5" disabled={busy || !myDesk} title={myDesk ? undefined : "У вас нет своего стола — заказ некуда положить"} onClick={() => void handleTake(order)}>
                        <Inbox className="h-3.5 w-3.5" /> {myDesk ? "Забрать в стол" : "Нет своего стола"}
                      </Button>
                    )}
                    {canManage && order.status === "open" && (
                      <>
                        <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={busy} onClick={() => setAssignForId(order.id)}>
                          <UserCheck className="h-3.5 w-3.5" /> Выдать…
                        </Button>
                        <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={busy} onClick={() => void withBusy(order.id, () => handleRandom(order), "Не удалось выдать")}>
                          <Shuffle className="h-3.5 w-3.5" /> Рандом
                        </Button>
                      </>
                    )}
                    {canManage && order.status === "assigned" && (
                      <>
                        <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={busy} onClick={() => setAssignForId(order.id)}>
                          <UserCheck className="h-3.5 w-3.5" /> Переназначить
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 gap-1.5"
                          disabled={busy}
                          onClick={() => void withBusy(order.id, () => (activeWorkspaceId ? unassignOrder(activeWorkspaceId, order, { uid, name: myName }) : Promise.resolve()), "Не удалось отозвать")}
                        >
                          <Undo2 className="h-3.5 w-3.5" /> В открытые
                        </Button>
                      </>
                    )}
                    {canManage && (order.status === "open" || order.status === "assigned") && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 gap-1.5 text-muted-foreground"
                        disabled={busy}
                        onClick={async () => {
                          if (!activeWorkspaceId) return;
                          // У выданного заказа технарь мог уже начать заезд:
                          // строка в его столе останется, убрать её мы не
                          // можем — в чужой стол пишет только он сам.
                          if (
                            order.status === "assigned" &&
                            !(await confirmDialog({
                              title: `Отменить заказ «${order.client}»?`,
                              description: `Заказ уже выдан${order.assignedName ? ` (${order.assignedName})` : ""}. Если он успел приехать в стол, строку оттуда уберёт только сам технарь.`,
                            }))
                          )
                            return;
                          void withBusy(order.id, () => setOrderCancelled(activeWorkspaceId, order, true), "Не удалось отменить");
                        }}
                      >
                        <XCircle className="h-3.5 w-3.5" /> Отменить
                      </Button>
                    )}
                    {canManage && order.status === "cancelled" && (
                      <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={busy} onClick={() => void withBusy(order.id, () => (activeWorkspaceId ? setOrderCancelled(activeWorkspaceId, order, false) : Promise.resolve()), "Не удалось вернуть")}>
                        <Undo2 className="h-3.5 w-3.5" /> Вернуть в открытые
                      </Button>
                    )}
                    {canManage && (order.status === "cancelled" || order.status === "taken") && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 gap-1.5 text-muted-foreground hover:text-destructive"
                        disabled={busy}
                        onClick={async () => {
                          if (!activeWorkspaceId) return;
                          if (!(await confirmDialog({ title: `Удалить заказ «${order.client}»?`, description: order.status === "taken" ? "Строка в столе технаря останется." : undefined, destructive: true }))) return;
                          void withBusy(order.id, () => deleteOrder(activeWorkspaceId, order.id), "Не удалось удалить");
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Удалить
                      </Button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <IssueOrderDialog open={issueOpen} onOpenChange={setIssueOpen} myOs={myOs} osOptions={osOptions} onSubmit={handleIssue} />
      <AssignOrderDialog
        order={assignFor}
        onOpenChange={(open) => !open && setAssignForId(null)}
        candidates={assignFor ? candidatesFor(assignFor) : []}
        onAssign={async (c) => {
          if (!assignFor) return;
          await handleAssign(assignFor, c);
        }}
        onRandom={async () => {
          if (!assignFor) return;
          await handleRandom(assignFor);
        }}
      />
    </div>
  );
}
