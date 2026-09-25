import { useEffect, useMemo, useState } from "react";
import { onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { subscribeLiveOrdersFeed, useOrdersBackend } from "@/services/orderStore";
import type { WorkOrder } from "@/types";

/**
 * Мои заказы на «Заказах», выставленные СО СТОЛА ОС: открытые (у кого какие
 * отклики) и только что выданные (едут к технарю). Нужны самому столу ОС — в ячейке «Технарь» стоит «Отклики · N»,
 * и выбрать технаря можно прямо там, не уходя на «Заказы».
 *
 * Равенства (`createdBy`, `status`) — составной индекс не нужен. Слушатели
 * живут, только пока открыт свой стол ОС. Ключ `byRow` — id строки-источника.
 */
export function useMyExchangeOrders(workspaceId: string | null, uid: string, enabled: boolean) {
  const [open, setOpen] = useState<WorkOrder[]>([]);
  const [assigned, setAssigned] = useState<WorkOrder[]>([]);
  // «Прочитано» — только когда ответили ОБА слушателя: по одному открытому
  // списку строка с отданным (едущим) заказом выглядела бы снятой с биржи, и
  // стол предложил бы выставить её заново.
  const [openLoaded, setOpenLoaded] = useState(false);
  const [assignedLoaded, setAssignedLoaded] = useState(false);
  const loaded = openLoaded && assignedLoaded;
  const backend = useOrdersBackend(workspaceId);

  useEffect(() => {
    setOpen([]);
    setAssigned([]);
    setOpenLoaded(false);
    setAssignedLoaded(false);
    if (!db || !workspaceId || !uid || !enabled || !backend) return;
    if (backend === "supabase") {
      // Общий поток живых заказов вкладки: свои со стола ОС — отсюда.
      return subscribeLiveOrdersFeed(
        workspaceId,
        (orders, fromCache) => {
          const mine = orders.filter((o) => o.createdBy === uid && Boolean(o.osSource));
          setOpen(mine.filter((o) => o.status === "open"));
          setAssigned(mine.filter((o) => o.status === "assigned"));
          setOpenLoaded(!fromCache);
          setAssignedLoaded(!fromCache);
        },
        (error) => {
          console.error("Свои заказы на бирже не прочитаны:", error);
          setOpenLoaded(false);
          setAssignedLoaded(false);
        }
      );
    }
    // Два узких слушателя по двум равенствам, а не `status in [...]`: так
    // составной индекс не нужен, а «выданные» висят секунды — пока сессия ОС
    // не довезёт заказ до технаря (useOsExchangeHandoff).
    const listen = (status: "open" | "assigned", set: (orders: WorkOrder[]) => void, setLoadedFlag: (v: boolean) => void) =>
      onSnapshot(
        query(paths.orders(workspaceId), where("createdBy", "==", uid), where("status", "==", status)),
        // Кэш на диске отдаёт первый снимок сам (без сети — пустой): рисовать
        // по нему можно, а решать «заказа на бирже нет, выдай заново» — нет.
        // «Прочитано» — только снимок, подтверждённый сервером; обрыв связи
        // возвращает в «не знаем».
        { includeMetadataChanges: true },
        (snap) => {
          set(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as WorkOrder).filter((o) => Boolean(o.osSource)));
          setLoadedFlag(!snap.metadata.fromCache);
        },
        (error) => {
          // Отказ = «не знаем»: ячейка покажет «На «Заказах»», а не «откликов нет».
          console.error(`Подписка на свои заказы на бирже (${status}) отклонена:`, error.code, error.message);
          setLoadedFlag(false);
        }
      );
    const stopOpen = listen("open", setOpen, setOpenLoaded);
    const stopAssigned = listen("assigned", setAssigned, setAssignedLoaded);
    return () => {
      stopOpen();
      stopAssigned();
    };
  }, [workspaceId, uid, enabled, backend]);

  const orders = useMemo(() => [...open, ...assigned], [open, assigned]);
  const byRow = useMemo(() => {
    const map = new Map<string, WorkOrder>();
    for (const order of orders) if (order.osSource?.rowId) map.set(order.osSource.rowId, order);
    return map;
  }, [orders]);
  /** Только открытые — для окна выбора: выданный уже не перевыбрать отсюда. */
  const byId = useMemo(() => new Map(open.map((o) => [o.id, o])), [open]);

  return { byRow, byId, loaded };
}

/** Сколько технарей откликнулось. */
export function claimCount(order: WorkOrder | null | undefined): number {
  return order ? Object.keys(order.claims ?? {}).length : 0;
}
