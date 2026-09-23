import { Navigate } from "react-router";
import { AccessDenied } from "@/components/common/AccessDenied";
import { DailyDispatchPanel } from "@/components/dispatch/DailyDispatchPanel";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { DISPATCH_ENABLED } from "@/config/features";
import { hasFullAccess } from "@/utils/permissions";

export default function DispatchPage() {
  if (!DISPATCH_ENABLED) return <Navigate to="/" replace />;

  const { activeWorkspace, activeWorkspaceId, pages, members } = useWorkspace();
  const permissions = usePermissions();
  const { profile } = useAuth();

  // Real role gates whether the account can ever see this at all — an Owner
  // simulating Технарь via RoleSwitcher must lose the tab, so effectiveRole
  // (permissions.role) is checked too, same as the old per-desk tab's rule.
  const canSeeDispatch =
    permissions.isResolved &&
    (permissions.hasFullDeskAccess || permissions.realRole === "admin") &&
    (hasFullAccess(permissions.role) || permissions.role === "admin");
  const canBindDispatch = permissions.hasFullDeskAccess;

  if (!permissions.isResolved) return null;

  if (!canSeeDispatch) {
    return <AccessDenied reason="Выдача доступна только Owner и админам." />;
  }

  if (!activeWorkspaceId || !profile) return null;

  return (
    <DailyDispatchPanel
      workspaceId={activeWorkspaceId}
      uid={profile.uid}
      members={members}
      pages={pages}
      isOwner={canBindDispatch}
      responsibleOptions={activeWorkspace?.responsibleOptions ?? []}
    />
  );
}
