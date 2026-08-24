// PATH: src/layouts/AppLayout.tsx  (REPLACES EXISTING)
import { useState, useEffect } from "react";
import { Outlet, useLocation } from "react-router";
import { Building2, Lock, Plus } from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { PageShell } from "@/components/layout/PageShell";
import { Topbar } from "@/components/layout/Topbar";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
import { Maximize2 } from "lucide-react";
import { CreateWorkspaceDialog } from "@/components/layout/CreateWorkspaceDialog";
import { NicknamePrompt } from "@/components/common/NicknamePrompt";
import { GlobalMessageToaster } from "@/components/common/GlobalMessageToaster";
import { SimulationBanner } from "@/components/common/RoleSwitcher";
import { AppBootScreen } from "@/components/common/AppBootScreen";
import { ShortcutsHelpDialog } from "@/components/common/ShortcutsHelpDialog";
import { GlobalUndoHotkeys } from "@/components/common/GlobalUndoHotkeys";
import { GoChordHotkeys } from "@/components/common/GoChordHotkeys";
import { AccentColorSync } from "@/components/common/AccentColorSync";
import { Button } from "@/components/ui/button";
import { useActiveWorkspaceDataBootstrap, useWorkspace } from "@/hooks/useWorkspace";
import { useAppBootstrap } from "@/hooks/useAppBootstrap";
import { usePresenceHeartbeat } from "@/hooks/usePresenceHeartbeat";
import { useAuth } from "@/hooks/useAuth";
import { useIsTablet } from "@/hooks/useMediaQuery";
import { useUiStore } from "@/store/uiStore";
import { isWorkspaceAdmin } from "@/utils/adminAccess";

export function AppLayout() {
  // Hooks always run before any early return, so the subscriptions keep making
  // progress while a boot screen is on-screen.
  useActiveWorkspaceDataBootstrap();
  usePresenceHeartbeat();
  const location = useLocation();

  const { phase } = useAppBootstrap();
  const { activeWorkspace } = useWorkspace();
  const { profile } = useAuth();
  const isCompactNav = useIsTablet();
  const [createOpen, setCreateOpen] = useState(false);
  const tableFullscreen = useUiStore((s) => s.tableFullscreen);
  const setTableFullscreen = useUiStore((s) => s.setTableFullscreen);
  // Only actually hides chrome on a table page — the setting can stay on
  // (persisted) without leaving every OTHER page in the app chrome-less too.
  const isOnTablePage = location.pathname.startsWith("/page/");
  const isFullscreen = tableFullscreen && isOnTablePage;

  const canCreateWorkspace = isWorkspaceAdmin(profile?.email);

  useEffect(() => {
    if (!isFullscreen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === "Escape") setTableFullscreen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isFullscreen, setTableFullscreen]);

  // Any not-yet-resolved phase renders the shared boot screen. Crucially this
  // includes "workspace-data": members (=> role) and pages (=> access) must
  // both be in before ANY child page is allowed to evaluate permissions.
  if (phase !== "ready" && phase !== "no-workspace") {
    return <AppBootScreen phase={phase} />;
  }

  // Reached only when the workspace list has definitively resolved to empty —
  // never as a flash while it was still loading.
  if (phase === "no-workspace" || !activeWorkspace) {
    return (
      <div className="cyber-grid flex h-screen flex-col items-center justify-center gap-5 bg-background px-4 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-border bg-card text-primary">
          {canCreateWorkspace ? <Building2 className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
        </div>
        {canCreateWorkspace ? (
          <>
            <div>
              <p className="eyebrow mb-2 text-primary">Workspace</p>
              <h1 className="display text-2xl">Начните с создания workspace</h1>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Workspace — это отдельное рабочее пространство со своими страницами, участниками и
                данными, например «Animation Studio» или «Finance».
              </p>
            </div>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> Создать workspace
            </Button>
            <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
          </>
        ) : (
          <div>
            <p className="eyebrow mb-2 text-primary">Доступ</p>
            <h1 className="display text-2xl">Нет доступа к workspace</h1>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Создание новых workspace ограничено. Попросите ссылку-приглашение у владельца
              нужного workspace — доступ откроется после его подтверждения.
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`page-surface flex h-screen overflow-hidden bg-background ${isFullscreen ? "" : "p-3"}`}>
      <NicknamePrompt />
      <GlobalMessageToaster />
      <GlobalSearch hideTrigger />
      <ShortcutsHelpDialog />
      <GlobalUndoHotkeys />
      <GoChordHotkeys />
      <AccentColorSync />
      {!isCompactNav && !isFullscreen && <Sidebar />}
      <div className={`flex min-w-0 flex-1 flex-col overflow-hidden ${isFullscreen ? "" : "rounded-2xl border border-border bg-card/90"}`}>
        {!isFullscreen && <Topbar />}
        {!isFullscreen && <SimulationBanner />}
        {isFullscreen && (
          <button
            onClick={() => setTableFullscreen(false)}
            title="Показать меню (Esc)"
            className="fixed left-3 top-3 z-50 flex h-9 w-9 items-center justify-center rounded-sm border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        )}
        <main className={`flex min-h-0 flex-1 flex-col ${isOnTablePage ? "overflow-hidden" : "overflow-y-auto"} scrollbar-thin`}>
          <PageShell>
            <Outlet />
          </PageShell>
        </main>
      </div>
    </div>
  );
}
