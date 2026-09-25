// PATH: src/App.tsx  (REPLACES EXISTING)
import { Suspense, lazy, useEffect } from "react";
import { Navigate, Route, BrowserRouter, Routes, useLocation } from "react-router";
import { ThemeProvider } from "@/contexts/ThemeProvider";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { AppBootScreen } from "@/components/common/AppBootScreen";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/layouts/AppLayout";
import { useAuthBootstrap } from "@/hooks/useAuth";
import { useWorkspaceListBootstrap } from "@/hooks/useWorkspace";
import { useAppBootstrap } from "@/hooks/useAppBootstrap";
import { wasGoogleRedirectPending } from "@/firebase/auth";
import { joinPathAfterLogin, rememberJoinIntentFromPath } from "@/utils/joinIntent";
import { DISPATCH_ENABLED } from "@/config/features";
import { SiteStatusBanner } from "@/components/common/SiteStatusBanner";
import { TableDiagPanel } from "@/components/table/TableDiagPanel";
import { useBootstrapStore } from "@/store/bootstrapStore";
import { useAuthStore } from "@/store/authStore";
// «/» — только редирект на дом человека (0,5 КБ): отдельный chunk стоил ещё
// одного запроса ПОСЛЕ загрузки workspace, прямо перед первым экраном.
import HomePage from "@/pages/HomePage";

// Загрузчики страниц — общие с предзагрузкой ниже и с наведением на пункты
// меню (config/pageLoaders.ts): все зовут РОВНО тот же import(), и браузер
// держит модуль один — второй вызов берёт готовый.
import {
  loadAbsPage,
  loadReportsPage,
  loadAnnouncementsPage,
  loadDashboardPage,
  loadDesksPage,
  loadDispatchPage,
  loadMorePage,
  loadDynamicTablePage,
  loadGrokLimitPage,
  loadMessagesPage,
  loadOrdersPage,
  loadOsDeskPage,
  loadOsDesksPage,
  loadOsDispatchPage,
  loadDeskEditingPage,
  loadPeoplePage,
  loadSchedulePage,
  loadSettingsPage,
  loadTeamPage,
  loadTechniciansPage,
  loadUsersPage,
  loadWorkspaceChatPage,
  saveDataMode,
} from "@/config/pageLoaders";

const LoginPage = lazy(() => import("@/pages/LoginPage"));
const DashboardPage = lazy(loadDashboardPage);
const DynamicTablePage = lazy(loadDynamicTablePage);
const SettingsPage = lazy(loadSettingsPage);
const UsersPage = lazy(loadUsersPage);
const TeamPage = lazy(loadTeamPage);
const PeoplePage = lazy(loadPeoplePage);
const DesksPage = lazy(loadDesksPage);
const MorePage = lazy(loadMorePage);
const AnnouncementsPage = lazy(loadAnnouncementsPage);
const GrokLimitPage = lazy(loadGrokLimitPage);
const DispatchPage = lazy(loadDispatchPage);
const TechniciansPage = lazy(loadTechniciansPage);
const OrdersPage = lazy(loadOrdersPage);
const OsDeskPage = lazy(loadOsDeskPage);
const OsDesksPage = lazy(loadOsDesksPage);
const AbsPage = lazy(loadAbsPage);
const ReportsPage = lazy(loadReportsPage);
const OsDispatchPage = lazy(loadOsDispatchPage);
const DeskEditingPage = lazy(loadDeskEditingPage);
// Скрытая страница Owner: в меню и поиске её нет, только прямой адрес.
const DeskObserversPage = lazy(() => import("@/pages/DeskObserversPage"));
const SchedulePage = lazy(loadSchedulePage);
const WorkspaceChatPage = lazy(loadWorkspaceChatPage);
const MessagesPage = lazy(loadMessagesPage);
const JoinWorkspacePage = lazy(() => import("@/pages/JoinWorkspacePage"));
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage"));

/**
 * Страницы меню в порядке предзагрузки: частые и лёгкие — первыми, дашборд и
 * ABS (они тянут recharts) — последними. Клик по пункту меню иначе «висел»
 * 0,1–0,6 с, пока качался chunk страницы.
 */
const MENU_PAGE_LOADERS: Array<() => Promise<unknown>> = [
  loadOrdersPage,
  loadDesksPage,
  loadMorePage,
  loadSchedulePage,
  loadMessagesPage,
  loadWorkspaceChatPage,
  loadPeoplePage,
  loadTechniciansPage,
  loadOsDeskPage,
  loadOsDesksPage,
  loadOsDispatchPage,
  loadTeamPage,
  loadUsersPage,
  loadAnnouncementsPage,
  loadGrokLimitPage,
  loadSettingsPage,
  loadDashboardPage,
  loadAbsPage,
  loadReportsPage,
];

/** Тот же ключ, что пишет `DynamicTablePage` при открытии стола. */
const LAST_DESK_KEY = "nova-crm:last-page-id";

function wantsDeskChunk(): boolean {
  try {
    if (/^\/(page|os-desk)(\/|$)/.test(window.location.pathname)) return true;
    return Boolean(window.localStorage.getItem(LAST_DESK_KEY));
  } catch {
    return false;
  }
}

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

/**
 * Параллельная загрузка кода, пока идёт загрузка данных.
 *
 * (1) Стол. Раньше цепочка шла строго подряд: вход → профиль → workspace →
 * участники и столы → и только потом chunk стола (≈106 КБ gzip) → строки.
 * Теперь chunk качается сразу, как только известно, что человек вошёл, —
 * если он сейчас на столе или последний раз открывал стол (у технаря «дом» —
 * свой стол). Модуль стола ничего не делает при загрузке, только определяет
 * компоненты, так что ранний import() безопасен.
 *
 * (2) Страницы меню — по одной в простое браузера (requestIdleCallback), когда
 * первый экран уже готов. Одна за раз, чтобы разбор модуля не вставал длинной
 * задачей поперёк ввода; в режиме экономии трафика — не качаем.
 */
function StartupPreloader() {
  const firebaseUser = useAuthStore((s) => s.firebaseUser);
  const signedIn = useBootstrapStore((s) => s.authResolved) && Boolean(firebaseUser);
  const profileResolved = useBootstrapStore((s) => s.profileResolved);
  const dataReady = useBootstrapStore((s) => Boolean(s.resolvedDataWorkspaceId));

  useEffect(() => {
    if (!signedIn || !wantsDeskChunk()) return;
    void loadDynamicTablePage().catch(() => {
      /* не вышло — лениво загрузит сам маршрут (и разберёт vite:preloadError) */
    });
  }, [signedIn]);

  useEffect(() => {
    if (!signedIn || !profileResolved || !dataReady || saveDataMode()) return;
    const w = window as IdleWindow;
    let cancelled = false;
    // Номера простоя и таймеров — разные счётчики: гасить каждый своим вызовом.
    let idleHandle: number | null = null;
    let timerHandle: number | null = null;
    let index = 0;
    const schedule = () => {
      if (cancelled || index >= MENU_PAGE_LOADERS.length) return;
      if (w.requestIdleCallback) idleHandle = w.requestIdleCallback(step, { timeout: 5000 });
      else timerHandle = window.setTimeout(step, 400);
    };
    const step = () => {
      idleHandle = null;
      timerHandle = null;
      if (cancelled) return;
      const load = MENU_PAGE_LOADERS[index++];
      void load()
        .catch(() => {
          /* сеть моргнула — страница загрузится по клику, как раньше */
        })
        .finally(schedule);
    };
    // Первые секунды после готовности — строкам стола и подпискам, не коду меню.
    const start = window.setTimeout(schedule, 2500);
    return () => {
      cancelled = true;
      window.clearTimeout(start);
      if (idleHandle !== null) w.cancelIdleCallback?.(idleHandle);
      if (timerHandle !== null) window.clearTimeout(timerHandle);
    };
  }, [signedIn, profileResolved, dataReady]);

  return null;
}

/**
 * Route guard. Branches on the bootstrap PHASE, never on a raw isLoading
 * boolean: "auth" and "profile" are indistinguishable from the router's point
 * of view (both mean "we do not yet know who this is"), and redirecting to
 * /login during either of them is what used to log people out of a deep link
 * on a cold open.
 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { phase, isAuthenticated } = useAppBootstrap();
  const location = useLocation();

  if (phase === "auth" || phase === "profile") return <AppBootScreen phase={phase} />;

  if (!isAuthenticated) {
    // Only Firebase Auth (no currentUser) may send someone to /login.
    // permission-denied and membership false are NOT unauthenticated.
    if (wasGoogleRedirectPending()) return <AppBootScreen phase="auth" />;
    rememberJoinIntentFromPath(location.pathname);
    return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;
  }
  return <>{children}</>;
}

function RedirectIfAuthed({ children }: { children: React.ReactNode }) {
  const { phase, isAuthenticated } = useAppBootstrap();
  const location = useLocation();

  if (phase === "auth") return <AppBootScreen phase={phase} />;

  if (isAuthenticated) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={joinPathAfterLogin(from)} replace />;
  }
  return <>{children}</>;
}

function RouteFallback() {
  return <AppBootScreen phase="workspace-data" />;
}

function AppShell() {
  useAuthBootstrap();
  useWorkspaceListBootstrap();

  return (
    <BrowserRouter>
      <StartupPreloader />
      <TableDiagPanel />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route
            path="/login"
            element={
              <RedirectIfAuthed>
                <LoginPage />
              </RedirectIfAuthed>
            }
          />
          <Route
            path="/join/:workspaceId"
            element={
              <RequireAuth>
                <JoinWorkspacePage />
              </RequireAuth>
            }
          />
          <Route
            path="/"
            element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }
          >
            <Route index element={<HomePage />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="abs" element={<AbsPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="desks" element={<DesksPage />} />
            <Route path="more" element={<MorePage />} />
            <Route path="people" element={<PeoplePage />} />
            <Route path="technicians" element={<TechniciansPage />} />
            <Route path="orders" element={<OrdersPage />} />
            <Route path="os-desk" element={<OsDeskPage />} />
            <Route path="os-desks" element={<OsDesksPage />} />
            <Route path="os-dispatch" element={<OsDispatchPage />} />
            <Route path="desk-editing" element={<DeskEditingPage />} />
            <Route path="observers" element={<DeskObserversPage />} />
            <Route path="schedule" element={<SchedulePage />} />
            <Route path="overview" element={<Navigate to="/dashboard" replace />} />
            <Route path="page/:pageId" element={<DynamicTablePage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="team" element={<TeamPage />} />
            <Route path="announcements" element={<AnnouncementsPage />} />
            <Route path="grok-limit" element={<GrokLimitPage />} />
            <Route path="grok-limit/apps" element={<Navigate to="/grok-limit?s=higgsfield" replace />} />
            <Route path="dispatch" element={DISPATCH_ENABLED ? <DispatchPage /> : <Navigate to="/" replace />} />
            <Route path="chat" element={<WorkspaceChatPage />} />
            <Route path="messages" element={<MessagesPage />} />
            <Route path="messages/:peerUid" element={<MessagesPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <TooltipProvider delayDuration={200}>
          <AppShell />
          {/* Объявление на весь сайт (public/status.json) — поверх всего, даже экрана загрузки. */}
          <SiteStatusBanner />
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
