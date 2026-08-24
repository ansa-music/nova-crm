import { AlertTriangle, ShieldCheck } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { setActiveRole } from "@/services/memberService";
import { logChange } from "@/services/historyService";
import { ROLE_LABELS } from "@/types";
import { cn } from "@/utils/cn";
import type { Role } from "@/types";

/** Small persistent banner shown whenever a real Owner/Admin is currently simulating a different role. Include near the top of the app shell. */
export function SimulationBanner() {
  const permissions = usePermissions();
  const { profile } = useAuth();
  const { activeWorkspaceId } = useWorkspace();

  if (!permissions.isSimulating) return null;

  async function handleReturn() {
    if (!activeWorkspaceId || !profile) return;
    await setActiveRole(activeWorkspaceId, profile.uid, null);
  }

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-600 dark:text-amber-400">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span>
        Режим «{ROLE_LABELS[permissions.role]}» — ваша реальная роль {ROLE_LABELS[permissions.realRole]}.
      </span>
      <button onClick={handleReturn} className="ml-auto shrink-0 font-medium underline underline-offset-2">
        Вернуть мой реальный режим
      </button>
    </div>
  );
}

/** Dropdown switcher for the topbar — renders nothing for Manager/Viewer, who have nothing to switch. */
export function RoleSwitcher({ embedded = false }: { embedded?: boolean } = {}) {
  const permissions = usePermissions();
  const { profile } = useAuth();
  const { activeWorkspaceId } = useWorkspace();

  if (permissions.allowedSimulatedRoles.length === 0) return null;

  async function handleSelect(target: Role) {
    if (!activeWorkspaceId || !profile) return;
    const from = permissions.role;
    try {
      await setActiveRole(activeWorkspaceId, profile.uid, target === permissions.realRole ? null : target);
      toast.success(target === permissions.realRole ? "Вернулись к реальной роли" : `Режим: ${ROLE_LABELS[target]}`);
      // Reuses the existing workspace history log — no new audit system.
      logChange({
        workspaceId: activeWorkspaceId,
        action: "update",
        field: "activeRole",
        fieldLabel: "Режим доступа",
        oldValue: ROLE_LABELS[from],
        newValue: ROLE_LABELS[target],
        userId: profile.uid,
        userName: profile.nickname || profile.name,
      }).catch(() => {});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось переключить режим");
    }
  }

  const panel = (
    <div className={cn(!embedded && "contents")}>
        <p className="mb-2 text-xs font-semibold text-muted-foreground">Режим доступа</p>
        <p className="mb-2 text-xs text-muted-foreground">
          Реальная роль: <span className="font-medium text-foreground">{ROLE_LABELS[permissions.realRole]}</span>
          <br />
          Текущий режим: <span className="font-medium text-foreground">{ROLE_LABELS[permissions.role]}</span>
        </p>
        <div className="flex flex-col gap-0.5">
          {permissions.allowedSimulatedRoles.map((r) => (
            <button
              key={r}
              onClick={() => handleSelect(r)}
              className={cn(
                "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-accent",
                permissions.role === r && "bg-accent font-medium"
              )}
            >
              <span
                className={cn(
                  "h-2.5 w-2.5 shrink-0 rounded-full border-2",
                  permissions.role === r ? "border-primary bg-primary" : "border-muted-foreground"
                )}
              />
              {ROLE_LABELS[r]}
              {r === permissions.realRole && <span className="ml-auto text-[10px] text-muted-foreground">реальная</span>}
            </button>
          ))}
        </div>
        {permissions.isSimulating && (
          <Button size="sm" variant="outline" className="mt-2 w-full" onClick={() => handleSelect(permissions.realRole)}>
            Вернуть мой реальный режим
          </Button>
        )}
    </div>
  );

  if (embedded) return panel;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={permissions.isSimulating ? "default" : "ghost"}
          size="sm"
          className={cn("gap-1.5", permissions.isSimulating && "bg-amber-500 text-white hover:bg-amber-500/90")}
          title="Режим доступа"
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          {ROLE_LABELS[permissions.role]}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 p-3">
        {panel}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
