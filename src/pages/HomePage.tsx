import { Navigate } from "react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { usePeopleDesks } from "@/hooks/usePeopleDesks";

/** `/` is the signed-in user's own desk. Deskless members go to covers on /desks — never a second grid on Dashboard. */
export default function HomePage() {
  const { myDesk, isLoadingWorkspaceData } = usePeopleDesks();

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

  return <Navigate to="/desks" replace />;
}
