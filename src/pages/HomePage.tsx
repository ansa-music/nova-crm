import { Navigate } from "react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { usePeopleDesks } from "@/hooks/usePeopleDesks";
import { usePermissions } from "@/hooks/usePermissions";

/** `/` is the signed-in user's own desk. ОС (no desk by design) lands on «Технари», Тимлид on «Пользователи». Other deskless members go to covers on /desks — never a second grid on Dashboard. */
export default function HomePage() {
  const { myDesk, isLoadingWorkspaceData } = usePeopleDesks();
  const permissions = usePermissions();

  if (isLoadingWorkspaceData) {
    return (
      <div className="mx-auto max-w-6xl p-5 sm:p-8">
        <Skeleton className="mb-3 h-6 w-32" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    );
  }

  // Only a pure ОС: an ОС who is also a Технар has a desk to land on.
  if (permissions.isResolved && permissions.roles.every((role) => role === "os")) {
    return <Navigate to="/technicians" replace />;
  }

  // Тимлид works with people, not desk tables — unless they're a Технар too.
  if (permissions.isResolved && permissions.deskBlocked) {
    return <Navigate to="/users" replace />;
  }

  if (myDesk) {
    return <Navigate to={`/page/${myDesk.id}`} replace />;
  }

  return <Navigate to="/desks" replace />;
}
