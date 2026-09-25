import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { CalendarClock, Clock3, ExternalLink, Hand, Inbox, Link2, Phone, Plus, Shuffle, Trash2, Undo2, UserCheck, Users, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/EmptyState";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { IssueOrderDialog, type IssueOrderForm } from "@/components/orders/IssueOrderDialog";
import { OsDeskIssueDialog } from "@/components/orders/OsDeskIssueDialog";
import { useSendOsRowToExchange } from "@/hooks/useSendOsRowToExchange";
import { osNickLabel } from "@/services/memberService";
import { addOsDeskOrderRow, fetchOsDeskTabRows, openOsDeskCurrentTab } from "@/services/rows/osDeskIssue";
import { DEFAULT_STATUS_OPTIONS, ensureApprovalStatus, ensureDoneStatus } from "@/utils/columnOptions";
import { AssignOrderDialog } from "@/components/orders/AssignOrderDialog";
import { RandomWheelDialog, type WheelCandidate } from "@/components/orders/RandomWheelDialog";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useUrlState } from "@/hooks/useUrlState";
import { deskHref, deskNavState, deskRowHref } from "@/utils/deskLinks";
import { useCurrentPeriodKey } from "@/hooks/useCurrentPeriodKey";
import { useOrderAssignment } from "@/hooks/useOrderAssignment";
import {
  assignOrder,
  countOrdersWithStatus,
  createOrder,
  deleteOrder,
  removeOrderDeskRow,
  fetchOrder,
  fetchOrderHistoryPage,
  isHistoryOrderStatus,
  setOrderCancelled,
  setOrderClaim,
  setOrderClaimScope,
  subscribeOrders,
  type OrderHistoryCursor,
  takeOrderToDesk,
  unassignOrder,
  type HistoryOrderStatus,
  type OrderCandidate,
} from "@/services/orderService";
import { feedOpenOrdersFromPage, releaseOpenOrdersPageFeed } from "@/services/openOrdersPulse";
import { useOrdersBackend } from "@/services/orderStore";
import { firestoreErrorText } from "@/utils/dbError";
import { parseOptionalNumber } from "@/utils/quickOrder";
import { myDisplayName } from "@/utils/displayName";
import { usePersonName } from "@/hooks/usePersonName";
import { formatCurrency } from "@/utils/format";
import { almatyNoonMillis, formatOrderDate, timeAgo } from "@/utils/date";
import { hasFullAccess } from "@/utils/permissions";
import { confirmDialog } from "@/utils/appDialog";
import { parseHttpUrl } from "@/utils/httpUrl";
import { PageHeader, pageChipClass } from "@/components/common/PageHeader";
import { OrdersNotifyBanner } from "@/components/common/BrowserNotifySetting";
import { cn } from "@/utils/cn";
import {
  orderClaimScope,
  scheduleStateOf,
  WORK_ORDER_CLAIM_SCOPE_LABELS,
  WORK_ORDER_STATUS_LABELS,
  WORK_ORDER_URGENCY_LABELS,
  type WorkOrder,
  type WorkOrderClaimScope,
  type WorkOrderStatus,
  type WorkOrderUrgency,
} from "@/types";

const TABS: WorkOrderStatus[] = ["open", "assigned", "taken", "cancelled"];
const HISTORY_TABS: HistoryOrderStatus[] = ["taken", "cancelled"];

type HistoryCounts = Record<HistoryOrderStatus, number | null>;
const UNKNOWN_HISTORY_COUNTS: HistoryCounts = { taken: null, cancelled: null };

/** История: только «В столах» и «Отменённые», без повторов, новые сверху. Свежая версия заказа побеждает. */
function mergeHistory(prev: WorkOrder[], incoming: WorkOrder[]): WorkOrder[] {
  const byId = new Map(prev.map((o) => [o.id, o]));
  for (const order of incoming) {
    if (isHistoryOrderStatus(order.status)) byId.set(order.id, order);
    else byId.delete(order.id);
  }
  return Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt);
}

/** Счётчик чипа, пока он неизвестен (null), не трогаем — иначе «не знаем» превратилось бы в число. */
function bumpHistoryCount(counts: HistoryCounts, status: HistoryOrderStatus, delta: number): HistoryCounts {
  const current = counts[status];
  if (current === null) return counts;
  return { ...counts, [status]: Math.max(0, current + delta) };
}

/**
 * Заказ, появившийся на бирже, считается НОВЫМ, если создан не раньше чем за
 * столько до первого снимка страницы (запас на расхождение часов устройств).
 * Более старый — это заказ, который вернули из отменённых.
 */
const NEW_ORDER_SLACK_MS = 5 * 60_000;

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
 * Подписка на заказы живёт только пока открыта эта страница, и вживую —
 * только открытые и выданные. «В столах» и «Отменённые» — история: она
 * читается разово страницами по 60 при первом заходе на вкладку
 * («Показать ещё» — следующие), а числа на их чипах — серверным подсчётом.
 * Живая подписка на всю коллекцию перечитывала историю при каждом открытии
 * страницы и платила чтение за каждое изменение любого заказа (квота Spark).
 */
export default function OrdersPage() {
  const { profile } = useAuth();
  const permissions = usePermissions();
  const { activeWorkspace, activeWorkspaceId, members, pages, osDesks } = useWorkspace();
  const monthKey = useCurrentPeriodKey();
  const [orders, setOrders] = useState<WorkOrder[] | null>(null);
  // Вкладка — в адресе (`?status=taken`): F5 и ссылка коллеге открывают ту же.
  const [tab, setTab] = useUrlState<WorkOrderStatus>("status", "open", { values: TABS });
  const [issueOpen, setIssueOpen] = useState(false);
  // Храним ID, а не снимок: диалог «Кому отдать» обязан видеть отклики,
  // пришедшие уже после открытия, иначе «Рандом» считает claims пустыми и
  // отдаёт заказ НЕ откликнувшемуся.
  const [assignForId, setAssignForId] = useState<string | null>(null);
  /**
   * Барабан «Рандома». Победитель и пул фиксируются В МОМЕНТ броска и живут
   * здесь: заказ во время вращения уже уезжает в `assigned`, и пересчёт
   * кандидатов по живому снимку опустошил бы колесо на середине.
   */
  const [wheel, setWheel] = useState<{ order: WorkOrder; pool: WheelCandidate[]; winner: OrderCandidate } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [ordersError, setOrdersError] = useState(false);
  /** Список заказов подтверждён сервером (не снимок из кэша на диске). */
  const [ordersSynced, setOrdersSynced] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  /** История («В столах» + «Отменённые»); null — ещё не читали. */
  const [history, setHistory] = useState<WorkOrder[] | null>(null);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  /** Текст отказа первой страницы истории — с кодом, чтобы было видно, что сломалось. */
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyCounts, setHistoryCounts] = useState<HistoryCounts>(UNKNOWN_HISTORY_COUNTS);
  const [historyCountsTick, setHistoryCountsTick] = useState(0);
  /** Для колбэков подписки: она живёт долго и иначе видела бы историю своего первого рендера. */
  const historyRef = useRef<WorkOrder[] | null>(null);
  historyRef.current = history;
  const historyCursorRef = useRef<OrderHistoryCursor | null>(null);
  /** Поколение истории: после смены workspace старые ответы не должны лечь в новую историю. */
  const historyGenRef = useRef(0);
  // Где биржа: Supabase или Firestore; сменилось (SQL накатили) — переподписка
  // и история заново.
  const ordersBackend = useOrdersBackend(activeWorkspaceId);

  const uid = profile?.uid ?? "";
  const myName = myDisplayName(profile, members);
  // Кто выдал / кому отдан — по нику участника сейчас, а не строкой в заказе.
  const nameOf = usePersonName();
  const canIssue = permissions.isResolved && (hasFullAccess(permissions.role) || permissions.hasRole("os"));
  // ОС выдаёт ТОЛЬКО со своего стола (просьба Nurba 24.09.2026): «Выдать
  // заказ» у него — выбор строки стола ОС, а заказ, которого на столе нет,
  // сначала ложится на стол («Новый заказ»). Руководство без роли ОС выдаёт
  // по-старому; Owner/Тимлид + ОС — со стола, а «Выдать без стола» — ссылкой.
  const deskIssuer = canIssue && permissions.hasRole("os");
  const [deskIssueOpen, setDeskIssueOpen] = useState(false);
  const [deskNewOpen, setDeskNewOpen] = useState(false);
  const openIssue = useCallback(() => (deskIssuer ? setDeskIssueOpen(true) : setIssueOpen(true)), [deskIssuer]);
  // Палитра Ctrl+K и нижняя панель шлют «Новый заказ» на /orders#new: открываем
  // диалог выдачи и стираем хэш, чтобы F5 не открывал его снова.
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (location.hash !== "#new" || !canIssue) return;
    openIssue();
    navigate({ pathname: location.pathname, search: location.search }, { replace: true });
  }, [location.hash, location.pathname, location.search, canIssue, navigate, openIssue]);
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

  // График и загрузка столов — для запретов на отклик: «сегодня выходной» /
  // «отпросился» (всегда) и «уже есть заказ в работе» (если заказ открыт
  // только свободным), а у выдающего — для пометок и приоритета «Рандома».
  // Обе подписки живут только пока открыта эта страница (см. лимиты
  // слушателей в CLAUDE.md).
  // График и загрузка столов — для запретов на отклик и для «Кому отдать»:
  // одно место на «Заказы» и стол ОС (useOrderAssignment).
  const {
    technicians,
    deskByUid,
    scheduleByUid,
    inWorkUids,
    todayKey,
    schedulesLoaded,
    schedulesFailed,
    retrySchedules,
    scheduleBlockReasonFor,
    candidatesFor,
    drawRandom,
  } = useOrderAssignment(permissions.isResolved);

  /**
   * Почему технарь не может откликнуться на ЭТОТ заказ. Заказ «в работе»
   * закрывает отклик, только пока заказ открыт «Свободным» (по умолчанию);
   * «Все» — кнопка Owner/Тимлида у заказа — пускает и занятых.
   */
  function claimBlockReasonFor(technicianUid: string, order: WorkOrder): string | null {
    return (
      scheduleBlockReasonFor(technicianUid) ??
      (orderClaimScope(order) === "free" && inWorkUids.has(technicianUid) ? "уже есть заказ в работе" : null)
    );
  }

  /**
   * Кому сказать, что заказ открыли всем: занятым технарям, которые сегодня
   * на смене и ещё не откликнулись, — до этого у них стояло «Отклик закрыт».
   */
  function busyTechniciansToNotify(order: WorkOrder): string[] {
    return technicians
      .filter(
        (m) =>
          m.uid !== uid &&
          inWorkUids.has(m.uid) &&
          !order.claims[m.uid] &&
          scheduleStateOf(scheduleByUid.get(m.uid), todayKey) === "work"
      )
      .map((m) => m.uid);
  }

  async function handleClaimScope(order: WorkOrder, scope: WorkOrderClaimScope) {
    if (!activeWorkspaceId || orderClaimScope(order) === scope) return;
    await setOrderClaimScope({
      workspaceId: activeWorkspaceId,
      order,
      scope,
      actor: { uid, name: myName },
      notifyUids: scope === "all" ? busyTechniciansToNotify(order) : [],
    });
    toast.success(scope === "all" ? `«${order.client}»: откликаются все технари` : `«${order.client}»: откликаются только свободные`);
  }

  // Другой workspace — своя история: старую выбрасываем, ответы в пути отбрасываем.
  useEffect(() => {
    historyGenRef.current += 1;
    historyCursorRef.current = null;
    setHistory(null);
    setHistoryHasMore(false);
    setHistoryLoading(false);
    setHistoryError(null);
    setHistoryCounts(UNKNOWN_HISTORY_COUNTS);
  }, [activeWorkspaceId, ordersBackend]);

  useEffect(() => {
    setOrders(null);
    setOrdersError(false);
    setOrdersSynced(false);
    if (!activeWorkspaceId || !ordersBackend) return;
    const workspaceId = activeWorkspaceId;
    /** Последний снимок, подтверждённый сервером: по разнице с ним видно, кто ушёл с биржи и кто пришёл. */
    let baseline: Map<string, WorkOrder> | null = null;
    let baselineAt = 0;

    /**
     * Заказ ушёл с биржи — забрали в стол, отменили или удалили. Куда именно,
     * подписка не говорит (она видит только живые), поэтому один разовый
     * `getDoc`: одно чтение вместо перечитывания всей истории.
     */
    function onLeftLive(order: WorkOrder) {
      const gen = historyGenRef.current;
      fetchOrder(workspaceId, order.id).then(
        (fresh) => {
          if (gen !== historyGenRef.current || !fresh || !isHistoryOrderStatus(fresh.status)) return;
          const status = fresh.status;
          setHistoryCounts((counts) => bumpHistoryCount(counts, status, 1));
          setHistory((prev) => (prev === null ? prev : mergeHistory(prev, [fresh])));
        },
        (error) => console.error("fetchOrder failed:", error)
      );
    }

    /** Заказ появился на бирже: новый — историю не трогает, вернули из отменённых — убираем оттуда. */
    function onEnteredLive(order: WorkOrder) {
      const was = historyRef.current?.find((o) => o.id === order.id);
      if (was) {
        setHistory((prev) => (prev === null ? prev : prev.filter((o) => o.id !== order.id)));
        if (isHistoryOrderStatus(was.status)) {
          const status = was.status;
          setHistoryCounts((counts) => bumpHistoryCount(counts, status, -1));
        }
        return;
      }
      // Старый заказ вернули на биржу, а в прочитанной истории его нет —
      // откуда он пришёл, не знаем: пересчитываем чипы (два агрегата).
      if (order.createdAt < baselineAt - NEW_ORDER_SLACK_MS) setHistoryCountsTick((tick) => tick + 1);
    }

    const unsubscribe = subscribeOrders(
      workspaceId,
      (rows, fromCache) => {
        setOrdersError(false);
        setOrders(rows);
        setOrdersSynced(!fromCache);
        // Первый снимок может прийти из кэша и не знать о части заказов —
        // «ушёл с биржи» по нему было бы ложным. Считаем только по снимкам,
        // подтверждённым сервером.
        if (fromCache) return;
        // Зелёный пункт «Заказы» кормим отсюда: свой слушатель ему, пока
        // страница открыта, не нужен.
        feedOpenOrdersFromPage(workspaceId, rows.filter((o) => o.status === "open").length);
        const next = new Map(rows.map((o) => [o.id, o]));
        const prev = baseline;
        baseline = next;
        if (!prev) {
          baselineAt = Date.now();
          return;
        }
        for (const [id, order] of prev) if (!next.has(id)) onLeftLive(order);
        for (const [id, order] of next) if (!prev.has(id)) onEnteredLive(order);
      },
      (error) => {
        // Отказ в чтении НЕЛЬЗЯ отдавать как «заказов нет» (см. «Критические
        // уроки» в CLAUDE.md): пустой экран с кнопкой «Выдать заказ»
        // неотличим от пустой биржи, и ОС выдаёт дубль. onSnapshot после
        // ошибки сам не переподключается — нужен явный повтор.
        console.error("subscribeOrders failed:", error);
        releaseOpenOrdersPageFeed(workspaceId);
        setOrdersError(true);
      },
      ordersBackend
    );
    return () => {
      unsubscribe();
      releaseOpenOrdersPageFeed(workspaceId);
    };
  }, [activeWorkspaceId, reloadKey, ordersBackend]);

  // Числа на чипах истории — агрегатом на сервере (одно чтение на тысячу
  // заказов), а не чтением самих заказов. Дальше их двигают переходы на бирже.
  useEffect(() => {
    if (!activeWorkspaceId || !ordersBackend) return;
    const workspaceId = activeWorkspaceId;
    let cancelled = false;
    for (const status of HISTORY_TABS) {
      countOrdersWithStatus(workspaceId, status).then(
        (count) => {
          if (!cancelled) setHistoryCounts((counts) => ({ ...counts, [status]: count }));
        },
        (error) => console.error(`countOrdersWithStatus(${status}) failed:`, error)
      );
    }
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, historyCountsTick, ordersBackend]);

  const historyTab = isHistoryOrderStatus(tab);

  async function loadHistory(more: boolean) {
    if (!activeWorkspaceId) return;
    const workspaceId = activeWorkspaceId;
    const gen = historyGenRef.current;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const page = await fetchOrderHistoryPage(workspaceId, more ? historyCursorRef.current : null);
      if (gen !== historyGenRef.current) return;
      historyCursorRef.current = page.cursor;
      setHistoryHasMore(page.hasMore);
      setHistory((prev) => mergeHistory(more ? (prev ?? []) : [], page.orders));
    } catch (error) {
      if (gen !== historyGenRef.current) return;
      console.error("fetchOrderHistoryPage failed:", error);
      const text = firestoreErrorText(error, "Не удалось загрузить заказы");
      // Уже показанный список не прячем из-за неудачного «Показать ещё».
      if (more) toast.error(text);
      else setHistoryError(text);
    } finally {
      if (gen === historyGenRef.current) setHistoryLoading(false);
    }
  }

  // История читается, только когда на её вкладку зашли, и один раз.
  useEffect(() => {
    if (historyTab && history === null && !historyLoading && historyError === null) void loadHistory(false);
    // loadHistory пересоздаётся каждый рендер — в зависимостях он зациклил бы чтение.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyTab, history, historyLoading, historyError, activeWorkspaceId]);

  const counts = useMemo(() => {
    const c: Record<WorkOrderStatus, number | null> = { open: 0, assigned: 0, ...historyCounts };
    for (const o of orders ?? []) if (o.status === "open" || o.status === "assigned") c[o.status] = (c[o.status] ?? 0) + 1;
    return c;
  }, [orders, historyCounts]);
  const visible = useMemo(
    () => (historyTab ? (history ?? []) : (orders ?? [])).filter((o) => o.status === tab),
    [orders, history, historyTab, tab]
  );
  /** Живой заказ для диалога — он переживает отклики, выдачу и отмену. */
  const assignFor = useMemo(() => (assignForId ? ((orders ?? []).find((o) => o.id === assignForId) ?? null) : null), [orders, assignForId]);

  /** Откроется ли стол, в который уехал заказ, у смотрящего. */
  function canOpenTakenDesk(pageId: string): boolean {
    const page = pages.find((p) => p.id === pageId);
    return Boolean(page) && permissions.canAccessPage(page!);
  }

  /**
   * Выходной и «отпросился» снимает ТОЛЬКО руководство: график — документ
   * Тимлида, и кнопки «вышел на смену» у человека больше нет — поэтому у
   * такого запрета есть ссылка «попросить отметку». «Заказ в работе»
   * снимает кнопка «Все» у заказа.
   */
  const myScheduleBlock = canClaim ? scheduleBlockReasonFor(uid) : null;

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

  const sendOsRowToExchange = useSendOsRowToExchange();
  /**
   * Заказы, открытые или отданные сейчас: строка стола с таким `orderId` уже
   * на «Заказах». Пока список читается (или не прочитался) — null: такие
   * строки не предлагаем, иначе заказ выставился бы второй раз.
   */
  const liveOrderIds = useMemo(
    () =>
      orders === null || ordersError || !ordersSynced
        ? null
        : new Set(orders.filter((o) => o.status === "open" || o.status === "assigned").map((o) => o.id)),
    [orders, ordersError, ordersSynced]
  );

  /** «Новый заказ» у ОС: строкой на свой стол ОС, оттуда — на «Заказы». */
  async function handleDeskNewOrder(form: IssueOrderForm) {
    if (!activeWorkspaceId || !profile) return;
    let placed = false;
    try {
      const tab = await openOsDeskCurrentTab({
        workspaceId: activeWorkspaceId,
        uid: profile.uid,
        name: osNickLabel(myMembership ?? undefined, osOptions) ?? myName,
        osDesks,
        createIfMissing: true,
      });
      if (!tab) throw new Error("Стол ОС не открылся");
      const rows = await fetchOsDeskTabRows(tab);
      const row = await addOsDeskOrderRow({
        tab,
        rows,
        order: {
          client: form.client,
          phone: form.phone,
          price: form.price,
          link: form.link,
          note: form.note,
          persons: parseOptionalNumber(form.persons),
          minutes: parseOptionalNumber(form.minutes),
          deadline: deadlineMillis(form.deadline),
        },
        statusOptions: ensureApprovalStatus(ensureDoneStatus(activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS)),
      });
      placed = true;
      await sendOsRowToExchange({ row, pageId: tab.page.id, tabId: tab.tabId, keys: tab.keys, urgency: form.urgency });
      setTab("open");
      setDeskIssueOpen(false);
      toast.success(`${form.client.trim() || "Заказ"} — на «Заказах»`, {
        description: "Заказ лёг и на ваш стол ОС. Технари получили уведомление.",
      });
    } catch (error) {
      toast.error(
        placed
          ? "Заказ лёг на ваш стол ОС, но на «Заказы» не ушёл — выдайте его со стола или отсюда"
          : firestoreErrorText(error, error instanceof Error ? error.message : "Не удалось завести заказ"),
        placed ? { description: firestoreErrorText(error, error instanceof Error ? error.message : "") } : undefined
      );
      throw error;
    }
  }

  async function handleAssign(order: WorkOrder, candidate: OrderCandidate, opts: { silent?: boolean } = {}) {
    if (!activeWorkspaceId || !profile) return;
    await assignOrder({ workspaceId: activeWorkspaceId, order, technician: { uid: candidate.uid, name: candidate.name }, actorUid: profile.uid, actorName: myName });
    // У барабана результат написан прямо на экране — тост поверх него лишний.
    if (!opts.silent) toast.success(`Заказ выдан: ${candidate.name}`);
  }

  async function handleRandom(order: WorkOrder) {
    const draw = drawRandom(order);
    if (!draw.ok) {
      toast.error(draw.reason);
      return;
    }
    // Дальше показывает барабан — он же и запишет выдачу, параллельно вращению.
    setWheel({ order, pool: draw.pool, winner: draw.winner });
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
            <Button className="min-h-11 gap-1.5 sm:min-h-0" onClick={openIssue}>
              <Plus className="h-4 w-4" /> Выдать заказ
            </Button>
          ) : undefined
        }
        filters={TABS.map((status) => (
          <button key={status} type="button" onClick={() => setTab(status)} className={pageChipClass(tab === status)}>
            {status === "open" ? "Открытые" : status === "assigned" ? "Выданные" : status === "taken" ? "В столах" : "Отменённые"}
            {counts[status] !== null && <span className="tabular-nums text-[10px] opacity-80">{counts[status]}</span>}
          </button>
        ))}
      />

      {canClaim && <OrdersNotifyBanner className="mb-4" />}

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

      {historyTab && history === null && historyError !== null ? (
        <EmptyState
          eyebrow="Заказы"
          title="Не удалось загрузить заказы"
          description={`Список не прочитался — это не значит, что заказов нет. ${historyError}`}
          action={
            <Button variant="outline" onClick={() => setHistoryError(null)}>
              Повторить
            </Button>
          }
        />
      ) : !historyTab && ordersError ? (
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
      ) : (historyTab ? history === null : orders === null) ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Загружаем заказы…</p>
      ) : visible.length === 0 ? (
        <EmptyState
          eyebrow="Заказы"
          title={
            tab === "open"
              ? "Открытых заказов нет"
              : tab === "assigned"
                ? "Выданных заказов нет"
                : historyHasMore
                  ? tab === "taken"
                    ? "Среди последних заказов в столы ничего не забрали"
                    : "Среди последних заказов отменённых нет"
                  : tab === "taken"
                    ? "В столы пока ничего не забрали"
                    : "Отменённых нет"
          }
          description={tab === "open" && canIssue ? "Нажмите «Выдать заказ» — технари получат уведомление." : undefined}
          action={
            tab === "open" && canIssue ? (
              <Button className="gap-1.5" onClick={() => setIssueOpen(true)}>
                <Plus className="h-4 w-4" /> Выдать заказ
              </Button>
            ) : historyTab && historyHasMore ? (
              <Button variant="outline" className="min-h-11 sm:min-h-0" disabled={historyLoading} onClick={() => void loadHistory(true)}>
                {historyLoading ? "Загружаем…" : "Показать ещё"}
              </Button>
            ) : undefined
          }
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
            const claimScope = orderClaimScope(order);
            const myBlockReason = canClaim ? claimBlockReasonFor(uid, order) : null;
            const isScheduleBlock = Boolean(myScheduleBlock);
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
                      {order.status === "open" && claimScope === "all" && (
                        <span
                          className="rounded-full border border-sky-400/40 bg-sky-400/10 px-2 py-0.5 text-[10px] font-medium text-sky-200"
                          title="Откликнуться могут все технари, даже с заказом в работе"
                        >
                          откликаются все
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {order.osLabel ? `ОС ${order.osLabel} · ` : ""}
                      {nameOf(order.createdBy, order.createdByName)} · {timeAgo(order.createdAt)}
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
                        <span>{claimants.map((c) => nameOf(c.uid, c.name)).join(", ")}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Откликов пока нет</span>
                    )
                  )}
                  {order.status === "assigned" && order.assignedName && (
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <UserCheck className="h-3.5 w-3.5 text-amber-300" /> {nameOf(order.assignedUid, order.assignedName)}
                      {order.assignedAt ? ` · ${timeAgo(order.assignedAt)}` : ""}
                    </span>
                  )}
                  {order.status === "taken" && (
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Inbox className="h-3.5 w-3.5 text-success" /> {nameOf(order.assignedUid, order.assignedName)}
                      {/* Ссылка только тому, кто стол реально откроет: ОС и чужой
                          технарь упирались в «нет доступа» — выглядело поломкой. */}
                      {order.takenPageId && canOpenTakenDesk(order.takenPageId) && (
                        <Link
                          // Сразу на вкладку и строку заказа, а не на стол в целом.
                          to={
                            order.takenRowId
                              ? deskRowHref(order.takenPageId, order.takenSubPageId, order.takenRowId)
                              : deskHref(order.takenPageId, order.takenSubPageId)
                          }
                          state={deskNavState({ to: "/orders?status=taken", label: "Заказы" })}
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          открыть стол <ExternalLink className="h-3 w-3" />
                        </Link>
                      )}
                    </span>
                  )}

                  <div className="ml-auto flex flex-wrap gap-1.5">
                    {/* Отклик закрыт, если сегодня выходной / отпросился или —
                        пока заказ открыт «Свободным» — уже есть заказ в работе.
                        Отозвать свой старый отклик при этом МОЖНО — иначе он
                        навсегда повиснет на заказе у человека, которого сегодня
                        нет. */}
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
                    {/* Заказ со стола ОС технарь сам не забирает: строку-заказ
                        с замком заводит ОС (useOsExchangeHandoff). */}
                    {order.status === "assigned" && order.osSource && (
                      <span className="text-xs text-muted-foreground">
                        {isAssignee ? "Приедет в ваш стол от ОС" : "Уедет к технарю от ОС"}
                        {order.createdByName ? ` (${nameOf(order.createdBy, order.createdByName)})` : ""}, как только тот будет в сети
                      </span>
                    )}
                    {order.status === "assigned" && isAssignee && !order.osSource && (
                      <Button size="sm" className="h-8 gap-1.5" disabled={busy || !myDesk} title={myDesk ? undefined : "У вас нет своего стола — заказ некуда положить"} onClick={() => void handleTake(order)}>
                        <Inbox className="h-3.5 w-3.5" /> {myDesk ? "Забрать в стол" : "Нет своего стола"}
                      </Button>
                    )}
                    {/* «Свободные / Все» — кто может откликнуться. Постоянно у
                        каждого открытого заказа — у Owner, Тимлида и всех ОС
                        (и у чужого заказа тоже): быстро открыть заказ и
                        занятым, когда свободных нет. */}
                    {canIssue && order.status === "open" && (
                      <div
                        role="radiogroup"
                        aria-label="Кто может откликнуться"
                        title="Кто может откликнуться: только свободные (без заказа в работе) или все технари"
                        className="inline-flex h-8 items-center rounded-lg border border-border bg-background/40 p-0.5"
                      >
                        {(["free", "all"] as const).map((scope) => (
                          <button
                            key={scope}
                            type="button"
                            role="radio"
                            aria-checked={claimScope === scope}
                            disabled={busy}
                            onClick={() => void withBusy(order.id, () => handleClaimScope(order, scope), "Не удалось переключить")}
                            className={cn(
                              "h-full rounded-md px-2.5 text-[12px] font-medium transition-colors disabled:opacity-60",
                              claimScope === scope
                                ? scope === "all"
                                  ? "bg-sky-400/15 text-sky-200"
                                  : "bg-primary/15 text-primary"
                                : "text-muted-foreground hover:text-foreground"
                            )}
                          >
                            {WORK_ORDER_CLAIM_SCOPE_LABELS[scope]}
                          </button>
                        ))}
                      </div>
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
                              description: `Заказ уже выдан${order.assignedName ? ` (${nameOf(order.assignedUid, order.assignedName)})` : ""}. Если он успел приехать в стол, строку оттуда уберёт только сам технарь.`,
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
                          const inDesk = Boolean(order.takenPageId);
                          if (
                            !(await confirmDialog({
                              title: `Удалить заказ «${order.client}»?`,
                              description: inDesk ? "Строка в столе технаря удалится вместе с ним." : undefined,
                              destructive: true,
                            }))
                          )
                            return;
                          void withBusy(
                            order.id,
                            async () => {
                              // Сначала строка у технаря, потом заказ: право убрать её
                              // правило берёт из самого заказа, и без него строка
                              // осталась бы в столе навсегда.
                              if (inDesk) {
                                try {
                                  await removeOrderDeskRow(
                                    activeWorkspaceId,
                                    order,
                                    permissions.hasFullDeskAccess || order.createdBy === profile?.uid
                                  );
                                } catch (error) {
                                  const anyway = await confirmDialog({
                                    title: "Строку у технаря убрать не удалось",
                                    description: `${firestoreErrorText(error, error instanceof Error && error.message ? error.message : "Ошибка базы")}. Удалить заказ всё равно? Строку тогда уберёт Owner.`,
                                    destructive: true,
                                  });
                                  if (!anyway) return;
                                }
                              }
                              await deleteOrder(activeWorkspaceId, order);
                              // История не живая — убираем удалённый сами, и из счётчика чипа тоже.
                              setHistory((prev) => (prev === null ? prev : prev.filter((o) => o.id !== order.id)));
                              if (isHistoryOrderStatus(order.status)) {
                                const status = order.status;
                                setHistoryCounts((c) => bumpHistoryCount(c, status, -1));
                              }
                            },
                            "Не удалось удалить"
                          );
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
          {historyTab && historyHasMore && (
            <Button
              variant="outline"
              className="min-h-11 self-center sm:min-h-0"
              disabled={historyLoading}
              onClick={() => void loadHistory(true)}
            >
              {historyLoading ? "Загружаем…" : "Показать ещё"}
            </Button>
          )}
        </div>
      )}

      <IssueOrderDialog open={issueOpen} onOpenChange={setIssueOpen} myOs={myOs} osOptions={osOptions} onSubmit={handleIssue} />
      {deskIssuer ? (
        <>
          <OsDeskIssueDialog
            open={deskIssueOpen}
            onOpenChange={setDeskIssueOpen}
            liveOrderIds={liveOrderIds}
            onNewOrder={() => setDeskNewOpen(true)}
            onWithoutDesk={
              fullAccess
                ? () => {
                    setDeskIssueOpen(false);
                    setIssueOpen(true);
                  }
                : undefined
            }
            onIssued={() => setTab("open")}
          />
          <IssueOrderDialog
            open={deskNewOpen}
            onOpenChange={setDeskNewOpen}
            myOs={myOs}
            osOptions={osOptions}
            onSubmit={handleDeskNewOrder}
            fromDesk
          />
        </>
      ) : null}
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
      <RandomWheelDialog
        pool={wheel?.pool ?? []}
        winnerUid={wheel?.winner.uid ?? null}
        orderClient={wheel?.order.client ?? ""}
        onAssign={async () => {
          if (!wheel) return;
          await handleAssign(wheel.order, wheel.winner, { silent: true });
        }}
        onClose={() => setWheel(null)}
      />
    </div>
  );
}
