// PATH: src/layouts/AppLayout.tsx  (REPLACES EXISTING)
import { useState, useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import { motion, AnimatePresence } from "framer-motion";
import { Building2, Lock, Plus } from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { Maximize2 } from "lucide-react";
import { CreateWorkspaceDialog } from "@/components/layout/CreateWorkspaceDialog";
import { NicknamePrompt } from "@/components/common/NicknamePrompt";
import { GlobalMessageToaster } from "@/components/common/GlobalMessageToaster";
import { SimulationBanner } from "@/components/common/RoleSwitcher";
import { AppBootScreen } from "@/components/common/AppBootScreen";
import { ShortcutsHelpDialog } from "@/components/common/ShortcutsHelpDialog";
import { GlobalUndoHotkeys } from "@/components/common/GlobalUndoHotkeys";
import { AccentColorSync } from "@/components/common/AccentColorSync";
import { Button } from "@/components/ui/button";
import { useActiveWorkspaceDataBootstrap, useWorkspace } from "@/hooks/useWorkspace";
import { useAppBootstrap } from "@/hooks/useAppBootstrap";
import { usePresenceHeartbeat } from "@/hooks/usePresenceHeartbeat";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useUiStore } from "@/store/uiStore";
import { isWorkspaceAdmin } from "@/utils/adminAccess";

export function AppLayout() {
  // Hooks always run before any early return, so the subscriptions keep making
  // progress while a boot screen is on-screen.
  useActiveWorkspaceDataBootstrap();
  usePresenceHeartbeat();
  const location = useLocation();
  const navigate = useNavigate();

  // "Продолжить с того места": on a genuinely fresh load of the app (this
  // effect has an empty dep array, so it runs exactly once per real page
  // load — NOT on every client-side navigation back to "/", which is what
  // clicking "Дашборд" in the sidebar does). If the person was last looking
  // at a table page, jump straight back instead of always showing the
  // Dashboard first.
  useEffect(() => {
    if (location.pathname !== "/") return;
    try {
      const lastPageId = window.localStorage.getItem("nova-crm:last-page-id");
      if (lastPageId) navigate(`/page/${lastPageId}`, { replace: true });
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { phase } = useAppBootstrap();
  const { activeWorkspace } = useWorkspace();
  const { profile } = useAuth();
  const isMobile = useIsMobile();
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
      <div className="page-surface flex h-screen flex-col items-center justify-center gap-5 bg-background px-4 text-center">
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
    <div className="page-surface flex h-screen overflow-hidden bg-background">
      <NicknamePrompt />
      <GlobalMessageToaster />
      <ShortcutsHelpDialog />
      <GlobalUndoHotkeys />
      <AccentColorSync />
      {!isMobile && !isFullscreen && <Sidebar />}
      <div className="flex min-w-0 flex-1 flex-col">
        {!isFullscreen && <Topbar />}
        {!isFullscreen && <SimulationBanner />}
        {isFullscreen && (
          <button
            onClick={() => setTableFullscreen(false)}
            title="Показать меню (Esc)"
            className="fixed left-3 top-3 z-50 flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card/90 text-muted-foreground backdrop-blur transition-colors hover:text-foreground"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        )}
        <main className="flex-1 overflow-y-auto scrollbar-thin">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
              className="h-full"
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
