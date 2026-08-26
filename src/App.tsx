// PATH: src/App.tsx  (REPLACES EXISTING)
import { Suspense, lazy } from "react";
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

const LoginPage = lazy(() => import("@/pages/LoginPage"));
const HomePage = lazy(() => import("@/pages/HomePage"));
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const DynamicTablePage = lazy(() => import("@/pages/DynamicTablePage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const UsersPage = lazy(() => import("@/pages/UsersPage"));
const PeoplePage = lazy(() => import("@/pages/PeoplePage"));
const DesksPage = lazy(() => import("@/pages/DesksPage"));
const AnnouncementsPage = lazy(() => import("@/pages/AnnouncementsPage"));
const GrokLimitPage = lazy(() => import("@/pages/GrokLimitPage"));
const WorkspaceChatPage = lazy(() => import("@/pages/WorkspaceChatPage"));
const MessagesPage = lazy(() => import("@/pages/MessagesPage"));
const JoinWorkspacePage = lazy(() => import("@/pages/JoinWorkspacePage"));
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage"));

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
            <Route path="desks" element={<DesksPage />} />
            <Route path="people" element={<PeoplePage />} />
            <Route path="page/:pageId" element={<DynamicTablePage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="announcements" element={<AnnouncementsPage />} />
            <Route path="grok-limit" element={<GrokLimitPage />} />
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
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
