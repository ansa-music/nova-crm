import { useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router";
import {
  ChevronLeft,
  ChevronRight,
  Keyboard,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessageCircle,
  MessageSquare,
  MoreVertical,
  Plus,
  Search,
  Settings,
  User,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { CreatePageDialog } from "@/components/pagesnav/CreatePageDialog";
import { CreateWorkspaceDialog } from "@/components/layout/CreateWorkspaceDialog";
import { isWorkspaceAdmin } from "@/utils/adminAccess";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { usePeopleDesks } from "@/hooks/usePeopleDesks";
import { usePermissions } from "@/hooks/usePermissions";
import { signOutUser } from "@/firebase/auth";
import { setActiveRole } from "@/services/memberService";
import { cn } from "@/utils/cn";
import { personLabel, groupDeskSubtitle } from "@/utils/peopleDesks";
import { useUiStore } from "@/store/uiStore";
import { THEME_OPTIONS } from "@/components/layout/ThemeToggle";

function AppNavLink({
  to,
  end,
  icon: Icon,
  children,
  onNavigate,
}: {
  to: string;
  end?: boolean;
  icon: LucideIcon;
  children: ReactNode;
  onNavigate?: () => void;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={() => onNavigate?.()}
      className={({ isActive }) =>
        cn(
          "flex min-h-11 w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-[14px] font-medium",
          isActive
            ? "bg-[hsl(24_16%_16%)] text-foreground"
            : "text-sidebar-foreground hover:bg-sidebar-accent/80"
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{children}</span>
    </NavLink>
  );
}

export function Sidebar({ mobile, onNavigate }: { mobile?: boolean; onNavigate?: () => void }) {
  const { profile } = useAuth();
  const { members, activeWorkspaceId, workspaces, activeWorkspace, setActiveWorkspaceId } = useWorkspace();
  const permissions = usePermissions();
  const { groups, activeGroup, selectPerson } = usePeopleDesks();
  const navigate = useNavigate();
  const location = useLocation();
  const pinnedCollapsed = useUiStore((s) => s.sidebarCollapsed) && !mobile;
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const collapsed = pinnedCollapsed;
  const [createPageOpen, setCreatePageOpen] = useState(false);
  const [createWsOpen, setCreateWsOpen] = useState(false);
  const canCreateWorkspace = isWorkspaceAdmin(profile?.email);
  const [query, setQuery] = useState("");
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);

  const myMembership = members.find((m) => m.uid === profile?.uid);
  const filtered = groups.filter((g) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const name = personLabel(g.member) || "Без ответственного";
    const desk = groupDeskSubtitle(g);
    return name.toLowerCase().includes(q) || desk.toLowerCase().includes(q);
  });

  function pickPerson(key: string) {
    selectPerson(key);
    if (location.pathname !== "/") navigate("/");
    onNavigate?.();
  }

  function goHome() {
    if (location.pathname !== "/") navigate("/");
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
          "relative flex h-full min-h-0 flex-col bg-background text-sidebar-foreground",
          mobile ? "w-full px-3 py-4" : cn("border-r border-border px-3 py-4", collapsed ? "w-[72px] items-center px-2" : "w-[248px]")
        )}
      >
        <div className={cn("mb-5 flex items-center", collapsed ? "justify-center" : "justify-between gap-2 pr-1")}>
          {collapsed ? (
            <button type="button" onClick={goHome} className="wordmark text-lg" title="Главная">
              N
            </button>
          ) : (
            <button type="button" onClick={goHome} className="flex min-w-0 items-center gap-2" title="Главная">
              <span className="wordmark text-[22px] leading-none">NOVA</span>
              <span className="desk-accent-mark h-4 w-0.5 shrink-0 rounded-full" aria-hidden />
            </button>
          )}
          {!collapsed && <NotificationBell />}
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-thin">
          {mobile && (
            <nav className="mb-4 flex shrink-0 flex-col gap-0.5" aria-label="Разделы">
              <AppNavLink to="/" end icon={LayoutDashboard} onNavigate={onNavigate}>
                Главная
              </AppNavLink>
              <AppNavLink to="/settings" icon={Settings} onNavigate={onNavigate}>
                Настройки
              </AppNavLink>
              <AppNavLink to="/messages" icon={MessageCircle} onNavigate={onNavigate}>
                Сообщения
              </AppNavLink>
              <AppNavLink to="/chat" icon={MessageSquare} onNavigate={onNavigate}>
                Чат
              </AppNavLink>
              {permissions.canManageWorkspace && (
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
          {!collapsed && (
          <>
            <p className="mb-2 px-1 text-[13px] font-medium text-foreground">Люди</p>
            <label className="mb-3 flex h-9 items-center gap-2 rounded-full border border-border bg-card/80 px-3 text-[13px] text-muted-foreground">
              <Search className="h-3.5 w-3.5 shrink-0" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Поиск"
                className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
              />
            </label>
          </>
        )}

        <nav className="flex flex-col gap-0.5">
          {filtered.map((group) => {
            const name = personLabel(group.member) || (group.uid ? "Стол" : "Без ответственного");
            const desk = groupDeskSubtitle(group);
            const selected = activeGroup?.key === group.key;
            return (
              <button
                key={group.key}
                type="button"
                onClick={() => pickPerson(group.key)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors",
                  mobile && "min-h-11",
                  selected ? "bg-[hsl(24_16%_16%)] text-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent/80",
                  collapsed && "justify-center px-0"
                )}
              >
                {group.member ? (
                  <MemberAvatar
                    id={group.member.uid}
                    name={group.member.name}
                    nickname={group.member.nickname}
                    photoURL={group.member.photoURL}
                    className="h-8 w-8 shrink-0"
                  />
                ) : (
                  <Avatar className="h-8 w-8">
                    <AvatarFallback>{desk.slice(0, 1)}</AvatarFallback>
                  </Avatar>
                )}
                {!collapsed && (
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-foreground">{name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{desk}</span>
                  </span>
                )}
              </button>
            );
          })}
          {filtered.length === 0 && !collapsed && (
            <p className="px-2 py-3 text-xs text-muted-foreground">Никого не нашлось</p>
          )}
        </nav>
        </div>

        <div className={cn("mt-3 flex items-center border-t border-border pt-3", collapsed ? "justify-center" : "gap-1")}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl px-1.5 py-1 text-left hover:bg-sidebar-accent/80",
                  collapsed && "flex-none justify-center px-0"
                )}
              >
                {profile ? (
                  <MemberAvatar
                    id={profile.uid}
                    name={profile.name}
                    nickname={profile.nickname}
                    photoURL={profile.photoURL}
                    className="h-8 w-8"
                  />
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
            <DropdownMenuContent align="start" className="w-56">
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
                  <User className="h-4 w-4" /> Профиль
                </NavLink>
              </DropdownMenuItem>
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
                </NavLink>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <NavLink to="/messages" onClick={() => onNavigate?.()}>
                  <MessageCircle className="h-4 w-4" /> Сообщения
                </NavLink>
              </DropdownMenuItem>
              {permissions.canManageWorkspace && (
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
              {mobile ? (
                THEME_OPTIONS.map((opt) => (
                  <DropdownMenuItem key={opt.value} onClick={() => setTheme(opt.value)}>
                    <opt.icon className="h-4 w-4" />
                    {opt.label}
                    {theme === opt.value ? " ·" : ""}
                  </DropdownMenuItem>
                ))
              ) : (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Тема</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {THEME_OPTIONS.map((opt) => (
                      <DropdownMenuItem key={opt.value} onClick={() => setTheme(opt.value)}>
                        <opt.icon className="h-4 w-4" />
                        {opt.label}
                        {theme === opt.value ? " ·" : ""}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
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
            className="absolute -right-2.5 top-[3.6rem] flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
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
