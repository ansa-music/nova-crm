// PATH: src/layouts/AppLayout.tsx  (REPLACES EXISTING)
import { useState } from "react";
import { Outlet } from "react-router";
import { motion, AnimatePresence } from "framer-motion";
import { Building2, Lock, Plus } from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { CreateWorkspaceDialog } from "@/components/layout/CreateWorkspaceDialog";
import { NicknamePrompt } from "@/components/common/NicknamePrompt";
import { GlobalMessageToaster } from "@/components/common/GlobalMessageToaster";
import { SimulationBanner } from "@/components/common/RoleSwitcher";
import { AppBootScreen } from "@/components/common/AppBootScreen";
import { ShortcutsHelpDialog } from "@/components/common/ShortcutsHelpDialog";
import { Button } from "@/components/ui/button";
import { useActiveWorkspaceDataBootstrap, useWorkspace } from "@/hooks/useWorkspace";
import { useAppBootstrap } from "@/hooks/useAppBootstrap";
import { usePresenceHeartbeat } from "@/hooks/usePresenceHeartbeat";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { isWorkspaceAdmin } from "@/utils/adminAccess";

export function AppLayout() {
  // Hooks always run before any early return, so the subscriptions keep making
  // progress while a boot screen is on-screen.
  useActiveWorkspaceDataBootstrap();
  usePresenceHeartbeat();

  const { phase } = useAppBootstrap();
  const { activeWorkspace } = useWorkspace();
  const { profile } = useAuth();
  const isMobile = useIsMobile();
  const [createOpen, setCreateOpen] = useState(false);

  const canCreateWorkspace = isWorkspaceAdmin(profile?.email);

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
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-purple-500 text-white shadow-glow">
          {canCreateWorkspace ? <Building2 className="h-6 w-6" /> : <Lock className="h-6 w-6" />}
        </div>
        {canCreateWorkspace ? (
          <>
            <div>
              <h1 className="text-lg font-semibold">Начните с создания workspace</h1>
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
            <h1 className="text-lg font-semibold">У вас пока нет доступа ни к одному workspace</h1>
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
      {!isMobile && <Sidebar />}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <SimulationBanner />
        <main className="flex-1 overflow-y-auto scrollbar-thin">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeWorkspace.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
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
