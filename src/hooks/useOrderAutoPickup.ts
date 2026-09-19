import { useEffect, useRef } from "react";
import { onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { takeOrderToDesk } from "@/services/orderService";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useCurrentMonthKey } from "@/hooks/useCurrentMonthKey";
import { displayNameOf } from "@/utils/displayName";
import { toast } from "@/components/ui/sonner";
import type { WorkOrder } from "@/types";

/**
 * Заказ, выданный технарю, сам ложится в его стол.
 *
 * Пишет строку именно сессия технаря: в чужой стол не может писать никто,
 * кроме Owner и самого ответственного (firestore.rules → canEditPage), так
 * что «автоматически» здесь означает «без единого действия руками, как
 * только приложение технаря открыто». Если он в этот момент не в сети,
 * заказ приедет при первом же открытии — статус `assigned` ждёт его в базе.
 *
 * Слушатель один на сессию и только у технаря со столом: `assignedUid == me`
 * — это его собственные заказы, их единицы (лимиты listener'ов на Spark, см.
 * CLAUDE.md). Статус фильтруется на клиенте, чтобы не заводить составной
 * индекс ради второго равенства.
 */
export function useOrderAutoPickup() {
  const { profile } = useAuth();
  const permissions = usePermissions();
  const { activeWorkspace, activeWorkspaceId, members, pages } = useWorkspace();
  const monthKey = useCurrentMonthKey();
  /** Заказы, по которым запись уже идёт или прошла — снапшот прилетает несколько раз. */
  const handledRef = useRef<Set<string>>(new Set());

  const uid = profile?.uid ?? "";
  const myDesk = pages.find((p) => p.responsibleUserId === uid) ?? null;
  const enabled = Boolean(
    db && activeWorkspaceId && uid && permissions.isResolved && permissions.hasRole("manager") && myDesk
  );

  useEffect(() => {
    handledRef.current = new Set();
  }, [activeWorkspaceId, uid]);

  useEffect(() => {
    if (!enabled || !activeWorkspaceId || !myDesk) return;
    const q = query(paths.orders(activeWorkspaceId), where("assignedUid", "==", uid));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        for (const docSnap of snap.docs) {
          const order = { id: docSnap.id, ...docSnap.data() } as WorkOrder;
          if (order.status !== "assigned") continue;
          if (handledRef.current.has(order.id)) continue;
          handledRef.current.add(order.id);
          void takeOrderToDesk({
            workspaceId: activeWorkspaceId,
            order,
            page: myDesk,
            workspace: activeWorkspace,
            members,
            monthKey,
            me: { uid, name: displayNameOf(profile) },
          })
            .then(() => {
              toast.success(`Новый заказ в столе: ${order.client}`, {
                description: "Строка подсвечена, пока вы не снимете подсветку.",
              });
            })
            .catch((error) => {
              // Не получилось — разрешаем повтор на следующем снапшоте или
              // следующем открытии приложения; заказ остаётся `assigned`.
              handledRef.current.delete(order.id);
              console.error("Не удалось положить заказ в стол:", error);
            });
        }
      },
      (error) => console.error("Подписка на свои заказы отклонена:", error.code, error.message)
    );
    return unsubscribe;
    // members/monthKey намеренно вне зависимостей: их обновление не должно
    // пересоздавать подписку, актуальные значения берутся в момент записи.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, activeWorkspaceId, uid, myDesk?.id]);
}
