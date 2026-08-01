import { Suspense, lazy } from "react";
import { Navigate, Route, BrowserRouter, Routes } from "react-router";
import { ThemeProvider } from "@/contexts/ThemeProvider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { AppLayout } from "@/layouts/AppLayout";
import { useAuth, useAuthBootstrap } from "@/hooks/useAuth";
import { useWorkspaceListBootstrap } from "@/hooks/useWorkspace";

const LoginPage = lazy(() => import("@/pages/LoginPage"));
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const DynamicTablePage = lazy(() => import("@/pages/DynamicTablePage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const UsersPage = lazy(() => import("@/pages/UsersPage"));
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage"));

function PageFallback() {
  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-4 w-32" />
      </div>
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <PageFallback />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RedirectIfAuthed({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <PageFallback />;
  if (isAuthenticated) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AppShell() {
  useAuthBootstrap();
  useWorkspaceListBootstrap();

  return (
    <BrowserRouter>
      <Suspense fallback={<PageFallback />}>
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
            path="/"
            element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="page/:pageId" element={<DynamicTablePage />} />
            <Route path="users" element={<UsersPage />} />
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
    <ThemeProvider>
      <TooltipProvider delayDuration={200}>
        <AppShell />
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  );
}
