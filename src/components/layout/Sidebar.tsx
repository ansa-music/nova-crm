import { useState } from "react";
import { NavLink } from "react-router";
import { ChevronLeft, ChevronRight, LayoutDashboard, LogOut, Megaphone, MessageCircle, MessageSquare, Plus, Settings, User, Users } from "lucide-react";
import { motion } from "framer-motion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { WorkspaceSwitcher } from "@/components/layout/WorkspaceSwitcher";
import { PageNavItem } from "@/components/pagesnav/PageNavItem";
import { CreatePageDialog } from "@/components/pagesnav/CreatePageDialog";
import { EditPageDialog } from "@/components/pagesnav/EditPageDialog";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useInboxSummary } from "@/hooks/useInboxSummary";
import { usePermissions } from "@/hooks/usePermissions";
import { signOutUser } from "@/firebase/auth";
import { setActiveRole } from "@/services/memberService";
import { cn } from "@/utils/cn";
import { useUiStore } from "@/store/uiStore";
import type { WorkspacePage } from "@/types";

export function Sidebar({ mobile }: { mobile?: boolean }) {
  const { profile } = useAuth();
  const { pages, activeWorkspaceId } = useWorkspace();
  const { workspaceChatUnread, privateUnreadTotal } = useInboxSummary(activeWorkspaceId, profile?.uid ?? null);
  const permissions = usePermissions();
  const collapsed = useUiStore((s) => s.sidebarCollapsed) && !mobile;
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const [createPageOpen, setCreatePageOpen] = useState(false);
  const [editingPage, setEditingPage] = useState<WorkspacePage | null>(null);

  const visiblePages = pages.filter((p) => permissions.canAccessPage(p));

  return (
    <div
      className={cn(
        "relative flex h-full flex-col gap-4 border-r border-sidebar-border bg-sidebar px-2 py-3 text-sidebar-foreground",
        collapsed ? "w-[68px] items-center" : "w-[236px]"
      )}
    >
      <WorkspaceSwitcher collapsed={collapsed} />

      <nav className="flex flex-1 flex-col gap-4 overflow-y-auto scrollbar-thin">
        <div className="flex flex-col gap-0.5">
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <NavLink
                  to="/"
                  end
                  className={({ isActive }) =>
                    cn(
                      "flex items-center justify-center rounded-lg p-2 transition-colors",
                      isActive ? "bg-sidebar-accent text-primary" : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
                    )
                  }
                >
                  <LayoutDashboard className="h-4 w-4 shrink-0" />
                </NavLink>
              </TooltipTrigger>
              <TooltipContent side="right">Dashboard</TooltipContent>
            </Tooltip>
          ) : (
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors",
                  isActive ? "bg-sidebar-accent text-primary" : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
                )
              }
            >
              <LayoutDashboard className="h-4 w-4 shrink-0" />
              Dashboard
            </NavLink>
          )}
        </div>

        <div className="flex flex-col gap-0.5">
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <NavLink
                  to="/announcements"
                  className={({ isActive }) =>
                    cn(
                      "flex items-center justify-center rounded-lg p-2 transition-colors",
                      isActive ? "bg-sidebar-accent text-primary" : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
                    )
                  }
                >
                  <Megaphone className="h-4 w-4 shrink-0" />
                </NavLink>
              </TooltipTrigger>
              <TooltipContent side="right">Объявления</TooltipContent>
            </Tooltip>
          ) : (
            <NavLink
              to="/announcements"
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors",
                  isActive ? "bg-sidebar-accent text-primary" : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
                )
              }
            >
              <Megaphone className="h-4 w-4 shrink-0" />
              Объявления
            </NavLink>
          )}
        </div>

        <div className="flex flex-col gap-0.5">
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <NavLink
                  to="/chat"
                  className={({ isActive }) =>
                    cn(
                      "relative flex items-center justify-center rounded-lg p-2 transition-colors",
                      isActive ? "bg-sidebar-accent text-primary" : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
                    )
                  }
                >
                  <MessageSquare className="h-4 w-4 shrink-0" />
                  {workspaceChatUnread > 0 && (
                    <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-red-500" />
                  )}
                </NavLink>
              </TooltipTrigger>
              <TooltipContent side="right">Чат Workspace</TooltipContent>
            </Tooltip>
          ) : (
            <NavLink
              to="/chat"
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors",
                  isActive ? "bg-sidebar-accent text-primary" : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
                )
              }
            >
              <MessageSquare className="h-4 w-4 shrink-0" />
              Чат Workspace
              {workspaceChatUnread > 0 && (
                <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
                  {workspaceChatUnread > 9 ? "9+" : workspaceChatUnread}
                </span>
              )}
            </NavLink>
          )}
        </div>

        <div className="flex flex-col gap-0.5">
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <NavLink
                  to="/messages"
                  className={({ isActive }) =>
                    cn(
                      "relative flex items-center justify-center rounded-lg p-2 transition-colors",
                      isActive ? "bg-sidebar-accent text-primary" : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
                    )
                  }
                >
                  <MessageCircle className="h-4 w-4 shrink-0" />
                  {privateUnreadTotal > 0 && (
                    <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-red-500" />
                  )}
                </NavLink>
              </TooltipTrigger>
              <TooltipContent side="right">Личные сообщения</TooltipContent>
            </Tooltip>
          ) : (
            <NavLink
              to="/messages"
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors",
                  isActive ? "bg-sidebar-accent text-primary" : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
                )
              }
            >
              <MessageCircle className="h-4 w-4 shrink-0" />
              Личные сообщения
              {privateUnreadTotal > 0 && (
                <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
                  {privateUnreadTotal > 9 ? "9+" : privateUnreadTotal}
                </span>
              )}
            </NavLink>
          )}
        </div>

        <div className="flex flex-col gap-0.5">
          {!collapsed && (
            <div className="flex items-center justify-between px-2 pb-1">
              <span className="eyebrow px-2">Страницы</span>
              {permissions.canCreatePages && (
                <button
                  onClick={() => setCreatePageOpen(true)}
                  className="rounded p-0.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                  title="Добавить страницу"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
          {visiblePages.map((page) => (
            <PageNavItem
              key={page.id}
              page={page}
              canManage={permissions.canManagePage(page)}
              canDelete={permissions.canDeletePage(page)}
              nextOrder={pages.length}
              onEdit={setEditingPage}
              collapsed={collapsed}
            />
          ))}
          {visiblePages.length === 0 && !collapsed && (
            <p className="px-2 text-xs text-muted-foreground">Пока нет доступных страниц</p>
          )}
          {collapsed && permissions.canCreatePages && (
            <button
              onClick={() => setCreatePageOpen(true)}
              className="flex items-center justify-center rounded-lg p-2 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              title="Добавить страницу"
            >
              <Plus className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="mt-auto flex flex-col gap-0.5">
          {permissions.canManageWorkspace &&
            (collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <NavLink
                    to="/users"
                    className={({ isActive }) =>
                      cn(
                        "flex items-center justify-center rounded-lg p-2 transition-colors",
                        isActive ? "bg-sidebar-accent text-primary" : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
                      )
                    }
                  >
                    <Users className="h-4 w-4 shrink-0" />
                  </NavLink>
                </TooltipTrigger>
                <TooltipContent side="right">Пользователи</TooltipContent>
              </Tooltip>
            ) : (
              <NavLink
                to="/users"
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors",
                    isActive ? "bg-sidebar-accent text-primary" : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
                  )
                }
              >
                <Users className="h-4 w-4 shrink-0" />
                Пользователи
              </NavLink>
            ))}
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <NavLink
                  to="/settings"
                  className={({ isActive }) =>
                    cn(
                      "flex items-center justify-center rounded-lg p-2 transition-colors",
                      isActive ? "bg-sidebar-accent text-primary" : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
                    )
                  }
                >
                  <Settings className="h-4 w-4 shrink-0" />
                </NavLink>
              </TooltipTrigger>
              <TooltipContent side="right">Настройки</TooltipContent>
            </Tooltip>
          ) : (
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors",
                  isActive ? "bg-sidebar-accent text-primary" : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
                )
              }
            >
              <Settings className="h-4 w-4 shrink-0" />
              Настройки
            </NavLink>
          )}
        </div>
      </nav>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              "flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-sidebar-accent/60",
              collapsed && "justify-center px-0"
            )}
          >
            <Avatar className="h-7 w-7">
              <AvatarImage src={profile?.photoURL ?? undefined} />
              <AvatarFallback>{profile?.name?.[0]?.toUpperCase() ?? <User className="h-3.5 w-3.5" />}</AvatarFallback>
            </Avatar>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{profile?.name}</p>
                <p className="truncate text-xs text-muted-foreground">{profile?.email}</p>
              </div>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem asChild>
            <NavLink to="/settings">
              <User className="h-4 w-4" /> Профиль
            </NavLink>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={async () => {
              // Best-effort: clear any simulated role before ending the
              // session, so a later sign-in never inherits a forgotten
              // "Переключение режима привилегий" state.
              if (activeWorkspaceId && profile) {
                try {
                  await setActiveRole(activeWorkspaceId, profile.uid, null);
                } catch {
                  // Non-blocking — sign out regardless.
                }
              }
              signOutUser();
            }}
            className="text-destructive focus:text-destructive"
          >
            <LogOut className="h-4 w-4" /> Выйти
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {!mobile && (
        <motion.button
          onClick={toggleSidebar}
          whileTap={{ scale: 0.9 }}
          className="absolute -right-3 top-16 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-subtle hover:text-foreground"
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
        </motion.button>
      )}

      <CreatePageDialog open={createPageOpen} onOpenChange={setCreatePageOpen} />
      <EditPageDialog key={editingPage?.id ?? "none"} page={editingPage} onOpenChange={() => setEditingPage(null)} />
    </div>
  );
}
