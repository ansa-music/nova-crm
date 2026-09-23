import { useEffect, useRef } from "react";
import { onSnapshot, query, where } from "firebase/firestore";
import { toast } from "@/components/ui/sonner";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { handOffExchangeOrder, HandoffProblem } from "@/services/rows/osExchange";
import { usesSupabaseRows } from "@/services/rows/rowsBackend";
import { DEFAULT_STATUS_OPTIONS, ensureApprovalStatus, ensureDoneStatus } from "@/utils/columnOptions";
import { firestoreErrorText } from "@/utils/dbError";
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
 */
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

  const enabled = Boolean(
    db && activeWorkspaceId && uid && permissions.isResolved && permissions.hasRole("os") && usesSupabaseRows(activeWorkspaceId)
  );

  useEffect(() => {
    handled.current = new Set();
    told.current = new Set();
  }, [activeWorkspaceId, uid]);

  useEffect(() => {
    if (!enabled || !activeWorkspaceId) return;
    const q = query(paths.orders(activeWorkspaceId), where("createdBy", "==", uid), where("status", "==", "assigned"));
    return onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snap) => {
        // Решать по снимку из кэша нельзя: заказ мог давно уйти в «В столе».
        if (snap.metadata.fromCache) return;
        for (const docSnap of snap.docs) {
          const order = { id: docSnap.id, ...docSnap.data() } as WorkOrder;
          if (!order.osSource || !order.assignedUid || order.status !== "assigned") continue;
          if (handled.current.has(order.id)) continue;
          handled.current.add(order.id);
          const cur = latest.current;
          void handOffExchangeOrder({
            workspaceId: activeWorkspaceId,
            order,
            osUid: uid,
            osNickValue: cur.osNickValue,
            pages: cur.pages,
            members: cur.members,
            statusOptions: ensureApprovalStatus(ensureDoneStatus(cur.statusOptions ?? DEFAULT_STATUS_OPTIONS)),
          })
            .then(({ techName }) => {
              toast.success(`Заказ «${order.client}» у технаря: ${techName}`, {
                description: "Отдан с «Заказов» — ведёте его со своего стола, как обычно.",
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
        }
      },
      (error) => console.error("Подписка на выданные заказы ОС отклонена:", error.code, error.message)
    );
  }, [enabled, activeWorkspaceId, uid]);
}
