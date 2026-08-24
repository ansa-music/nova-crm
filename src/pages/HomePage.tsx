import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/EmptyState";
import { DeskCoverGrid } from "@/components/dashboard/DeskCoverGrid";
import { Skeleton } from "@/components/ui/skeleton";
import { CreatePageDialog } from "@/components/pagesnav/CreatePageDialog";
import { usePermissions } from "@/hooks/usePermissions";
import { usePeopleDesks } from "@/hooks/usePeopleDesks";
import { useWorkspace } from "@/hooks/useWorkspace";

/** `/` is an alias for the signed-in user's own desk. Never resumes someone else's last table. */
export default function HomePage() {
  const permissions = usePermissions();
  const { members } = useWorkspace();
  const { myDesk, coverPages, isLoadingWorkspaceData, ownerUid } = usePeopleDesks();
  const [createPageOpen, setCreatePageOpen] = useState(false);
  const navigate = useNavigate();

  if (isLoadingWorkspaceData) {
    return (
      <div className="mx-auto max-w-6xl p-5 sm:p-8">
        <Skeleton className="mb-3 h-6 w-32" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    );
  }

  if (myDesk) {
    return <Navigate to={`/page/${myDesk.id}`} replace />;
  }

  const newDesk =
    permissions.canCreatePages ? (
      <Button size="sm" className="min-h-11 gap-1.5" onClick={() => setCreatePageOpen(true)}>
        <Settings2 className="h-3.5 w-3.5" />
        Новый стол
      </Button>
    ) : undefined;

  return (
    <div className="mx-auto max-w-6xl p-5 sm:p-8 lg:p-10">
      <header className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow mb-1 text-primary">Главная</p>
          <h1 className="font-serif text-[1.85rem] font-medium tracking-[-0.03em] sm:text-[2.15rem]">Столы</h1>
          <p className="mt-1 text-sm text-muted-foreground">Своего стола пока нет — открой любой доступный.</p>
        </div>
        {newDesk}
      </header>

      {coverPages.length === 0 ? (
        <EmptyState
          className="rounded-2xl border border-border bg-card py-10"
          title="Своего стола пока нет"
          description="Главная откроет твой стол, как только он появится."
        />
      ) : (
        <DeskCoverGrid
          pages={coverPages}
          members={members}
          ownerUid={ownerUid}
          onOpen={(page) => navigate(`/page/${page.id}`)}
        />
      )}
      <CreatePageDialog open={createPageOpen} onOpenChange={setCreatePageOpen} />
    </div>
  );
}
