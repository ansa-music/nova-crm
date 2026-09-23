import { useState, useSyncExternalStore, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  HardHat,
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
  PackageCheck,
  Plus,
  Settings,
  Table2,
  ScanEye,
  ListChecks,
  RefreshCw,
  User,
  Users,
  UsersRound,
  Contact,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { memberHasRole, rolesLabel, type Role } from "@/types";
import { confirmDialog } from "@/utils/appDialog";
import { toast } from "@/components/ui/sonner";
import { requestReloadEverywhere } from "@/services/workspaceService";
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
import { DISPATCH_ENABLED } from "@/config/features";
import { hasFullAccess } from "@/utils/permissions";
import { osDispatchLogState, subscribeOsDispatchLogState } from "@/services/osDispatchLogService";
import { signOutUser } from "@/firebase/auth";
import { setActiveRole } from "@/services/memberService";
import { cn } from "@/utils/cn";
import { useUiStore } from "@/store/uiStore";
import { openOrdersState, subscribeOpenOrdersState } from "@/services/openOrdersPulse";
import { THEME_OPTIONS } from "@/components/layout/ThemeToggle";
import { usePeopleDesks } from "@/hooks/usePeopleDesks";
import { useInboxSummary } from "@/hooks/useInboxSummary";


/**
 * Active nav is the spec's "holographic pill": a cyan-to-purple gradient
 * capsule rather than a tinted row. `nav-link-active` carries the gradient
 * (see index.css) so this and the desk list in PageNavItem stay one visual
 * language. Inactive rows slide 3px toward the content on pointer hover.
 */
/**
 * `alert` — «здесь вас ждёт заказ»: пункт горит зелёным (`--success`), пока
 * это правда. Зелёный взят намеренно не акцентный: акцентом подсвечен
 * АКТИВНЫЙ пункт, и «где я сейчас» не должно спорить с «куда надо зайти».
 */
function navActiveClass(active: boolean, collapsed?: boolean, alert?: boolean) {
  if (collapsed) {
    return cn(
      "flex h-11 w-11 items-center justify-center rounded-full transition-all duration-200",
      active
        ? "nav-link-active"
        : alert
          ? "bg-success/15 text-success hover:bg-success/25"
          : "text-sidebar-foreground hover:bg-sidebar-accent/80 hover:text-primary"
    );
  }
  return cn(
    "flex min-h-11 w-full items-center gap-2.5 rounded-full px-3 text-left text-[14px] font-medium transition-all duration-200",
    active
      ? "nav-link-active"
      : alert
        ? "bg-success/15 text-success hover:bg-success/25 motion-safe:hover:translate-x-[3px]"
        : "text-sidebar-foreground hover:bg-sidebar-accent/80 hover:text-primary motion-safe:hover:translate-x-[3px]"
  );
}

/** Account card caption under the name; roles without one show the email. */
const ROLE_CAPTIONS: Partial<Record<Role, string>> = {
  owner: "Владелец",
  teamlead: "Тимлид",
  manager: "Технарь",
  os: "ОС",
};

function pathMatches(pathname: string, to: string, end?: boolean) {
  if (end || to === "/") return pathname === to;
  return pathname === to || pathname.startsWith(`${to}/`);
}

function AppNavLink({
  to,
  end,
  icon: Icon,
  children,
  onNavigate,
  forceActive,
  badge,
  collapsed,
  title,
  alert,
}: {
  to: string;
  end?: boolean;
  icon: LucideIcon;
  children: ReactNode;
  onNavigate?: () => void;
  forceActive?: boolean;
  badge?: number;
  collapsed?: boolean;
  title?: string;
  /** Зелёная подсветка «сюда приехал заказ». */
  alert?: boolean;
}) {
  const { pathname } = useLocation();
  const active = forceActive ?? pathMatches(pathname, to, end);
  return (
    <NavLink
      to={to}
      end={end}
      title={title}
      data-nav-active={active ? "true" : undefined}
      onClick={() => onNavigate?.()}
      className={navActiveClass(active, collapsed, alert)}
    >
      {collapsed ? (
        <span className="relative">
          <Icon className="h-4 w-4" />
          {badge ? <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-primary" /> : null}
          {/* Не только цвет: в свёрнутом меню видна одна иконка, и точка
              отличает «зелёный пункт» от просто наведения. */}
          {alert && !badge ? (
            <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-success motion-safe:animate-pulse" />
          ) : null}
        </span>
      ) : (
        <>
          <Icon className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{children}</span>
          {alert && !badge ? (
            <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-success motion-safe:animate-pulse" />
          ) : null}
          {badge ? (
            <span className="ml-auto shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground">
              {badge > 9 ? "9+" : badge}
            </span>
          ) : null}
        </>
      )}
    </NavLink>
  );
}

/** Пункт меню. `show: false` — пункта у этой роли нет. */
interface NavItem {
  key: string;
  to: string;
  label: string;
  icon: LucideIcon;
  show?: boolean;
  badge?: number;
  alert?: boolean;
  forceActive?: boolean;
  end?: boolean;
  onNavigate?: () => void;
}

/**
 * Секция меню. Раньше пункты шли одним столбиком из 17 строк, и разбираться в
 * них было трудно (жалоба Nurba 23.09.2026). Теперь они собраны по смыслу:
 * работа → столы → люди → связь → остальное. «Ещё» свёрнута по умолчанию —
 * там то, что открывают раз в неделю.
 */
interface NavSection {
  key: string;
  title?: string;
  items: NavItem[];
  /** Можно свернуть; состояние помнится в localStorage. */
  collapsible?: boolean;
  defaultOpen?: boolean;
}

const NAV_SECTIONS_KEY = "nova:nav-sections";

function readSectionState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(NAV_SECTIONS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function NavSections({
  sections,
  collapsed,
  pathname,
}: {
  sections: NavSection[];
  collapsed: boolean;
  pathname: string;
}) {
  const [openState, setOpenState] = useState<Record<string, boolean>>(readSectionState);
  function toggle(key: string, fallback: boolean) {
    setOpenState((prev) => {
      const next = { ...prev, [key]: !(prev[key] ?? fallback) };
      try {
        localStorage.setItem(NAV_SECTIONS_KEY, JSON.stringify(next));
      } catch {
        /* приватное окно — просто не запомним */
      }
      return next;
    });
  }

  return (
    <nav className={cn("relative mb-4 flex shrink-0 flex-col", collapsed ? "gap-1" : "gap-2")} aria-label="Разделы">
      {sections.map((section, index) => {
        const hasActive = section.items.some((i) => i.forceActive ?? pathMatches(pathname, i.to, i.end));
        // Секцию с активным пунктом не прячем: человек должен видеть, где он.
        const open = !section.collapsible || hasActive || (openState[section.key] ?? section.defaultOpen ?? true);
        if (collapsed) {
          // В рейке заголовков нет — секции разделяет тонкая черта.
          return (
            <div key={section.key} className="flex flex-col items-center gap-0.5">
              {index > 0 && <span className="my-1 h-px w-6 rounded-full bg-primary/20" aria-hidden />}
              {section.items.map((item) => (
                <AppNavLink
                  key={item.key}
                  collapsed
                  title={item.label}
                  to={item.to}
                  end={item.end}
                  icon={item.icon}
                  forceActive={item.forceActive}
                  alert={item.alert}
                  badge={item.badge}
                  onNavigate={item.onNavigate}
                >
                  {item.label}
                </AppNavLink>
              ))}
            </div>
          );
        }
        return (
          <div key={section.key} className="flex flex-col gap-0.5">
            {section.title &&
              (section.collapsible ? (
                <button
                  type="button"
                  onClick={() => toggle(section.key, section.defaultOpen ?? true)}
                  className="eyebrow flex min-h-8 items-center justify-between px-3 text-muted-foreground/80 hover:text-foreground"
                  aria-expanded={open}
                >
                  {section.title}
                  <ChevronDown className={cn("h-3 w-3 transition-transform", !open && "-rotate-90")} />
                </button>
              ) : (
                <div className="eyebrow flex min-h-8 items-center px-3 text-muted-foreground/80">{section.title}</div>
              ))}
            {open &&
              section.items.map((item) => (
                <AppNavLink
                  key={item.key}
                  to={item.to}
                  end={item.end}
                  icon={item.icon}
                  forceActive={item.forceActive}
                  alert={item.alert}
                  badge={item.badge}
                  onNavigate={item.onNavigate}
                >
                  {item.label}
                </AppNavLink>
              ))}
          </div>
        );
      })}
    </nav>
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
  // Real role gates visibility outright — an Owner simulating Технарь via
  // RoleSwitcher must lose this link, so effectiveRole (permissions.role)
  // is checked too, same rule DispatchPage itself enforces server-side-ish.
  const showDispatchNav =
    DISPATCH_ENABLED &&
    permissions.isResolved &&
    (permissions.hasFullDeskAccess || permissions.realRole === "admin") &&
    (hasFullAccess(permissions.role) || permissions.role === "admin");
  // ОС has no desk: «Технари» is their home. A Тимлид manages people, not
  // desk tables: «Пользователи» is theirs. For both, the desk-centric
  // sections (Дашборд, Столы) are hidden — there is nothing for them there.
  // With add-on roles rights add up: only a pure ОС loses Грок and desks,
  // only a Тимлид who isn't also a Технарь loses desks.
  const isOs = permissions.isResolved && permissions.roles.every((role) => role === "os");
  const isTeamlead = permissions.isResolved && permissions.deskBlocked;
  // Наблюдателю (тихое право Owner) «Столы» нужны — иначе чужой стол открыть
  // неоткуда; `seesAllDesks` здесь и означает это право.
  const showDeskNav = (!isOs && !isTeamlead) || permissions.seesAllDesks;
  const showGrokNav = !isOs;
  const showTechniciansNav = permissions.canSeeTechnicians && !isOs;
  // «Стол ОС» — личная таблица ОС, пункт только у ОС (и как второй роли).
  // «Столы ОС» — все столы ОС на просмотр: у ВСЕХ, и у самих ОС тоже (чужие
  // столы видны каждому участнику).
  const showOsDeskNav = permissions.isResolved && permissions.hasRole("os");
  const showOsDesksNav = permissions.isResolved;
  // «Выдачи ОС» — мониторинг выборочных выдач: от Тимлида и выше.
  const showOsDispatchNav = permissions.isResolved && hasFullAccess(permissions.role);
  const osDispatchLog = useSyncExternalStore(subscribeOsDispatchLogState, osDispatchLogState);
  const osDispatchUnseen = showOsDispatchNav ? osDispatchLog.unseen : 0;
  /**
   * Зелёные пункты меню:
   * — «Заказы», пока на бирже есть хоть один ОТКРЫТЫЙ заказ (живое состояние,
   *   забрали последний — гаснет само);
   * — «Мой стол», когда на стол приехал заказ и его ещё не открывали
   *   (метка снимается при открытии стола, переживает перезагрузку).
   */
  const openOrders = useSyncExternalStore(subscribeOpenOrdersState, openOrdersState);
  const ordersAlert = openOrders.loaded && openOrders.count > 0;
  const deskAlerts = useUiStore((s) => s.deskAlerts);
  const deskAlert = Boolean(myDesk && deskAlerts.includes(myDesk.id));
  const homeTo = isOs ? "/technicians" : isTeamlead ? "/users" : myDesk ? `/page/${myDesk.id}` : "/";
  const homeLabel = isOs
    ? "Технари"
    : isTeamlead
      ? "Пользователи"
      : myDesk && memberHasRole(myMembership, "manager")
        ? "Мой стол"
        : "Главная";
  const HomeIcon = isOs ? HardHat : isTeamlead ? Users : Home;
  const homeActive =
    location.pathname === "/" ||
    location.pathname === homeTo ||
    Boolean(myDesk && location.pathname === `/page/${myDesk.id}`);
  function goHome() {
    navigate(homeTo);
    onNavigate?.();
  }

  const rawSections: NavSection[] = [
    {
      key: "main",
      items: [
        { key: "home", to: homeTo, label: homeLabel, icon: HomeIcon, forceActive: homeActive, alert: deskAlert, onNavigate: goHome },
        { key: "orders", to: "/orders", label: "Заказы", icon: ClipboardList, alert: ordersAlert, onNavigate },
        { key: "dashboard", to: "/dashboard", label: "Дашборд", icon: LayoutDashboard, onNavigate },
      ],
    },
    {
      key: "desks",
      title: "Столы",
      items: [
        { key: "desks", to: "/desks", label: "Столы", icon: LayoutGrid, show: showDeskNav, onNavigate },
        { key: "os-desk", to: "/os-desk", label: "Стол ОС", icon: Table2, show: showOsDeskNav, onNavigate },
        { key: "os-desks", to: "/os-desks", label: "Столы ОС", icon: ScanEye, show: showOsDesksNav, onNavigate },
        { key: "os-dispatch", to: "/os-dispatch", label: "Выдачи ОС", icon: ListChecks, show: showOsDispatchNav, badge: osDispatchUnseen, onNavigate },
        { key: "technicians", to: "/technicians", label: "Технари", icon: HardHat, show: showTechniciansNav, onNavigate },
      ],
    },
    {
      key: "people",
      title: "Люди",
      items: [
        { key: "people", to: "/people", label: "Люди", icon: UsersRound, onNavigate },
        { key: "team", to: "/team", label: "Команда", icon: Contact, show: showUsersNav, onNavigate },
        { key: "users", to: "/users", label: "Пользователи", icon: Users, show: showUsersNav && !isTeamlead, onNavigate },
        { key: "schedule", to: "/schedule", label: "График", icon: CalendarDays, onNavigate },
      ],
    },
    {
      key: "talk",
      title: "Связь",
      items: [
        { key: "messages", to: "/messages", label: "Сообщения", icon: MessageCircle, badge: privateUnreadTotal, onNavigate },
        { key: "chat", to: "/chat", label: "Чат", icon: MessageSquare, badge: workspaceChatUnread, onNavigate },
        { key: "announcements", to: "/announcements", label: "Объявления", icon: Megaphone, onNavigate },
      ],
    },
    {
      key: "more",
      title: "Ещё",
      collapsible: true,
      defaultOpen: false,
      items: [
        { key: "grok", to: "/grok-limit", label: "Грок лимит", icon: KeyRound, show: showGrokNav, onNavigate },
        { key: "dispatch", to: "/dispatch", label: "Выдача", icon: PackageCheck, show: showDispatchNav, onNavigate },
        { key: "settings", to: "/settings", label: "Настройки", icon: Settings, onNavigate },
      ],
    },
  ];
  const sections = rawSections
    .map((section) => ({ ...section, items: section.items.filter((item) => item.show !== false) }))
    .filter((section) => section.items.length > 0);

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
          "relative flex h-full min-h-0 flex-col text-sidebar-foreground",
          // Floating glass pane, per the Neon Holographic spec: the nav reads
          // as an object suspended over the ground rather than a screen
          // partition, so it gets its own rounded surface + blur instead of a
          // full-height divider rule. AppLayout already insets the shell (p-3).
          mobile
            ? "w-full bg-background/95 px-3 py-4"
            : cn(
                "mr-3 rounded-[28px] border border-primary/25 bg-card/60 px-3 py-4 backdrop-blur-xl",
                "shadow-[0_0_40px_-12px_hsl(0_0%_0%/0.8)]",
                collapsed ? "w-[72px] items-center px-2" : "w-[248px]"
              )
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
          <NavSections sections={sections} collapsed={collapsed} pathname={location.pathname} />
          {mobile && permissions.canCreatePages && (
            <button
              type="button"
              onClick={() => setCreatePageOpen(true)}
              className="flex min-h-11 w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-[14px] font-medium text-sidebar-foreground hover:bg-sidebar-accent/80"
            >
              <Plus className="h-4 w-4 shrink-0" />
              Новый стол
            </button>
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
                      {(myMembership &&
                        ((myMembership.extraRoles?.length ? rolesLabel(myMembership) : null) ||
                          ROLE_CAPTIONS[myMembership.role])) ||
                        profile?.email}
                    </span>
                  </span>
                )}
                {!collapsed && <MoreVertical className="h-4 w-4 shrink-0 text-muted-foreground" />}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="z-[330] w-56">
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
              {/* Только Owner: перезагрузить сайт во всех открытых вкладках команды. */}
              {permissions.isWorkspaceOwner && activeWorkspaceId && (
                <DropdownMenuItem
                  onClick={async () => {
                    const ok = await confirmDialog({
                      title: "Обновить сайт у всех?",
                      description:
                        "Во всех открытых вкладках команды страница перезагрузится (через 30 секунд, у свёрнутых — сразу; кто печатает — после ввода). Несохранённое в открытых окнах пропадёт.",
                      confirmLabel: "Обновить у всех",
                    });
                    if (!ok) return;
                    try {
                      await requestReloadEverywhere(activeWorkspaceId);
                      toast.success("Сайт обновится у всех", { description: "И у вас — через 30 секунд." });
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : "Не удалось отправить обновление");
                    }
                  }}
                >
                  <RefreshCw className="h-4 w-4" /> Обновить сайт у всех
                </DropdownMenuItem>
              )}
              {!mobile && permissions.canCreatePages && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setCreatePageOpen(true)}>
                    <Plus className="h-4 w-4" /> Новый стол
                  </DropdownMenuItem>
                </>
              )}
              {/* «Режим доступа» есть только у Owner — у остальных RoleSwitcher
                  рисует null, и без этого гейта в меню оставались две
                  разделительные линии подряд с пустотой между ними. */}
              {permissions.allowedSimulatedRoles.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <div
                    className="px-1 py-1"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <RoleSwitcher embedded />
                  </div>
                </>
              )}
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
