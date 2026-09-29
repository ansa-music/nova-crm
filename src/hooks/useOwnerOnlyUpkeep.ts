import { useEffect, useMemo, useRef } from "react";
import { onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { subscribeLiveOrdersFeed, useOrdersBackend } from "@/services/orderStore";
import { OrderNotAssignedError, OrderOfflineError, takeOrderToDesk } from "@/services/orderService";
import { refreshDeskLoadFromRows } from "@/services/deskLoadService";
import { reconcileOwnerOnlyDesks } from "@/services/deskOwnerOnly";
import { currentMonthSubPageId, isMonthlyDesk } from "@/services/monthTabService";
import { enqueuePickup } from "@/hooks/useOrderAutoPickup";
import { useDeskLoads } from "@/hooks/useDeskLoads";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useCurrentPeriodKey } from "@/hooks/useCurrentPeriodKey";
import { isRowsMigratingError } from "@/utils/dbError";
import { displayNameOf, myDisplayName } from "@/utils/displayName";
import { toast } from "@/components/ui/sonner";
import { useSiteConfig } from "@/config/siteTerms";
import { isModuleEnabled } from "@/types/siteConfig";
import type { Workspace, WorkOrder, WorkspaceMember, WorkspacePage } from "@/types";

/** Первый пересчёт закрытых столов — через 20 с после входа, дальше раз в 10 минут на виду. */
const RECOUNT_FIRST_MS = 20_000;
const RECOUNT_EVERY_MS = 10 * 60_000;
/** Сверка флага «только для Owner» в базе — при загрузке и раз в 30 минут. */
const RECONCILE_FIRST_MS = 5_000;
const RECONCILE_EVERY_MS = 30 * 60_000;
/** Заезд за технаря не прошёл — повтор не раньше чем через 2 минуты (снимки идут чаще). */
const PICKUP_RETRY_MS = 2 * 60_000;

function isOwnerUid(uid: string, workspace: Workspace | null | undefined, members: WorkspaceMember[]): boolean {
  if (workspace?.ownerId === uid) return true;
  return members.find((m) => m.uid === uid)?.role === "owner";
}

/** Стол технаря — тот же выбор, что у его автозаезда (useOrderAutoPickup). */
function techDeskOf(pages: WorkspacePage[], uid: string): WorkspacePage | null {
  return pages.find((p) => p.responsibleUserId === uid && !p.osDesk) ?? null;
}

/**
 * Обслуживание столов «только для Owner» из сессии Owner (по НАСТОЯЩЕЙ роли).
 * Технарь свой закрытый стол не открывает и не пишет в него — поэтому то, что
 * обычно делает его сессия, здесь делает Owner:
 *  - кладёт выданные технарю заказы в его закрытый стол (как его автозаезд);
 *  - раз в 10 минут пересчитывает счётчики закрытых столов — рейтинги и
 *    «Технари» не должны застывать;
 *  - раз в 30 минут дописывает флаг в базу, если стол помечен только в
 *    документе (reconcileOwnerOnlyDesks — только поднимает).
 * Нет ни одного закрытого стола — хук ничего не делает и ничего не читает.
 */
export function useOwnerOnlyUpkeep() {
  const { profile } = useAuth();
  const permissions = usePermissions();
  const { activeWorkspace, activeWorkspaceId, members, pages, allPages } = useWorkspace();
  const monthKey = useCurrentPeriodKey();
  const ordersOn = isModuleEnabled(useSiteConfig(), "orders");
  const uid = profile?.uid ?? "";
  const owner = Boolean(permissions.upkeepOwner && permissions.isResolved && uid && activeWorkspaceId && db);

  const latestRef = useRef({ workspace: activeWorkspace, members, pages, allPages, monthKey, profile });
  latestRef.current = { workspace: activeWorkspace, members, pages, allPages, monthKey, profile };

  // Закрытые столы технарей, за которых кладёт заказы Owner: ответственный —
  // не Owner (Owner пишет в свой стол сам) и это его основной стол.
  const hiddenTechKey = useMemo(() => {
    if (!owner) return "";
    return pages
      .filter((p) => {
        if (!p.ownerOnly || p.osDesk || !p.responsibleUserId) return false;
        if (isOwnerUid(p.responsibleUserId, activeWorkspace, members)) return false;
        return techDeskOf(pages, p.responsibleUserId)?.id === p.id;
      })
      .map((p) => `${p.id}:${p.responsibleUserId}`)
      .join("|");
  }, [owner, pages, members, activeWorkspace]);

  // Закрытые месячные столы — их счётчики пересчитывает Owner.
  const hiddenDesksKey = useMemo(() => {
    if (!owner) return "";
    return pages
      .filter((p) => p.ownerOnly && !p.osDesk && p.responsibleUserId && isMonthlyDesk(p, members))
      .map((p) => `${p.id}:${currentMonthSubPageId(p, monthKey) ?? ""}`)
      .join("|");
  }, [owner, pages, members, monthKey]);

  // Набор закрытых столов: новый закрытый стол — сверка сразу, а не через 30 минут.
  const ownerOnlyIdsKey = owner
    ? allPages
        .filter((p) => p.ownerOnly === true)
        .map((p) => p.id)
        .sort()
        .join("|")
    : "";

  // ---- (а) заезд заказа за технаря в его закрытый стол ----
  const handledRef = useRef<Set<string>>(new Set());
  const failedAtRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    handledRef.current = new Set();
    failedAtRef.current = new Map();
  }, [activeWorkspaceId, uid]);

  const backend = useOrdersBackend(activeWorkspaceId);
  const pickupOn = Boolean(owner && ordersOn && hiddenTechKey);

  useEffect(() => {
    if (!pickupOn || !activeWorkspaceId || !backend) return;
    const ws = activeWorkspaceId;
    // Последний список живых заказов — чтобы повторить неудачный заезд по
    // таймеру: в тихом workspace новых снимков может не быть часами.
    let lastOrders: WorkOrder[] = [];
    let retryTimer: number | null = null;
    let stopped = false;
    const scheduleRetry = () => {
      if (retryTimer !== null || stopped) return;
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        if (!stopped) onOrders(lastOrders);
      }, PICKUP_RETRY_MS + 1_000);
    };
    const onOrders = (orders: WorkOrder[]) => {
      lastOrders = orders;
      const latest = latestRef.current;
      for (const order of orders) {
        const assigneeUid = order.assignedUid;
        if (order.status !== "assigned" || !assigneeUid || order.osSource) continue;
        // Свой заказ Owner кладёт сам — его автозаезд.
        if (assigneeUid === uid) continue;
        const desk = techDeskOf(latest.pages, assigneeUid);
        if (!desk?.ownerOnly) continue;
        if (isOwnerUid(assigneeUid, latest.workspace, latest.members)) continue;
        if (handledRef.current.has(order.id)) continue;
        const failedAt = failedAtRef.current.get(order.id);
        if (failedAt && Date.now() - failedAt < PICKUP_RETRY_MS) continue;
        handledRef.current.add(order.id);
        const assignee = latest.members.find((m) => m.uid === assigneeUid);
        const techName = assignee ? displayNameOf(assignee) : desk.name;
        void enqueuePickup(() =>
          takeOrderToDesk({
            workspaceId: ws,
            order,
            page: desk,
            workspace: latest.workspace,
            members: latest.members,
            monthKey: latestRef.current.monthKey,
            me: { uid, name: myDisplayName(latest.profile, latest.members) },
            assigneeUid,
          })
        )
          .then(() => {
            failedAtRef.current.delete(order.id);
            toast.success(`Заказ «${order.client}» положен в закрытый стол технаря · ${techName}`);
          })
          .catch((error) => {
            // Заказ уже не ждёт этого технаря (забран, передан, отменён) —
            // молчим, но id отпускаем: переназначенный заказ придёт новым
            // снимком, и его надо положить уже в стол нового технаря.
            if (error instanceof OrderNotAssignedError) {
              handledRef.current.delete(order.id);
              return;
            }
            // Нет связи или идёт перенос строк — повторит следующий снимок.
            if (error instanceof OrderOfflineError || isRowsMigratingError(error)) {
              handledRef.current.delete(order.id);
              return;
            }
            handledRef.current.delete(order.id);
            const first = !failedAtRef.current.has(order.id);
            failedAtRef.current.set(order.id, Date.now());
            console.error("Не удалось положить заказ в закрытый стол:", error);
            scheduleRetry();
            if (first) {
              toast.error(`Заказ «${order.client}» не доехал в закрытый стол технаря · ${techName}`, {
                description: "Повторим сами через пару минут. Стол технаря закрыт Owner — сам технарь заказ не заберёт.",
              });
            }
          });
      }
    };
    const stopTimers = () => {
      stopped = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
    if (backend === "supabase") {
      const stop = subscribeLiveOrdersFeed(
        ws,
        (orders, fromCache) => {
          if (!fromCache) onOrders(orders);
        },
        (error) => console.error("Заказы для закрытых столов не прочитаны:", error)
      );
      return () => {
        stopTimers();
        stop();
      };
    }
    const q = query(paths.orders(ws), where("status", "==", "assigned"));
    const stop = onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snap) => {
        if (snap.metadata.fromCache) return;
        onOrders(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as WorkOrder));
      },
      (error) => console.error("Подписка на заказы для закрытых столов отклонена:", error.code, error.message)
    );
    return () => {
      stopTimers();
      stop();
    };
    // Остальное читается из latestRef в момент записи.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickupOn, activeWorkspaceId, uid, backend]);

  // ---- (б) счётчики закрытых столов: их никто, кроме Owner, не публикует ----
  const countersOn = Boolean(owner && hiddenDesksKey);
  const { loads, synced, loadsBackend } = useDeskLoads(activeWorkspaceId, countersOn);
  const loadsRef = useRef(loads);
  loadsRef.current = loads;
  const loadsReady = loads !== null && synced && loadsBackend !== null;

  useEffect(() => {
    if (!countersOn || !loadsReady || !loadsBackend || !activeWorkspaceId || !uid) return;
    let running = false;
    let stopped = false;
    const recount = async () => {
      if (running || stopped) return;
      running = true;
      try {
        const latest = latestRef.current;
        const desks = latest.pages.filter(
          (p) => p.ownerOnly && !p.osDesk && p.responsibleUserId && isMonthlyDesk(p, latest.members)
        );
        for (const desk of desks) {
          if (stopped) return;
          if (!currentMonthSubPageId(desk, latest.monthKey)) continue;
          try {
            await refreshDeskLoadFromRows(
              desk,
              latest.monthKey,
              uid,
              loadsRef.current?.find((l) => l.pageId === desk.id),
              latest.workspace?.responsibleOptions ?? [],
              loadsBackend
            );
          } catch (error) {
            console.warn(`[owner-only] счётчики закрытого стола ${desk.id} не пересчитаны`, error);
          }
        }
      } finally {
        running = false;
      }
    };
    const first = window.setTimeout(() => void recount(), RECOUNT_FIRST_MS);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void recount();
    }, RECOUNT_EVERY_MS);
    return () => {
      stopped = true;
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [countersOn, loadsReady, loadsBackend, activeWorkspaceId, uid, hiddenDesksKey]);

  // ---- (в) флаг в базе догоняет документ стола ----
  useEffect(() => {
    if (!ownerOnlyIdsKey || !activeWorkspaceId) return;
    const ws = activeWorkspaceId;
    let stopped = false;
    const reconcile = () => {
      reconcileOwnerOnlyDesks(ws, latestRef.current.allPages)
        .then((fixed) => {
          if (!stopped && fixed) console.warn(`[owner-only] закрытые столы дописаны в базу: ${fixed}`);
        })
        .catch((error) => console.warn("[owner-only] сверка закрытых столов не прошла", error));
    };
    const first = window.setTimeout(reconcile, RECONCILE_FIRST_MS);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") reconcile();
    }, RECONCILE_EVERY_MS);
    return () => {
      stopped = true;
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [ownerOnlyIdsKey, activeWorkspaceId]);
}
