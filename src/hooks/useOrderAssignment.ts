import { useCallback, useMemo } from "react";
import { useCurrentMonthKey } from "@/hooks/useCurrentMonthKey";
import { useCurrentPeriodKey } from "@/hooks/useCurrentPeriodKey";
import { useDeskLoads, useTechSchedules } from "@/hooks/useDeskLoads";
import { useWorkspace } from "@/hooks/useWorkspace";
import { currentMonthSubPageId } from "@/services/monthTabService";
import { customRandomPool, orderRandomPool, pickWeighted, randomPoolProblem, type OrderCandidate } from "@/services/orderService";
import { DEFAULT_STATUS_OPTIONS } from "@/utils/columnOptions";
import { ymdInTimeZone } from "@/utils/date";
import { displayNameOf } from "@/utils/displayName";
import { currentBusyUids, currentOrderCounts, effectiveTechLoadKinds } from "@/utils/techLoad";
import {
  memberHasRole,
  orderClaimScope,
  randomSettingsOf,
  randomWeightOf,
  scheduleDayKey,
  scheduleStateOf,
  type TechSchedule,
  type WorkOrder,
  type WorkspaceMember,
} from "@/types";

export type AssignCandidate = OrderCandidate & { member: WorkspaceMember; deskName: string | null };

export type RandomDraw =
  | { ok: true; pool: OrderCandidate[]; winner: OrderCandidate }
  | { ok: false; reason: string };

/**
 * Кому можно отдать заказ: технари, их столы, отклики, занятость и график.
 *
 * Одно место на «Заказы» и на стол ОС («Отклики» в ячейке «Технарь») — два
 * списка кандидатов с разными правилами «занят/выходной» показали бы на
 * двух экранах разное и «Рандом» тянул бы из разных пулов.
 *
 * Подписки на график и загрузку столов живут, только пока `enabled`
 * (страница «Заказы» или открытое окно выбора): лишние постоянные слушатели
 * на Spark ни к чему.
 */
export function useOrderAssignment(enabled: boolean) {
  const { activeWorkspace, activeWorkspaceId, members, pages } = useWorkspace();
  // График — по календарному месяцу, счётчики столов — по периоду.
  const scheduleMonthKey = useCurrentMonthKey();
  const monthKey = useCurrentPeriodKey();
  const {
    schedules,
    loaded: schedulesLoaded,
    failed: schedulesFailed,
    retry: retrySchedules,
  } = useTechSchedules(activeWorkspaceId, scheduleMonthKey, enabled);
  const { loads } = useDeskLoads(activeWorkspaceId, enabled);
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

  /** Заказов за текущий период у каждого — для коэффициента «меньше заказов — выше шанс». */
  const orderCounts = useMemo(
    () =>
      currentOrderCounts({
        pages,
        loads: loads ?? [],
        monthKey,
        currentTabOf: (page) => currentMonthSubPageId(page, monthKey),
      }),
    [pages, loads, monthKey]
  );
  const randomSettings = useMemo(() => randomSettingsOf(activeWorkspace), [activeWorkspace]);

  /**
   * Вес технаря в конкретном пуле (шансы Owner): личный множитель и
   * «меньше заказов — выше шанс» относительно остальных в ЭТОМ пуле.
   */
  const weightFor = useCallback(
    (poolUids: readonly string[]) => (uid: string) => randomWeightOf(uid, randomSettings, orderCounts, poolUids),
    [randomSettings, orderCounts]
  );

  /** Выходной и «отпросился» закрывают отклик на ЛЮБОЙ заказ. */
  const scheduleBlockReasonFor = useCallback(
    (technicianUid: string): string | null => {
      const state = scheduleStateOf(scheduleByUid.get(technicianUid), todayKey);
      if (state === "off") return "сегодня выходной";
      if (state === "excused") return "отпросился";
      return null;
    },
    [scheduleByUid, todayKey]
  );

  /** Для выдачи: график плюс «уже есть заказ в работе» — предупреждение и приоритет «Рандома», не запрет. */
  const blockReasonFor = useCallback(
    (technicianUid: string): string | null =>
      scheduleBlockReasonFor(technicianUid) ?? (inWorkUids.has(technicianUid) ? "уже есть заказ в работе" : null),
    [scheduleBlockReasonFor, inWorkUids]
  );

  const technicians = useMemo(
    () => members.filter((m) => m.status === "active" && Boolean(m.uid) && memberHasRole(m, "manager")),
    [members]
  );
  const deskByUid = useMemo(() => {
    const map = new Map<string, string>();
    for (const page of pages) if (page.responsibleUserId) map.set(page.responsibleUserId, page.name);
    return map;
  }, [pages]);

  const candidatesFor = useCallback(
    (order: WorkOrder): AssignCandidate[] =>
      technicians.map((m) => ({
        uid: m.uid,
        name: displayNameOf(m),
        hasDesk: deskByUid.has(m.uid),
        claimedAt: order.claims?.[m.uid]?.at ?? null,
        blockedReason: blockReasonFor(m.uid),
        absentToday: scheduleStateOf(scheduleByUid.get(m.uid), todayKey) !== "work",
        member: m,
        deskName: deskByUid.get(m.uid) ?? null,
      })),
    [technicians, deskByUid, blockReasonFor, scheduleByUid, todayKey]
  );

  /** Кто попадает в пул «Рандома» по откликам (без весов — ×0 отсекается ниже). */
  const randomPoolFor = useCallback(
    (order: WorkOrder, candidates: OrderCandidate[] = candidatesFor(order)): OrderCandidate[] => {
      const base = orderRandomPool(candidates, orderClaimScope(order));
      const weightOf = weightFor(base.map((c) => c.uid));
      return base.filter((c) => weightOf(c.uid) > 0);
    },
    [candidatesFor, weightFor]
  );

  /**
   * Бросок «Рандома»: по живым откликам или, с `uids`, «Своя рулетка» среди
   * выбранных. До первого снимка графика «кто сегодня отсутствует» неизвестен,
   * и случайный выбор мог бы достаться выходному; при отказе чтения — не
   * держим, иначе «Рандом» умер бы совсем. Победитель — по шансам Owner.
   */
  const drawRandom = useCallback(
    (order: WorkOrder, opts?: { uids?: readonly string[] }): RandomDraw => {
      if (!schedulesLoaded && !schedulesFailed) return { ok: false, reason: "График ещё загружается — попробуйте через секунду" };
      const candidates = candidatesFor(order);
      let pool: OrderCandidate[];
      if (opts?.uids) {
        const chosen = customRandomPool(candidates, opts.uids);
        const weightOf = weightFor(chosen.map((c) => c.uid));
        pool = chosen.filter((c) => weightOf(c.uid) > 0);
        if (pool.length === 0) {
          return {
            ok: false,
            reason: chosen.length > 0 ? "У выбранных шанс ×0 в настройках «Рандома»" : "Отметьте хотя бы двоих со столом, кто сегодня на смене",
          };
        }
      } else {
        pool = randomPoolFor(order, candidates);
        if (pool.length === 0) {
          const scope = orderClaimScope(order);
          const reason =
            randomPoolProblem(candidates, scope) ?? "У откликнувшихся шанс ×0 в настройках «Рандома» — выдайте вручную";
          return { ok: false, reason };
        }
      }
      const winner = pickWeighted(pool, weightFor(pool.map((c) => c.uid)));
      if (!winner) return { ok: false, reason: "Некому выдать" };
      return { ok: true, pool, winner };
    },
    [schedulesLoaded, schedulesFailed, candidatesFor, randomPoolFor, weightFor]
  );

  return {
    technicians,
    deskByUid,
    scheduleByUid,
    inWorkUids,
    todayKey,
    schedulesLoaded,
    schedulesFailed,
    retrySchedules,
    scheduleBlockReasonFor,
    blockReasonFor,
    candidatesFor,
    randomPoolFor,
    weightFor,
    orderCounts,
    randomSettings,
    drawRandom,
  };
}
