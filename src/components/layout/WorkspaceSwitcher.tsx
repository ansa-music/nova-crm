import { useState } from "react";
import { ChevronsUpDown, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CreateWorkspaceDialog } from "@/components/layout/CreateWorkspaceDialog";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useAuth } from "@/hooks/useAuth";
import { isWorkspaceAdmin } from "@/utils/adminAccess";
import { PAGE_ICON_MAP } from "@/utils/pageIcons";
import { cn } from "@/utils/cn";
import type { PageIconName } from "@/types";

export function WorkspaceSwitcher({ collapsed }: { collapsed?: boolean }) {
  const { workspaces, activeWorkspace, setActiveWorkspaceId } = useWorkspace();
  const { profile } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  const canCreateWorkspace = isWorkspaceAdmin(profile?.email);

  const ActiveIcon = activeWorkspace
    ? PAGE_ICON_MAP[(activeWorkspace.icon as PageIconName) ?? "Building2"] ?? PAGE_ICON_MAP.Building2
    : PAGE_ICON_MAP.Building2;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              "flex w-full items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent/40 px-2.5 py-2 text-left transition-colors hover:bg-sidebar-accent",
              collapsed && "justify-center px-0"
            )}
          >
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white"
              style={{ backgroundColor: activeWorkspace ? `hsl(${activeWorkspace.color})` : "hsl(243 75% 59%)" }}
            >
              <ActiveIcon className="h-4 w-4" />
            </span>
            {!collapsed && (
              <>
                <span className="flex-1 truncate text-sm font-medium text-sidebar-foreground">
                  {activeWorkspace?.name ?? "Выберите workspace"}
                </span>
                <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          {workspaces.map((ws) => {
            const Icon = PAGE_ICON_MAP[(ws.icon as PageIconName) ?? "Building2"] ?? PAGE_ICON_MAP.Building2;
            return (
              <DropdownMenuItem key={ws.id} onClick={() => setActiveWorkspaceId(ws.id)}>
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white"
                  style={{ backgroundColor: `hsl(${ws.color})` }}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="flex-1 truncate">{ws.name}</span>
                {ws.id === activeWorkspace?.id && (
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                )}
              </DropdownMenuItem>
            );
          })}
          {canCreateWorkspace && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                Создать workspace
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {canCreateWorkspace && <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />}
    </>
  );
}
