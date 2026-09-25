import { onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { subscribeLiveOrdersFeed } from "@/services/orderStore";
import type { SbBackend } from "@/services/sb/sbCollections";

/**
 * «Есть открытый заказ» — для зелёного пункта «Заказы» в меню.
 *
 * Слушатель ОДИН на приложение и узкий: только `status == "open"` (одно
 * равенство, составной индекс не нужен). Подписка «Заказов» на живые заказы
 * по-прежнему живёт только на самой странице — этот счётчик нужен там, где
 * страницы нет, и считать ради него всю биржу незачем.
 *
 * Слушаем, только пока вкладку видно. Вкладку с CRM держат открытой весь
 * день, чаще всего свёрнутой, а каждое изменение открытого заказа (отклик,
 * «Свободные / Все», выдача) — это чтение на КАЖДУЮ открытую вкладку каждого
 * человека (квота Spark). Свёрнутой вкладке зелёный пункт не виден, поэтому
 * через минуту после ухода слушатель снимается, а при возврате ставится
 * заново и сразу отдаёт свежее состояние. Минута — чтобы переключение на
 * соседнюю вкладку и обратно не перечитывало биржу.
 *
 * На самой странице «Заказы» свой слушатель не нужен вовсе: её подписка и так
 * видит все открытые заказы, и она сама кормит счётчик
 * (`feedOpenOrdersFromPage`), а свой слушатель на это время снимается.
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

/** Сколько свёрнутая вкладка держит слушатель, прежде чем снять его. */
const HIDDEN_DETACH_MS = 60_000;

interface Watch {
  workspaceId: string;
  /** Supabase — берём общий поток живых заказов вкладки (orderStore). */
  backend: SbBackend;
  unsubscribe: (() => void) | null;
  hideTimer: ReturnType<typeof setTimeout> | null;
}

/** Текущее наблюдение (одно на приложение — его ставит AppLayout). */
let watch: Watch | null = null;
/** Workspace, чей счётчик сейчас кормит страница «Заказы» своей подпиской. */
let pageFeedWorkspaceId: string | null = null;

function tabVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

function attach(w: Watch) {
  if (w.unsubscribe || !db || pageFeedWorkspaceId === w.workspaceId) return;
  if (w.backend === "supabase") {
    const unsubscribe = subscribeLiveOrdersFeed(
      w.workspaceId,
      (orders, fromCache) => {
        // Снимок, не подтверждённый сервером, — «не знаем», прежнее число не трогаем.
        if (fromCache || watch !== w || pageFeedWorkspaceId === w.workspaceId) return;
        publish({ count: orders.filter((o) => o.status === "open").length, loaded: true });
      },
      () => {
        if (w.unsubscribe === unsubscribe) w.unsubscribe = null;
        if (watch === w && pageFeedWorkspaceId !== w.workspaceId) publish({ count: 0, loaded: false });
      }
    );
    w.unsubscribe = unsubscribe;
    return;
  }
  const q = query(paths.orders(w.workspaceId), where("status", "==", "open"));
  const unsubscribe = onSnapshot(
    q,
    (snap) => {
      if (watch === w && pageFeedWorkspaceId !== w.workspaceId) publish({ count: snap.size, loaded: true });
    },
    (error) => {
      console.error("Подписка на открытые заказы отклонена:", error.code, error.message);
      // onSnapshot после ошибки мёртв: забываем его, чтобы следующее
      // возвращение на вкладку поставило слушатель заново.
      if (w.unsubscribe === unsubscribe) w.unsubscribe = null;
      if (watch === w && pageFeedWorkspaceId !== w.workspaceId) publish({ count: 0, loaded: false });
    }
  );
  w.unsubscribe = unsubscribe;
}

function detach(w: Watch) {
  if (!w.unsubscribe) return;
  w.unsubscribe();
  w.unsubscribe = null;
}

function onVisibilityChange() {
  const w = watch;
  if (!w) return;
  if (!tabVisible()) {
    if (!w.hideTimer) {
      w.hideTimer = setTimeout(() => {
        w.hideTimer = null;
        detach(w);
      }, HIDDEN_DETACH_MS);
    }
    return;
  }
  if (w.hideTimer) {
    clearTimeout(w.hideTimer);
    w.hideTimer = null;
  }
  attach(w);
}

export function watchOpenOrders(workspaceId: string | null, backend: SbBackend = "firestore"): () => void {
  if (!db || !workspaceId) {
    publish({ count: 0, loaded: false });
    return () => {};
  }
  const w: Watch = { workspaceId, backend, unsubscribe: null, hideTimer: null };
  watch = w;
  // Вкладку открыли в фоне — слушатель встанет, когда на неё посмотрят.
  if (tabVisible()) attach(w);
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibilityChange);
  return () => {
    if (w.hideTimer) {
      clearTimeout(w.hideTimer);
      w.hideTimer = null;
    }
    detach(w);
    // Обработчик один на модуль (addEventListener одну и ту же функцию дважды
    // не вешает) — снимаем его, только если нас не сменило новое наблюдение.
    if (watch === w) {
      watch = null;
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibilityChange);
    }
  };
}

/**
 * Страница «Заказы» отдаёт число открытых заказов из своей подписки
 * (только снимки, подтверждённые сервером). Пока она это делает, свой
 * слушатель не нужен — он снимается.
 */
export function feedOpenOrdersFromPage(workspaceId: string, count: number) {
  pageFeedWorkspaceId = workspaceId;
  if (watch && watch.workspaceId === workspaceId) detach(watch);
  publish({ count, loaded: true });
}

/** Страница ушла (или её подписка упала) — счётчик снова на своём слушателе. */
export function releaseOpenOrdersPageFeed(workspaceId: string) {
  if (pageFeedWorkspaceId !== workspaceId) return;
  pageFeedWorkspaceId = null;
  if (watch && watch.workspaceId === workspaceId && tabVisible()) attach(watch);
}
