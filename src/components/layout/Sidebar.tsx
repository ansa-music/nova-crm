import { useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router";
import {
  ChevronLeft,
  ChevronRight,
  Keyboard,
  KeyRound,
  Home,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  Megaphone,
  MessageCircle,
  MessageSquare,
  MoreVertical,
  Plus,
  Settings,
  User,
  Users,
  UsersRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { RoleSwitcher } from "@/components/common/RoleSwitcher";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { CreatePageDialog } from "@/components/pagesnav/CreatePageDialog";
import { CreateWorkspaceDialog } from "@/components/layout/CreateWorkspaceDialog";
import { isWorkspaceAdmin } from "@/utils/adminAccess";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { usePermissions } from "@/hooks/usePermissions";
import { signOutUser } from "@/firebase/auth";
import { setActiveRole } from "@/services/memberService";
import { cn } from "@/utils/cn";
import { useUiStore } from "@/store/uiStore";
import { THEME_OPTIONS } from "@/components/layout/ThemeToggle";
import { usePeopleDesks } from "@/hooks/usePeopleDesks";
import { useInboxSummary } from "@/hooks/useInboxSummary";


function navActiveClass(active: boolean, collapsed?: boolean) {
  if (collapsed) {
    return cn(
      "flex h-11 w-11 items-center justify-center rounded-xl",
      active ? "bg-sidebar-accent text-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent/80"
    );
  }
  return cn(
    "flex min-h-11 w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-[14px] font-medium",
    active ? "bg-sidebar-accent text-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent/80"
  );
}

function AppNavLink({
  to,
  end,
  icon: Icon,
  children,
  onNavigate,
  forceActive,
  badge,
}: {
  to: string;
  end?: boolean;
  icon: LucideIcon;
  children: ReactNode;
  onNavigate?: () => void;
  forceActive?: boolean;
  badge?: number;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={() => onNavigate?.()}
      className={({ isActive }) => navActiveClass(forceActive ?? isActive)}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {badge ? (
        <span className="ml-auto shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground">
          {badge > 9 ? "9+" : badge}
        </span>
      ) : null}
    </NavLink>
  );
}

export function Sidebar({ mobile, onNavigate }: { mobile?: boolean; onNavigate?: () => void }) {
  const { profile } = useAuth();
  const { members, activeWorkspaceId, workspaces, activeWorkspace, setActiveWorkspaceId } = useWorkspace();
  const permissions = usePermissions();
  const { myDesk } = usePeopleDesks();
  const { privateUnreadTotal, workspaceChatUnread } = useInboxSummary(
    activeWorkspaceId,
    profile?.uid ?? null,
    { includeWorkspaceChat: true }
  );
  const location = useLocation();
  const navigate = useNavigate();
  const pinnedCollapsed = useUiStore((s) => s.sidebarCollapsed) && !mobile;
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const collapsed = pinnedCollapsed;
  const [createPageOpen, setCreatePageOpen] = useState(false);
  const [createWsOpen, setCreateWsOpen] = useState(false);
  const canCreateWorkspace = isWorkspaceAdmin(profile?.email);
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);

  const myMembership = members.find((m) => m.uid === profile?.uid);
  const showUsersNav = permissions.canManageUsers;
  const homeTo = myDesk ? `/page/${myDesk.id}` : "/";
  const homeActive = location.pathname === "/" || Boolean(myDesk && location.pathname === `/page/${myDesk.id}`);
  function goHome() {
    navigate(homeTo);
    onNavigate?.();
  }

  return (
    <div
      className={cn(
        "relative z-40 shrink-0",
        mobile
          ? "mr-0 h-full min-h-0 w-full bg-background"
          : cn("h-full transition-[width] duration-280 ease-out", pinnedCollapsed ? "w-[72px]" : "w-[248px]")
      )}
    >
      <div
        className={cn(
          "relative flex h-full min-h-0 flex-col bg-background/95 text-sidebar-foreground",
          mobile ? "w-full px-3 py-4" : cn("border-r border-primary/25 px-3 py-4", collapsed ? "w-[72px] items-center px-2" : "w-[248px]")
        )}
      >
        <div className={cn("mb-5 flex items-center", collapsed ? "justify-center" : "justify-between gap-2 pr-1")}>
          {collapsed ? (
            <div className="flex flex-col items-center gap-2">
              <button type="button" onClick={goHome} className="wordmark text-lg" title="Главная">
                N
              </button>
              <NotificationBell />
            </div>
          ) : (
            <>
              <button type="button" onClick={goHome} className="flex min-w-0 items-center gap-2" title="Главная">
                <span className="wordmark text-[22px] leading-none">NOVA</span>
                <span className="desk-accent-mark h-4 w-0.5 shrink-0 rounded-full" aria-hidden />
              </button>
              {!mobile && <NotificationBell />}
            </>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-thin">
          {!mobile && (
            <nav className="mb-4 flex shrink-0 flex-col gap-0.5" aria-label="Разделы">
              {collapsed ? (
                <>
                  <NavLink to={homeTo} title="Главная" onClick={() => { navigate(homeTo); onNavigate?.(); }} className={navActiveClass(homeActive, true)}>
                    <Home className="h-4 w-4" />
                  </NavLink>
                  <NavLink
                    to="/dashboard"
                    title="Дашборд"
                    onClick={() => onNavigate?.()}
                    className={({ isActive }) => navActiveClass(isActive, true)}
                  >
                    <LayoutDashboard className="h-4 w-4" />
                  </NavLink>
                  <NavLink
                    to="/desks"
                    title="Столы"
                    onClick={() => onNavigate?.()}
                    className={({ isActive }) => navActiveClass(isActive, true)}
                  >
                    <LayoutGrid className="h-4 w-4" />
                  </NavLink>
                  <NavLink
                    to="/people"
                    title="Люди"
                    onClick={() => onNavigate?.()}
                    className={({ isActive }) => navActiveClass(isActive, true)}
                  >
                    <UsersRound className="h-4 w-4" />
                  </NavLink>
                  <NavLink
                    to="/settings"
                    title="Настройки"
                    onClick={() => onNavigate?.()}
                    className={({ isActive }) => navActiveClass(isActive, true)}
                  >
                    <Settings className="h-4 w-4" />
                  </NavLink>
                  <NavLink
                    to="/announcements"
                    title="Объявления"
                    onClick={() => onNavigate?.()}
                    className={({ isActive }) => navActiveClass(isActive, true)}
                  >
                    <Megaphone className="h-4 w-4" />
                  </NavLink>
                  <NavLink
                    to="/messages"
                    title="Сообщения"
                    onClick={() => onNavigate?.()}
                    className={({ isActive }) => navActiveClass(isActive, true)}
                  >
                    <span className="relative">
                      <MessageCircle className="h-4 w-4" />
                      {privateUnreadTotal > 0 && (
                        <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-primary" />
                      )}
                    </span>
                  </NavLink>
                  <NavLink
                    to="/chat"
                    title="Чат"
                    onClick={() => onNavigate?.()}
                    className={({ isActive }) => navActiveClass(isActive, true)}
                  >
                    <span className="relative">
                      <MessageSquare className="h-4 w-4" />
                      {workspaceChatUnread > 0 && (
                        <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-primary" />
                      )}
                    </span>
                  </NavLink>
                  <NavLink
                    to="/grok-limit"
                    title="GROK LIMIT"
                    onClick={() => onNavigate?.()}
                    className={({ isActive }) => navActiveClass(isActive, true)}
                  >
                    <KeyRound className="h-4 w-4" />
                  </NavLink>
                  {showUsersNav && (
                    <NavLink
                      to="/users"
                      title="Пользователи"
                      onClick={() => onNavigate?.()}
                      className={({ isActive }) => navActiveClass(isActive, true)}
                    >
                      <Users className="h-4 w-4" />
                    </NavLink>
                  )}
                </>
              ) : (
                <>
                  <AppNavLink to={homeTo} icon={Home} forceActive={homeActive} onNavigate={() => { navigate(homeTo); onNavigate?.(); }}>
                    Главная
                  </AppNavLink>
                  <AppNavLink to="/dashboard" icon={LayoutDashboard} onNavigate={onNavigate}>
                    Дашборд
                  </AppNavLink>
                  <AppNavLink to="/desks" icon={LayoutGrid} onNavigate={onNavigate}>
                    Столы
                  </AppNavLink>
                  <AppNavLink to="/people" icon={UsersRound} onNavigate={onNavigate}>
                    Люди
                  </AppNavLink>
                  <AppNavLink to="/settings" icon={Settings} onNavigate={onNavigate}>
                    Настройки
                  </AppNavLink>
                  <AppNavLink to="/announcements" icon={Megaphone} onNavigate={onNavigate}>
                    Объявления
                  </AppNavLink>
                  <AppNavLink to="/messages" icon={MessageCircle} onNavigate={onNavigate} badge={privateUnreadTotal}>
                    Сообщения
                  </AppNavLink>
                  <AppNavLink to="/chat" icon={MessageSquare} onNavigate={onNavigate} badge={workspaceChatUnread}>
                    Чат
                  </AppNavLink>
                  <AppNavLink to="/grok-limit" icon={KeyRound} onNavigate={onNavigate}>
                    GROK LIMIT
                  </AppNavLink>
                  {showUsersNav && (
                    <AppNavLink to="/users" icon={Users} onNavigate={onNavigate}>
                      Пользователи
                    </AppNavLink>
                  )}
                </>
              )}
            </nav>
          )}
          {mobile && (
            <nav className="mb-4 flex shrink-0 flex-col gap-0.5" aria-label="Разделы">
              <AppNavLink to={homeTo} icon={Home} forceActive={homeActive} onNavigate={() => { navigate(homeTo); onNavigate?.(); }}>
                Главная
              </AppNavLink>
              <AppNavLink to="/dashboard" icon={LayoutDashboard} onNavigate={onNavigate}>
                Дашборд
              </AppNavLink>
              <AppNavLink to="/desks" icon={LayoutGrid} onNavigate={onNavigate}>
                Столы
              </AppNavLink>
              <AppNavLink to="/people" icon={UsersRound} onNavigate={onNavigate}>
                Люди
              </AppNavLink>
              <AppNavLink to="/settings" icon={Settings} onNavigate={onNavigate}>
                Настройки
              </AppNavLink>
              <AppNavLink to="/announcements" icon={Megaphone} onNavigate={onNavigate}>
                Объявления
              </AppNavLink>
              <AppNavLink to="/messages" icon={MessageCircle} onNavigate={onNavigate} badge={privateUnreadTotal}>
                Сообщения
              </AppNavLink>
              <AppNavLink to="/chat" icon={MessageSquare} onNavigate={onNavigate} badge={workspaceChatUnread}>
                Чат
              </AppNavLink>
              <AppNavLink to="/grok-limit" icon={KeyRound} onNavigate={onNavigate}>
                GROK LIMIT
              </AppNavLink>
              {showUsersNav && (
                <AppNavLink to="/users" icon={Users} onNavigate={onNavigate}>
                  Пользователи
                </AppNavLink>
              )}
              {permissions.canCreatePages && (
                <button
                  type="button"
                  onClick={() => setCreatePageOpen(true)}
                  className="flex min-h-11 w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-[14px] font-medium text-sidebar-foreground hover:bg-sidebar-accent/80"
                >
                  <Plus className="h-4 w-4 shrink-0" />
                  Новый стол
                </button>
              )}
            </nav>
          )}
        </div>

        <div className={cn("mt-3 flex items-center border-t border-primary/20 pt-3", collapsed ? "justify-center" : "gap-1")}>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "relative flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl px-1.5 py-1 text-left hover:bg-sidebar-accent/80",
                  collapsed && "flex-none justify-center px-0"
                )}
              >
                {profile ? (
                  <span className="relative shrink-0">
                    <MemberAvatar
                      id={profile.uid}
                      name={profile.name}
                      nickname={profile.nickname}
                      photoURL={profile.photoURL}
                      className="h-8 w-8"
                    />
                    {privateUnreadTotal + workspaceChatUnread > 0 && (
                      <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary" />
                    )}
                  </span>
                ) : (
                  <Avatar className="h-8 w-8">
                    <AvatarFallback>
                      <User className="h-3.5 w-3.5" />
                    </AvatarFallback>
                  </Avatar>
                )}
                {!collapsed && (
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-foreground">
                      {profile?.nickname || profile?.name}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {myMembership?.role === "owner" ? "Владелец" : profile?.email}
                    </span>
                  </span>
                )}
                {!collapsed && <MoreVertical className="h-4 w-4 shrink-0 text-muted-foreground" />}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="z-[300] w-56">
              {workspaces.map((ws) => (
                <DropdownMenuItem key={ws.id} onClick={() => setActiveWorkspaceId(ws.id)}>
                  {ws.name}
                  {ws.id === activeWorkspace?.id ? " ·" : ""}
                </DropdownMenuItem>
              ))}
              {canCreateWorkspace && (
                <DropdownMenuItem onClick={() => setCreateWsOpen(true)}>
                  <Plus className="h-4 w-4" /> Создать workspace
                </DropdownMenuItem>
              )}
              {!mobile && (
                <>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <NavLink to="/settings" onClick={() => onNavigate?.()}>
                  <Settings className="h-4 w-4" /> Настройки
                </NavLink>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <NavLink to="/announcements" onClick={() => onNavigate?.()}>
                  <Megaphone className="h-4 w-4" /> Объявления
                </NavLink>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <NavLink to="/chat" onClick={() => onNavigate?.()}>
                  <MessageSquare className="h-4 w-4" /> Чат Workspace
                  {workspaceChatUnread > 0 ? ` · ${workspaceChatUnread > 9 ? "9+" : workspaceChatUnread}` : ""}
                </NavLink>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <NavLink to="/messages" onClick={() => onNavigate?.()}>
                  <MessageCircle className="h-4 w-4" /> Сообщения
                  {privateUnreadTotal > 0 ? ` · ${privateUnreadTotal > 9 ? "9+" : privateUnreadTotal}` : ""}
                </NavLink>
              </DropdownMenuItem>
              {showUsersNav && (
                <DropdownMenuItem asChild>
                  <NavLink to="/users" onClick={() => onNavigate?.()}>
                    <Users className="h-4 w-4" /> Пользователи
                  </NavLink>
                </DropdownMenuItem>
              )}
              {permissions.canCreatePages && (
                <DropdownMenuItem onClick={() => setCreatePageOpen(true)}>
                  <Plus className="h-4 w-4" /> Новый стол
                </DropdownMenuItem>
              )}
                </>
              )}
              <DropdownMenuSeparator />
              <div
                className="px-1 py-1"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                <RoleSwitcher embedded />
              </div>
              <DropdownMenuSeparator />
              {THEME_OPTIONS.map((opt) => (
                <DropdownMenuItem key={opt.value} onClick={() => setTheme(opt.value)}>
                  <opt.icon className="h-4 w-4" />
                  {opt.label}
                  {theme === opt.value ? " ·" : ""}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onClick={() => useUiStore.getState().setShortcutsHelpOpen(true)}>
                <Keyboard className="h-4 w-4" /> Клавиши
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={async () => {
                  if (activeWorkspaceId && profile) {
                    try {
                      await setActiveRole(activeWorkspaceId, profile.uid, null);
                    } catch {
                      /* sign out regardless */
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
        </div>

        {!mobile && (
          <button
            type="button"
            onClick={toggleSidebar}
            title={pinnedCollapsed ? "Закрепить меню" : "Свернуть в рейку"}
            className="absolute -right-2.5 top-[3.6rem] flex h-6 w-6 items-center justify-center rounded-full border border-primary/40 bg-card text-primary hover:bg-primary/10 hover:text-primary"
          >
            {pinnedCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
          </button>
        )}

        <CreatePageDialog open={createPageOpen} onOpenChange={setCreatePageOpen} />
        {canCreateWorkspace && <CreateWorkspaceDialog open={createWsOpen} onOpenChange={setCreateWsOpen} />}
      </div>
    </div>
  );
}
