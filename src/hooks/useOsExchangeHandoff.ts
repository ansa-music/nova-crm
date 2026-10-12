import { useEffect, useRef } from "react";
import { onSnapshot, query, where } from "firebase/firestore";
import { toast } from "@/components/ui/sonner";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { subscribeLiveOrdersFeed, useOrdersBackend } from "@/services/orderStore";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { handOffExchangeOrder, HandoffProblem } from "@/services/rows/osExchange";
import { usesSupabaseRows } from "@/services/rows/rowsBackend";
import { DEFAULT_STATUS_OPTIONS, ensureApprovalStatus, ensureDoneStatus } from "@/utils/columnOptions";
import { firestoreErrorText } from "@/utils/dbError";
import { useSiteConfig } from "@/config/siteTerms";
import { isModuleEnabled } from "@/types/siteConfig";
import type { WorkOrder } from "@/types";

/**
 * Сессия ОС доводит «общий» заказ со своего стола до технаря.
 *
 * ОС выставил заказ со стола на «Заказы» (osSource), технари откликнулись,
 * заказ отдали одному — и тут технарь сам его НЕ забирает: строку-заказ с
 * меткой ОС заводит только ОС (см. services/rows/osExchange). Эта подписка —
 * «мои выставленные заказы, которые уже выданы» (два равенства, составной
 * индекс не нужен), одна на приложение и только у ОС.
 *
 * Выдали, пока ОС не в сети (Тимлид отдал заказ), — заказ висит «Выдан» и
 * уедет к технарю при первом открытии приложения этим ОС.
 *
 * Страховка (жалоба Nurba 13.10.2026: «иногда заказы не доезжают на стол»):
 * сессия настоящего Owner довозит и ЧУЖИЕ такие заказы — от имени ОС, чей это
 * стол, — если за `OWNER_BACKUP_MS` сессия самого ОС этого не сделала (её
 * нет в сети). База пускает Owner писать в любые столы; id копии выводится из
 * строки-источника, так что две сессии разом дубля не дадут.
 */
const OWNER_BACKUP_MS = 20_000;
export function useOsExchangeHandoff() {
  const { profile } = useAuth();
  const permissions = usePermissions();
  const { activeWorkspace, activeWorkspaceId, members, pages: deskPages, osDesks } = useWorkspace();
  // Столы ОС нужны переносу ради ключей столбцов своей строки-источника.
  const pages = [...deskPages, ...osDesks];
  const uid = profile?.uid ?? "";
  const osNickValue = members.find((m) => m.uid === uid)?.osNickValue ?? "";
  const latest = useRef({ pages, members, osNickValue, statusOptions: activeWorkspace?.statusOptions });
  latest.current = { pages, members, osNickValue, statusOptions: activeWorkspace?.statusOptions };
  /** Заказы в работе или уже перенесённые — снимок приходит несколько раз. */
  const handled = useRef(new Set<string>());
  /** О чём уже сказали — чтобы не повторять тост на каждый снимок. */
  const told = useRef(new Set<string>());

  const site = useSiteConfig();
  const backupOwner = permissions.upkeepOwner;
  const enabled = Boolean(
    isModuleEnabled(site, "orders") &&
    isModuleEnabled(site, "osDesk") &&
    db && activeWorkspaceId && uid && permissions.isResolved && (permissions.hasRole("os") || backupOwner) && usesSupabaseRows(activeWorkspaceId)
  );
  /** Чужие выданные заказы, которые Owner довезёт, если ОС не успеет: id → таймер. */
  const backupTimers = useRef(new Map<string, number>());
  const liveAssigned = useRef(new Map<string, WorkOrder>());

  useEffect(() => {
    handled.current = new Set();
    told.current = new Set();
  }, [activeWorkspaceId, uid]);

  const backend = useOrdersBackend(activeWorkspaceId);

  useEffect(() => {
    if (!enabled || !activeWorkspaceId || !backend) return;
    const timers = backupTimers.current;
    const handOff = (order: WorkOrder, osUid: string, osNickValue: string) => {
          handled.current.add(order.id);
          const cur = latest.current;
          void handOffExchangeOrder({
            workspaceId: activeWorkspaceId,
            order,
            osUid,
            osNickValue,
            pages: cur.pages,
            members: cur.members,
            statusOptions: ensureApprovalStatus(ensureDoneStatus(cur.statusOptions ?? DEFAULT_STATUS_OPTIONS)),
          })
            .then(({ techName }) => {
              toast.success(`Заказ «${order.client}» у технаря: ${techName}`, {
                description: osUid === uid ? "Отдан с «Заказов» — ведёте его со своего стола, как обычно." : "Отдан с «Заказов» — довезён за ОС, которого нет в сети.",
              });
            })
            .catch((error) => {
              // Повторим на следующем снимке или при следующем открытии.
              handled.current.delete(order.id);
              const text =
                error instanceof HandoffProblem ? error.message : firestoreErrorText(error, "Не удалось отдать заказ технарю");
              const key = `${order.id}:${text}`;
              if (told.current.has(key)) return;
              told.current.add(key);
              toast.error(`Заказ «${order.client}» не доехал до технаря`, { description: text });
            });
    };
    const onOrders = (orders: WorkOrder[]) => {
      const assigned = new Map<string, WorkOrder>();
      for (const order of orders) {
        if (!order.osSource || !order.assignedUid || order.status !== "assigned") continue;
        assigned.set(order.id, order);
        if (handled.current.has(order.id)) continue;
        if (order.createdBy === uid && permissions.hasRole("os")) {
          handOff(order, uid, latest.current.osNickValue);
          continue;
        }
        if (!backupOwner || timers.has(order.id)) continue;
        // Чужой заказ: даём сессии его ОС довезти самой, потом — за неё.
        timers.set(
          order.id,
          window.setTimeout(() => {
            timers.delete(order.id);
            const still = liveAssigned.current.get(order.id);
            if (!still?.osSource || handled.current.has(order.id)) return;
            const cur = latest.current;
            const desk = cur.pages.find((p) => p.id === still.osSource?.pageId);
            const osUid = desk?.osDesk ? desk.responsibleUserId ?? "" : "";
            const osNick = cur.members.find((m) => m.uid === osUid)?.osNickValue ?? "";
            if (!osUid || !osNick) return;
            handOff(still, osUid, osNick);
          }, OWNER_BACKUP_MS)
        );
      }
      liveAssigned.current = assigned;
      // Заказ ушёл из «выданных» (довёз сам ОС, отозвали) — страховка не нужна.
      for (const [id, timer] of [...timers]) {
        if (assigned.has(id)) continue;
        window.clearTimeout(timer);
        timers.delete(id);
      }
    };
    const stopTimers = () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
    if (backend === "supabase") {
      // Общий поток живых заказов вкладки (оба хранилища).
      const stop = subscribeLiveOrdersFeed(
        activeWorkspaceId,
        (orders, fromCache) => {
          // Решать по неподтверждённому снимку нельзя: заказ мог давно уйти в «В столе».
          if (!fromCache) onOrders(orders);
        },
        (error) => console.error("Выданные заказы ОС не прочитаны:", error)
      );
      return () => {
        stop();
        stopTimers();
      };
    }
    // Owner читает все выданные (одно равенство), ОС — свои.
    const q = backupOwner
      ? query(paths.orders(activeWorkspaceId), where("status", "==", "assigned"))
      : query(paths.orders(activeWorkspaceId), where("createdBy", "==", uid), where("status", "==", "assigned"));
    const stopSnap = onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snap) => {
        // Решать по снимку из кэша нельзя: заказ мог давно уйти в «В столе».
        if (snap.metadata.fromCache) return;
        onOrders(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as WorkOrder));
      },
      (error) => console.error("Подписка на выданные заказы ОС отклонена:", error.code, error.message)
    );
    return () => {
      stopSnap();
      stopTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, activeWorkspaceId, uid, backend, backupOwner]);
}
