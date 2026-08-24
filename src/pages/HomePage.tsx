import { useState } from "react";
import { Navigate } from "react-router";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { CreatePageDialog } from "@/components/pagesnav/CreatePageDialog";
import { usePermissions } from "@/hooks/usePermissions";
import { usePeopleDesks } from "@/hooks/usePeopleDesks";

/** `/` is an alias for the signed-in user's own desk. Never resumes someone else's last table. */
export default function HomePage() {
  const permissions = usePermissions();
  const { myDesk, isLoadingWorkspaceData } = usePeopleDesks();
  const [createPageOpen, setCreatePageOpen] = useState(false);

  if (isLoadingWorkspaceData) {
    return (
      <div className="mx-auto max-w-xl p-5 sm:p-8">
        <Skeleton className="mb-3 h-6 w-32" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    );
  }

  if (myDesk) {
    return <Navigate to={`/page/${myDesk.id}`} replace />;
  }

  return (
    <div className="mx-auto max-w-xl p-5 sm:p-8">
      <EmptyState
        className="rounded-2xl border border-border bg-card py-10"
        title="Своего стола пока нет"
        description="Главная откроет твой стол, как только он появится."
        action={
          permissions.canCreatePages ? (
            <Button size="sm" className="min-h-11 gap-1.5" onClick={() => setCreatePageOpen(true)}>
              <Settings2 className="h-3.5 w-3.5" />
              Новый стол
            </Button>
          ) : undefined
        }
      />
      <CreatePageDialog open={createPageOpen} onOpenChange={setCreatePageOpen} />
    </div>
  );
}
