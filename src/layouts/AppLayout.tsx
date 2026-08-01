import { useState } from "react";
import { Outlet } from "react-router";
import { motion, AnimatePresence } from "framer-motion";
import { Building2, Plus } from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { CreateWorkspaceDialog } from "@/components/layout/CreateWorkspaceDialog";
import { Button } from "@/components/ui/button";
import { useActiveWorkspaceDataBootstrap, useWorkspace } from "@/hooks/useWorkspace";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { Skeleton } from "@/components/ui/skeleton";

export function AppLayout() {
  useActiveWorkspaceDataBootstrap();
  const { activeWorkspace, isLoadingWorkspaces } = useWorkspace();
  const isMobile = useIsMobile();
  const [createOpen, setCreateOpen] = useState(false);

  if (isLoadingWorkspaces) {
    return (
      <div className="flex h-screen items-center justify-center gap-3 bg-background">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
    );
  }

  if (!activeWorkspace) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-purple-500 text-white shadow-glow">
          <Building2 className="h-6 w-6" />
        </div>
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
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {!isMobile && <Sidebar />}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
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
