import { useEffect, useMemo, useState } from "react";
import { onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
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
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setOpen([]);
    setAssigned([]);
    setLoaded(false);
    if (!db || !workspaceId || !uid || !enabled) return;
    // Два узких слушателя по двум равенствам, а не `status in [...]`: так
    // составной индекс не нужен, а «выданные» висят секунды — пока сессия ОС
    // не довезёт заказ до технаря (useOsExchangeHandoff).
    const listen = (status: "open" | "assigned", set: (orders: WorkOrder[]) => void, markLoaded: boolean) =>
      onSnapshot(
        query(paths.orders(workspaceId), where("createdBy", "==", uid), where("status", "==", status)),
        (snap) => {
          set(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as WorkOrder).filter((o) => Boolean(o.osSource)));
          if (markLoaded) setLoaded(true);
        },
        (error) => {
          // Отказ = «не знаем»: ячейка покажет «На «Заказах»», а не «откликов нет».
          console.error(`Подписка на свои заказы на бирже (${status}) отклонена:`, error.code, error.message);
          if (markLoaded) setLoaded(false);
        }
      );
    const stopOpen = listen("open", setOpen, true);
    const stopAssigned = listen("assigned", setAssigned, false);
    return () => {
      stopOpen();
      stopAssigned();
    };
  }, [workspaceId, uid, enabled]);

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
