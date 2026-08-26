import { ShieldCheck } from "lucide-react";
import { DailyDispatchPanel } from "@/components/dispatch/DailyDispatchPanel";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";

export default function DispatchPage() {
  const { activeWorkspace, activeWorkspaceId, pages, members } = useWorkspace();
  const permissions = usePermissions();
  const { profile } = useAuth();

  // Real role gates whether the account can ever see this at all — an Owner
  // simulating Технар via RoleSwitcher must lose the tab, so effectiveRole
  // (permissions.role) is checked too, same as the old per-desk tab's rule.
  const canSeeDispatch =
    permissions.isResolved &&
    (permissions.realRole === "owner" || permissions.realRole === "admin" || permissions.isWorkspaceOwner) &&
    (permissions.role === "owner" || permissions.role === "admin");
  const canBindDispatch = permissions.isWorkspaceOwner || permissions.realRole === "owner";

  if (!permissions.isResolved) return null;

  if (!canSeeDispatch) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <ShieldCheck className="h-8 w-8 text-muted-foreground" />
        <p className="text-lg font-semibold">Доступ ограничен</p>
        <p className="text-sm text-muted-foreground">Выдача доступна только Owner и админам.</p>
      </div>
    );
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
