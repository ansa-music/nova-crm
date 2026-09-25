import { useEffect, useRef } from "react";
import { onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { OrderNotAssignedError, OrderOfflineError, takeOrderToDesk } from "@/services/orderService";
import { isRowsMigratingError } from "@/utils/dbError";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useCurrentPeriodKey } from "@/hooks/useCurrentPeriodKey";
import { myDisplayName } from "@/utils/displayName";
import { toast } from "@/components/ui/sonner";
import { useUiStore } from "@/store/uiStore";
import type { WorkOrder } from "@/types";

/**
 * Заезды идут ПО ОЧЕРЕДИ на всё приложение (тот же приём, что в
 * useMonthTabAutopilot). Снапшот приносит все выданные заказы разом, и
 * параллельные заезды успевали прочитать строки стола ДО первой записи:
 * оба находили один и тот же пустой слот и писали в него — второй заказ
 * затирал первый, у обоих оставался один takenRowId, и один заказ пропадал
 * из стола, числясь «В столе».
 */
let pickupQueue: Promise<unknown> = Promise.resolve();
function enqueuePickup<T>(task: () => Promise<T>): Promise<T> {
  const next = pickupQueue.then(task, task);
  pickupQueue = next.catch(() => undefined);
  return next;
}

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
 * — это его собственные заказы (лимиты listener'ов на Spark, см. CLAUDE.md).
 * Статус фильтруется на сервере (`status == "assigned"`): без него подписка
 * при каждом входе перечитывала ВСЕ заказы, которые технарь когда-либо
 * забирал, — они так и числятся за ним со статусом `taken`. Два равенства
 * сервер собирает из одиночных индексов, составной индекс не нужен.
 * Проверка статуса в колбэке осталась страховкой.
 *
 * Снимки ИЗ КЭША пропускаем (`includeMetadataChanges`, чтобы переход «кэш →
 * сервер» пришёл, даже если ничего не поменялось): с LRU-кэшем в памяти
 * повторная подписка сначала отдаёт заказы, какими они были когда-то, и
 * давно забранный заказ снова выглядел бы «выданным». Окончательную
 * проверку делает сам `takeOrderToDesk` — чтением с сервера.
 */
export function useOrderAutoPickup() {
  const { profile } = useAuth();
  const permissions = usePermissions();
  const { activeWorkspace, activeWorkspaceId, members, pages } = useWorkspace();
  const monthKey = useCurrentPeriodKey();
  /** Заказы, по которым запись уже идёт или прошла — снапшот прилетает несколько раз. */
  const handledRef = useRef<Set<string>>(new Set());
  /**
   * Всё, что нужно в момент записи, но не должно пересоздавать подписку.
   * Держим в ref и обновляем каждый рендер: подписка живёт долго, а её
   * колбэк иначе навсегда запомнил бы значения того рендера, на котором был
   * создан. Больнее всего это било по monthKey — приложение, открытое через
   * полночь первого числа, положило бы заказ в ПРОШЛОМЕСЯЧНУЮ вкладку.
   */
  const latestRef = useRef({ workspace: activeWorkspace, members, monthKey, profile });
  latestRef.current = { workspace: activeWorkspace, members, monthKey, profile };

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
    const q = query(paths.orders(activeWorkspaceId), where("assignedUid", "==", uid), where("status", "==", "assigned"));
    const unsubscribe = onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snap) => {
        if (snap.metadata.fromCache) return;
        for (const docSnap of snap.docs) {
          const order = { id: docSnap.id, ...docSnap.data() } as WorkOrder;
          if (order.status !== "assigned") continue;
          // Заказ со стола ОС заводит в стол сам ОС — строкой-заказом с его
          // меткой (useOsExchangeHandoff); обычная строка от технаря была бы
          // вторым, «ничьим» экземпляром того же заказа.
          if (order.osSource) continue;
          if (handledRef.current.has(order.id)) continue;
          handledRef.current.add(order.id);
          const latest = latestRef.current;
          void enqueuePickup(() =>
            takeOrderToDesk({
            workspaceId: activeWorkspaceId,
            order,
            page: myDesk,
              workspace: latest.workspace,
              members: latest.members,
              monthKey: latest.monthKey,
              me: { uid, name: myDisplayName(latest.profile, latest.members) },
            })
          )
            .then(() => {
              // Зелёная метка на «Мой стол» в меню — гаснет, когда стол
              // откроют. Тост человек может и не застать: заказ приезжает,
              // пока он в другом разделе или вовсе отошёл.
              useUiStore.getState().markDeskAlert(myDesk.id);
              toast.success(`Новый заказ в столе: ${order.client}`, {
                description: "Строка подсвечена, пока вы не снимете подсветку.",
              });
            })
            .catch((error) => {
              // Заказ уже не наш (забран с другого устройства, передан,
              // отменён) — не сбой: молчим и не повторяем.
              if (error instanceof OrderNotAssignedError) return;
              // Пропала связь — тоже не повод звать человека: снимок с сервера
              // после переподключения повторит заезд сам.
              if (error instanceof OrderOfflineError) {
                handledRef.current.delete(order.id);
                return;
              }
              // Идёт перенос строк таблиц — «Забрать в стол» тоже откажет.
              // Заказ остаётся выданным и приедет сам, когда перенос кончится.
              if (isRowsMigratingError(error)) {
                handledRef.current.delete(order.id);
                toast.info(`Заказ «${order.client}» приедет в стол чуть позже`, {
                  description: "Идёт перенос строк таблиц — заказ запишется сам, когда он закончится.",
                });
                return;
              }
              // Не получилось — разрешаем повтор на следующем снапшоте или
              // следующем открытии приложения; заказ остаётся `assigned`.
              // Молчать тут нельзя: человеку уже пришло «заказ едет в ваш
              // стол», и без подсказки он не узнает, что строки не будет.
              handledRef.current.delete(order.id);
              console.error("Не удалось положить заказ в стол:", error);
              toast.error(`Заказ «${order.client}» не доехал в стол`, {
                description: "Откройте «Заказы» и нажмите «Забрать в стол».",
              });
            });
        }
      },
      (error) => console.error("Подписка на свои заказы отклонена:", error.code, error.message)
    );
    return unsubscribe;
    // Подписка зависит только от того, КОГО и ГДЕ слушать. Всё остальное
    // читается из latestRef в момент записи, поэтому пересоздавать её на
    // каждое обновление участников или смену месяца не нужно.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, activeWorkspaceId, uid, myDesk?.id]);
}
