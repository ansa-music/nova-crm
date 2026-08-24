import { useRef, useState } from "react";
import { NavLink } from "react-router";
import { ChevronLeft, ChevronRight, EyeOff, LayoutDashboard, LogOut, Megaphone, MessageCircle, MessageSquare, Plus, Settings, User, Users } from "lucide-react";
import { motion } from "framer-motion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { MemberAvatar } from "@/components/common/MemberAvatar";
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
import { setActiveRole, toggleHiddenPage } from "@/services/memberService";
import { cn } from "@/utils/cn";
import { useUiStore } from "@/store/uiStore";
import { useUserPageNav } from "@/hooks/useUserPageNav";
import type { WorkspacePage } from "@/types";

export function Sidebar({ mobile }: { mobile?: boolean }) {
  const { profile } = useAuth();
  const { pages, activeWorkspaceId, members } = useWorkspace();
  const { workspaceChatUnread, privateUnreadTotal } = useInboxSummary(activeWorkspaceId, profile?.uid ?? null);
  const permissions = usePermissions();
  const pinnedCollapsed = useUiStore((s) => s.sidebarCollapsed) && !mobile;
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const [hoverOpen, setHoverOpen] = useState(false);
  const leaveTimer = useRef<number | null>(null);
  const collapsed = pinnedCollapsed && !hoverOpen;
  const [createPageOpen, setCreatePageOpen] = useState(false);
  const [editingPage, setEditingPage] = useState<WorkspacePage | null>(null);
  const [showHiddenPages, setShowHiddenPages] = useState(false);

  function handleEnter() {
    if (leaveTimer.current) window.clearTimeout(leaveTimer.current);
    if (pinnedCollapsed) setHoverOpen(true);
  }

  function handleLeave() {
    if (!pinnedCollapsed) return;
    leaveTimer.current = window.setTimeout(() => setHoverOpen(false), 180);
  }

  const myMembership = members.find((m) => m.uid === profile?.uid);
  const hiddenPageIds = myMembership?.hiddenPageIds ?? [];
  const { recentIds, pinnedIds, togglePin } = useUserPageNav(profile?.uid);

  const accessiblePages = pages.filter((p) => permissions.canAccessPage(p));
  const hiddenCount = accessiblePages.filter((p) => hiddenPageIds.includes(p.id)).length;
  const visiblePages = showHiddenPages
    ? accessiblePages
    : accessiblePages.filter((p) => !hiddenPageIds.includes(p.id));

  const pinnedSet = new Set(pinnedIds);
  const orderedPages = [
    ...pinnedIds.map((id) => visiblePages.find((p) => p.id === id)).filter((p): p is WorkspacePage => Boolean(p)),
    ...visiblePages.filter((p) => !pinnedSet.has(p.id)),
  ];
  const recentPages: WorkspacePage[] = [];
  const seenRecent = new Set<string>();
  for (const id of recentIds) {
    if (seenRecent.has(id)) continue;
    seenRecent.add(id);
    const page = accessiblePages.find((p) => p.id === id);
    if (!page) continue;
    if (!showHiddenPages && hiddenPageIds.includes(page.id)) continue;
    recentPages.push(page);
  }

  async function handleToggleHiddenPage(pageId: string, hide: boolean) {
    if (!activeWorkspaceId || !profile) return;
    await toggleHiddenPage(activeWorkspaceId, profile.uid, pageId, hide, hiddenPageIds);
  }

  return (
    <div
      className={cn(
        "relative z-40 mr-2 h-full shrink-0 transition-[width] duration-280 ease-out",
        pinnedCollapsed ? "w-[68px]" : "w-[228px]"
      )}
    >
    <div
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      className={cn(
        "os-sidebar hud-frame relative flex h-full flex-col gap-2 px-1.5 py-2.5 text-sidebar-foreground",
        "transition-[width,box-shadow] duration-280 ease-out",
        collapsed ? "w-[56px] items-center" : "w-[216px]",
        pinnedCollapsed && hoverOpen && "absolute inset-y-0 left-0 z-50 w-[216px] shadow-[0_0_48px_-16px_hsl(var(--primary)/0.45)]"
      )}
    >
      <WorkspaceSwitcher collapsed={collapsed} />

      {!collapsed ? (
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("nova:command-palette"))}
          className="flex h-8 items-center gap-2 rounded-md border border-sidebar-border/80 bg-background/40 px-2 text-[12px] text-muted-foreground transition-colors hover:border-border hover:text-foreground"
        >
          <span className="flex-1 truncate text-left">Найти или перейти…</span>
          <kbd className="rounded border border-border px-1 py-px font-mono text-[9px] tracking-wide">Ctrl K</kbd>
        </button>
      ) : (
        <button
          type="button"
          title="Командная строка (Ctrl K)"
          onClick={() => window.dispatchEvent(new Event("nova:command-palette"))}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
        >
          <span className="font-mono text-[10px]">K</span>
        </button>
      )}

      <nav className="flex flex-1 flex-col gap-3 overflow-y-auto scrollbar-thin">
        <div className="flex flex-col gap-0.5">
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <NavLink
                  to="/"
                  end
                  className={({ isActive }) =>
                    cn(
                      "relative flex h-9 w-9 items-center justify-center rounded-md transition-colors duration-200",
                      isActive ? "nav-link-active text-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent/80 hover:text-foreground"
                    )
                  }
                >
                  <LayoutDashboard className="h-4 w-4 shrink-0" />
                </NavLink>
              </TooltipTrigger>
              <TooltipContent side="right">Дашборд</TooltipContent>
            </Tooltip>
          ) : (
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                cn(
                  "nav-link",
                  isActive && "nav-link-active"
                )
              }
            >
              <LayoutDashboard className="h-4 w-4 shrink-0" />
              Дашборд
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
                      "relative flex h-9 w-9 items-center justify-center rounded-md transition-colors duration-200",
                      isActive ? "nav-link-active text-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent/80 hover:text-foreground"
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
                  "nav-link",
                  isActive && "nav-link-active"
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
                      "relative flex h-9 w-9 items-center justify-center rounded-md transition-colors duration-200",
                      isActive ? "nav-link-active text-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent/80 hover:text-foreground"
                    )
                  }
                >
                  <MessageSquare className="h-4 w-4 shrink-0" />
                  {workspaceChatUnread > 0 && (
                    <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
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
                  "nav-link",
                  isActive && "nav-link-active"
                )
              }
            >
              <MessageSquare className="h-4 w-4 shrink-0" />
              Чат Workspace
              {workspaceChatUnread > 0 && (
                <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
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
                      "relative flex h-9 w-9 items-center justify-center rounded-md transition-colors duration-200",
                      isActive ? "nav-link-active text-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent/80 hover:text-foreground"
                    )
                  }
                >
                  <MessageCircle className="h-4 w-4 shrink-0" />
                  {privateUnreadTotal > 0 && (
                    <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
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
                  "nav-link",
                  isActive && "nav-link-active"
                )
              }
            >
              <MessageCircle className="h-4 w-4 shrink-0" />
              Личные сообщения
              {privateUnreadTotal > 0 && (
                <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                  {privateUnreadTotal > 9 ? "9+" : privateUnreadTotal}
                </span>
              )}
            </NavLink>
          )}
        </div>

        <div className="flex flex-col gap-0.5">
          {!collapsed && (
            <div className="flex items-center justify-between px-2 pb-1">
              <span className="eyebrow px-2">Столы</span>
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
          {!collapsed && recentPages.length > 0 && (
            <div className="mb-1 flex flex-col gap-0.5">
              <span className="eyebrow px-2 pb-0.5">Недавние</span>
              {recentPages.map((page) => (
                <PageNavItem
                  key={`recent-${page.id}`}
                  page={page}
                  canManage={permissions.canManagePage(page)}
                  canDelete={permissions.canDeletePage(page)}
                  nextOrder={pages.length}
                  onEdit={setEditingPage}
                  collapsed={collapsed}
                  isHidden={hiddenPageIds.includes(page.id)}
                  onToggleHidden={handleToggleHiddenPage}
                  isPinned={pinnedSet.has(page.id)}
                  onTogglePin={togglePin}
                />
              ))}
            </div>
          )}
          {orderedPages.map((page) => (
            <PageNavItem
              key={page.id}
              page={page}
              canManage={permissions.canManagePage(page)}
              canDelete={permissions.canDeletePage(page)}
              nextOrder={pages.length}
              onEdit={setEditingPage}
              collapsed={collapsed}
              isHidden={hiddenPageIds.includes(page.id)}
              onToggleHidden={handleToggleHiddenPage}
              isPinned={pinnedSet.has(page.id)}
              onTogglePin={togglePin}
            />
          ))}
          {orderedPages.length === 0 && !collapsed && (
            <p className="px-2 text-xs text-muted-foreground">Пока нет доступных страниц</p>
          )}
          {!collapsed && hiddenCount > 0 && (
            <button
              onClick={() => setShowHiddenPages((v) => !v)}
              className={cn(
                "mt-1 flex items-center gap-1.5 rounded-lg px-2 py-1 font-mono text-[11px] uppercase tracking-wide",
                showHiddenPages ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <EyeOff className="h-3 w-3" />
              {showHiddenPages ? "Скрыть скрытые" : `Показать скрытые (${hiddenCount})`}
            </button>
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
                        "relative flex items-center justify-center rounded-lg p-2 transition-colors",
                        isActive ? "nav-link-active text-primary" : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
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
                    "relative flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors",
                    isActive ? "nav-link-active text-primary" : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
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
                      "relative flex h-9 w-9 items-center justify-center rounded-md transition-colors duration-200",
                      isActive ? "nav-link-active text-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent/80 hover:text-foreground"
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
                  "nav-link",
                  isActive && "nav-link-active"
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
              "flex min-h-9 items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors duration-200 hover:bg-sidebar-accent/80",
              collapsed && "justify-center px-0"
            )}
          >
            {profile ? (
              <MemberAvatar
                id={profile.uid}
                name={profile.name}
                nickname={profile.nickname}
                photoURL={profile.photoURL}
                className="h-7 w-7"
              />
            ) : (
              <Avatar className="h-7 w-7">
                <AvatarFallback>
                  <User className="h-3.5 w-3.5" />
                </AvatarFallback>
              </Avatar>
            )}
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
          type="button"
          onClick={toggleSidebar}
          title={pinnedCollapsed ? "Закрепить меню" : "Свернуть в рейку"}
          className="absolute -right-2.5 top-[3.4rem] flex h-6 w-6 items-center justify-center rounded-full border border-border/80 bg-card/90 text-muted-foreground backdrop-blur hover:text-foreground"
        >
          {pinnedCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
        </motion.button>
      )}

      <CreatePageDialog open={createPageOpen} onOpenChange={setCreatePageOpen} />
      <EditPageDialog key={editingPage?.id ?? "none"} page={editingPage} onOpenChange={() => setEditingPage(null)} />
    </div>
    </div>
  );
}
