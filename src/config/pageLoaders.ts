import { pathOnly } from "@/config/nav";

/**
 * Загрузчики chunk'ов страниц — одни на всё приложение. `React.lazy` в
 * App.tsx, фоновая предзагрузка (`StartupPreloader`) и предзагрузка по
 * наведению на пункт меню зовут РОВНО эти функции: браузер держит модуль
 * один, и второй import() берёт уже скачанный. Отдельным модулем, а не
 * экспортом из App.tsx: меню импортировало бы App, а App — меню (цикл).
 */
export const loadDynamicTablePage = () => import("@/pages/DynamicTablePage");
export const loadDashboardPage = () => import("@/pages/DashboardPage");
export const loadSettingsPage = () => import("@/pages/SettingsPage");
export const loadUsersPage = () => import("@/pages/UsersPage");
export const loadTeamPage = () => import("@/pages/TeamPage");
export const loadPeoplePage = () => import("@/pages/PeoplePage");
export const loadDesksPage = () => import("@/pages/DesksPage");
export const loadAnnouncementsPage = () => import("@/pages/AnnouncementsPage");
export const loadGrokLimitPage = () => import("@/pages/GrokLimitPage");
export const loadDispatchPage = () => import("@/pages/DispatchPage");
export const loadTechniciansPage = () => import("@/pages/TechniciansPage");
export const loadOrdersPage = () => import("@/pages/OrdersPage");
export const loadOsDeskPage = () => import("@/pages/OsDeskPage");
export const loadOsDesksPage = () => import("@/pages/OsDesksPage");
export const loadAbsPage = () => import("@/pages/AbsPage");
export const loadOsDispatchPage = () => import("@/pages/OsDispatchPage");
export const loadDeskEditingPage = () => import("@/pages/DeskEditingPage");
export const loadSchedulePage = () => import("@/pages/SchedulePage");
export const loadWorkspaceChatPage = () => import("@/pages/WorkspaceChatPage");
export const loadMessagesPage = () => import("@/pages/MessagesPage");

/**
 * Первый сегмент пути → загрузчик. Только страницы меню и стол: скрытые
 * («Наблюдатели») и «/» (HomePage не ленивая) предзагружать незачем.
 */
const ROUTE_LOADERS: Record<string, () => Promise<unknown>> = {
  page: loadDynamicTablePage,
  dashboard: loadDashboardPage,
  settings: loadSettingsPage,
  users: loadUsersPage,
  team: loadTeamPage,
  people: loadPeoplePage,
  desks: loadDesksPage,
  announcements: loadAnnouncementsPage,
  "grok-limit": loadGrokLimitPage,
  dispatch: loadDispatchPage,
  technicians: loadTechniciansPage,
  orders: loadOrdersPage,
  "os-desk": loadOsDeskPage,
  "os-desks": loadOsDesksPage,
  abs: loadAbsPage,
  "os-dispatch": loadOsDispatchPage,
  "desk-editing": loadDeskEditingPage,
  schedule: loadSchedulePage,
  chat: loadWorkspaceChatPage,
  messages: loadMessagesPage,
};

/** Какие chunk'и уже просили — наведение повторяется десятки раз за минуту. */
const requested = new Set<() => Promise<unknown>>();

/** Загрузчик страницы по адресу пункта меню (`/page/abc?tab=x` → стол), или null. */
export function routeLoaderFor(to: string): (() => Promise<unknown>) | null {
  const segment = pathOnly(to).split("/")[1] ?? "";
  return ROUTE_LOADERS[segment] ?? null;
}

/** Сеть «берегите трафик» или 2G — фоновые и «на всякий случай» загрузки не нужны. */
export function saveDataMode(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } })
    .connection;
  return Boolean(connection?.saveData) || /(^|-)2g$/.test(connection?.effectiveType ?? "");
}

/**
 * Человек что-то вводит или у него открыт диалог (та же проверка, что
 * `userIsBusy` в useAppUpdateCheck). Зачем она здесь: после деплоя старых
 * chunk'ов на хостинге нет, а Vite на ЛЮБУЮ ошибку import() шлёт
 * `vite:preloadError`, и useAppUpdateCheck по нему перезагружает вкладку —
 * без своих защит «печатает / открыт диалог». По клику это переход, человек
 * его хотел; по наведению мышью, пока правится ячейка, — пропал бы
 * недописанный текст. Поэтому «на всякий случай» в такие моменты не качаем.
 */
function userIsBusy(): boolean {
  const el = document.activeElement as HTMLElement | null;
  const typing =
    Boolean(el) && (el!.tagName === "INPUT" || el!.tagName === "TEXTAREA" || el!.tagName === "SELECT" || el!.isContentEditable);
  return typing || Boolean(document.querySelector('[role="dialog"], [role="alertdialog"]'));
}

/**
 * Начать качать chunk страницы, пока рука ещё на пути к клику (наведение,
 * фокус с клавиатуры, касание). Клик по пункту меню иначе ждал сеть: переход
 * идёт в transition и держит старый экран, пока chunk не приехал, — это и
 * читалось как «меню тормозит». Ошибку глотаем: не вышло — страница
 * загрузится по самому переходу (и разберёт vite:preloadError), как раньше.
 *
 * Наведение и фокус — догадка, а не намерение: в режиме экономии трафика
 * (StartupPreloader там тоже молчит) и когда человек занят (см. `userIsBusy`)
 * ничего не качаем. `intent` — касание пункта нижней панели: оно почти всегда
 * заканчивается переходом через ~100 мс, и ошибка загрузки случилась бы и так.
 */
export function preloadRoute(to: string, opts: { intent?: boolean } = {}): void {
  const load = routeLoaderFor(to);
  if (!load || requested.has(load)) return;
  if (!opts.intent && (saveDataMode() || userIsBusy())) return;
  requested.add(load);
  void load().catch(() => {
    // Сеть моргнула — пусть следующее наведение попробует снова.
    requested.delete(load);
  });
}
