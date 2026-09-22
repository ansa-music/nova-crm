import { onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";

/**
 * «Есть открытый заказ» — для зелёного пункта «Заказы» в меню.
 *
 * Слушатель ОДИН на приложение и узкий: только `status == "open"` (одно
 * равенство, составной индекс не нужен). Подписка «Заказов» на всю коллекцию
 * по-прежнему живёт только на самой странице — этот счётчик нужен там, где
 * страницы нет, и считать ради него всю биржу незачем.
 *
 * Отказ чтения = «не знаем», а не «заказов нет»: подсветку в этом случае
 * просто не зажигаем, но и не выдаём отказ за факт.
 */
interface OpenOrdersState {
  count: number;
  loaded: boolean;
}

let state: OpenOrdersState = { count: 0, loaded: false };
const listeners = new Set<() => void>();

function publish(next: OpenOrdersState) {
  if (next.count === state.count && next.loaded === state.loaded) return;
  state = next;
  listeners.forEach((fn) => fn());
}

export function openOrdersState(): OpenOrdersState {
  return state;
}

export function subscribeOpenOrdersState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function watchOpenOrders(workspaceId: string | null): () => void {
  if (!db || !workspaceId) {
    publish({ count: 0, loaded: false });
    return () => {};
  }
  const q = query(paths.orders(workspaceId), where("status", "==", "open"));
  return onSnapshot(
    q,
    (snap) => publish({ count: snap.size, loaded: true }),
    (error) => {
      console.error("Подписка на открытые заказы отклонена:", error.code, error.message);
      publish({ count: 0, loaded: false });
    }
  );
}
