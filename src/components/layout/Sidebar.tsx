import { useEffect, useRef, useState, useSyncExternalStore, type FocusEvent, type PointerEvent } from "react";
import { NavLink, useLocation, useNavigate } from "react-router";
import {
  CalendarDays,
  ChevronDown,
  ClipboardList,
  HardHat,
  Keyboard,
  KeyRound,
  Home,
  LayoutDashboard,
  Trophy,
  LayoutGrid,
  LogOut,
  Megaphone,
  MessageCircle,
  MessageSquare,
  MoreVertical,
  PackageCheck,
  PanelLeftClose,
  PanelLeftOpen,
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
import { useCanHover } from "@/hooks/useMediaQuery";

/** Сколько ждать мышь на рейке, прежде чем раскрыть панель поверх стола. */
const PEEK_OPEN_MS = 220;
/** Сколько держать панель после ухода мыши — чтобы не моргала на проходе. */
const PEEK_CLOSE_MS = 180;

/**
 * Активный пункт — плоская заливка `nav-link-active` (index.css): один
 * бирюзовый акцент, без градиента и свечения. Наведение — только лёгкая
 * заливка, без сдвига и без смены цвета текста в акцент: акцентом отмечено
 * «где я сейчас», и наведение не должно с ним спорить.
 *
 * `alert` — «здесь вас ждёт заказ»: пункт горит зелёным (`--success`), пока
 * это правда. Зелёный взят намеренно не акцентный: акцентом подсвечен
 * АКТИВНЫЙ пункт, и «где я сейчас» не должно спорить с «куда надо зайти».
 */
function navActiveClass(active: boolean, collapsed?: boolean, alert?: boolean) {
  if (collapsed) {
    return cn(
      "flex h-10 w-10 items-center justify-center rounded-lg transition-colors duration-200",
      active
        ? "nav-link-active"
        : alert
          ? "bg-success/15 text-success hover:bg-success/25"
          : "text-sidebar-foreground hover:bg-foreground/5"
    );
  }
  // На телефоне (drawer) цель остаётся 44px; 40px — только у мыши (lg — там,
  // где широкое меню вообще бывает в потоке).
  return cn(
    "flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-left text-[14px] font-medium transition-colors duration-200 lg:min-h-10",
    active
      ? "nav-link-active"
      : alert
        ? "bg-success/15 text-success hover:bg-success/25"
        : "text-sidebar-foreground hover:bg-foreground/5"
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
  label,
  onNavigate,
  forceActive,
  badge,
  collapsed,
  alert,
}: {
  to: string;
  end?: boolean;
  icon: LucideIcon;
  label: string;
  onNavigate?: () => void;
  forceActive?: boolean;
  badge?: number;
  collapsed?: boolean;
  /** Зелёная подсветка «сюда приехал заказ». */
  alert?: boolean;
}) {
  const { pathname } = useLocation();
  const active = forceActive ?? pathMatches(pathname, to, end);
  return (
    <NavLink
      to={to}
      end={end}
      // В рейке подписи нет, но `title` не ставим: при наведении панель и так
      // раскрывается с подписями, а всплывашка браузера легла бы поверх неё.
      aria-label={collapsed ? label : undefined}
      data-nav-active={active ? "true" : undefined}
      onClick={() => onNavigate?.()}
      className={navActiveClass(active, collapsed, alert)}
    >
      {collapsed ? (
        <span className="relative">
          <Icon className="h-[18px] w-[18px]" />
          {badge ? <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-primary" /> : null}
          {/* Не только цвет: в свёрнутом меню видна одна иконка, и точка
              отличает «зелёный пункт» от просто наведения. */}
          {alert && !badge ? (
            <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-success motion-safe:animate-pulse" />
          ) : null}
        </span>
      ) : (
        <>
          <Icon className="h-[18px] w-[18px] shrink-0" />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {alert && !badge ? (
            <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-success motion-safe:animate-pulse" />
          ) : null}
          {badge ? (
            <span className="ml-auto shrink-0 rounded-full bg-primary px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none text-primary-foreground">
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
              {index > 0 && <span className="my-1 h-px w-6 bg-border" aria-hidden />}
              {section.items.map((item) => (
                <AppNavLink
                  key={item.key}
                  collapsed
                  to={item.to}
                  end={item.end}
                  icon={item.icon}
                  label={item.label}
                  forceActive={item.forceActive}
                  alert={item.alert}
                  badge={item.badge}
                  onNavigate={item.onNavigate}
                />
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
                  label={item.label}
                  forceActive={item.forceActive}
                  alert={item.alert}
                  badge={item.badge}
                  onNavigate={item.onNavigate}
                />
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
  const sidebarPinned = useUiStore((s) => s.sidebarPinned);
  const setSidebarPinned = useUiStore((s) => s.setSidebarPinned);
  const canHover = useCanHover();
  /**
   * Три состояния десктопного меню: закреплено (248px в потоке), рейка (64px)
   * и «подглядывание» — панель 248px ПОВЕРХ стола, пока над ней мышь или пока
   * открыта одна из выпадашек (аккаунт, колокольчик: их содержимое живёт в
   * портале, и pointerleave по панели срабатывает, хотя человек ещё в меню).
   * Мобильный drawer (`mobile`) никогда не свёрнут — у него своя ширина.
   * Пока человек не нажимал «Закрепить/Свернуть» (`null`), умолчание зависит
   * от устройства: без наведения (iPad ≥1024 без мыши) рейка нераскрываема —
   * ни peek, ни `title` у пунктов — поэтому там меню закреплено сразу.
   */
  const pinned = mobile ? false : (sidebarPinned ?? !canHover);
  const [peek, setPeek] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const holdOpen = menuOpen || bellOpen;
  const collapsed = !mobile && !pinned && !peek && !holdOpen;
  /** Панель раскрыта поверх стола (не закреплена и не рейка). */
  const peeking = !mobile && !pinned && !collapsed;
  const panelRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  /** Чем последний раз трогали панель — после закрытия выпадашки оставляем
      её раскрытой только под мышью, чтобы на тач-планшете она не залипала. */
  const lastPointer = useRef<string>("");

  function clearPeekTimers() {
    if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }
  useEffect(() => clearPeekTimers, []);

  // Раскрытие — ТОЛЬКО для мыши: на таче pointerenter приходит от касания, и
  // панель раскрывалась бы на каждый тап по рейке, перекрывая стол.
  function onPanelPointerEnter(e: PointerEvent<HTMLDivElement>) {
    lastPointer.current = e.pointerType;
    if (mobile || e.pointerType !== "mouse") return;
    clearPeekTimers();
    openTimer.current = window.setTimeout(() => setPeek(true), PEEK_OPEN_MS);
  }
  function onPanelPointerLeave(e: PointerEvent<HTMLDivElement>) {
    if (mobile || e.pointerType !== "mouse") return;
    clearPeekTimers();
    closeTimer.current = window.setTimeout(() => setPeek(false), PEEK_CLOSE_MS);
  }
  // Клавиатура: Tab в рейку раскрывает подписи, уход фокуса из панели —
  // сворачивает. `:focus-visible` отличает клавиатуру от клика/тапа по пункту:
  // тап по иконке рейки на планшете тоже ставит фокус, но раскрывать не должен.
  function onPanelFocus(e: FocusEvent<HTMLDivElement>) {
    if (mobile || !(e.target instanceof HTMLElement) || !e.target.matches(":focus-visible")) return;
    clearPeekTimers();
    setPeek(true);
  }
  function onPanelBlur(e: FocusEvent<HTMLDivElement>) {
    if (mobile) return;
    const next = e.relatedTarget;
    if (next instanceof Node && panelRef.current?.contains(next)) return;
    // Фокус ушёл, но мышь всё ещё на панели (кликнули по пустому месту) —
    // сворачивать под курсором нельзя, pointerleave закроет сам.
    if (panelRef.current?.matches(":hover") && lastPointer.current === "mouse") return;
    setPeek(false);
  }
  /**
   * Выпадашка закрылась: пункт выбрали над порталом (мышь уже вне панели —
   * сворачиваемся) или нажали Esc, не уводя мышь (панель под курсором —
   * остаёмся). `:hover` это и говорит; на таче hover «залипает» после тапа,
   * поэтому верим ему только после мыши.
   */
  function onHoldChange(setter: (open: boolean) => void) {
    return (open: boolean) => {
      setter(open);
      if (open || mobile) return;
      clearPeekTimers();
      setPeek(Boolean(panelRef.current?.matches(":hover")) && lastPointer.current === "mouse");
    };
  }
  function togglePinned() {
    // Из закреплённого — в рейку сразу, не дожидаясь ухода мыши: человек
    // нажал «Свернуть» и должен увидеть, что свернулось.
    if (pinned) {
      clearPeekTimers();
      setPeek(false);
    }
    // Пишем противоположное ЭФФЕКТИВНОМУ значению, а не сохранённому: при
    // `null` в магазине «наоборот» посчитать некому, кроме нас.
    setSidebarPinned(!pinned);
  }

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
        { key: "abs", to: "/abs", label: "ABS система", icon: Trophy, onNavigate },
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

  const PinIcon = pinned ? PanelLeftClose : PanelLeftOpen;
  const pinLabel = pinned ? "Свернуть в рейку" : "Закрепить меню";

  return (
    <div
      className={cn(
        // z-[45], а не z-40: фейды прокрутки стола (DataTable, absolute z-40)
        // стоят в DOM позже и при равном z ложились поверх раскрытой панели —
        // видно при reduced-motion/таче, где PageShell без GSAP-transform не
        // создаёт свой stacking context. RowCardSheet z-50 и полосы z-[60]
        // остаются выше. `isolate` на main не ставим — это меняло бы наложение
        // всего контента разом ради одного фейда.
        "relative z-[45] shrink-0",
        mobile
          ? "h-full min-h-0 w-full bg-background"
          : // Обёртка держит место в потоке: рейка 64px или закреплённые 248px.
            // Подглядывание её не трогает — стол под панелью не прыгает.
            cn("h-full transition-[width] duration-280 ease-out", pinned ? "w-[248px]" : "w-16")
      )}
    >
      <div
        ref={panelRef}
        onPointerEnter={mobile ? undefined : onPanelPointerEnter}
        onPointerLeave={mobile ? undefined : onPanelPointerLeave}
        onFocusCapture={mobile ? undefined : onPanelFocus}
        onBlurCapture={mobile ? undefined : onPanelBlur}
        className={cn(
          "flex h-full min-h-0 flex-col text-sidebar-foreground",
          // Плоская панель: свой фон и одна линия справа, как перегородка
          // экрана. Без скруглений, стекла и тени — стол начинается встык.
          mobile
            ? "w-full bg-background/95 px-3 py-4"
            : cn(
                "overflow-hidden border-r border-sidebar-border bg-sidebar px-3 py-3 transition-[width] duration-200 ease-out",
                peeking ? "absolute inset-y-0 left-0 z-50 w-[248px]" : "w-full",
                collapsed && "items-center"
              )
        )}
      >
        {collapsed ? (
          <div className="mb-3 flex flex-col items-center gap-1">
            <button
              type="button"
              onClick={goHome}
              aria-label="Главная"
              className="flex h-10 w-10 items-center justify-center rounded-lg font-serif text-[18px] font-medium leading-none text-foreground hover:bg-foreground/5"
            >
              N
            </button>
            <NotificationBell className="h-10 w-10 rounded-lg" onOpenChange={onHoldChange(setBellOpen)} />
          </div>
        ) : (
          <div className="mb-4 flex items-center justify-between gap-2 px-1">
            <button type="button" onClick={goHome} className="flex min-w-0 items-center" title="Главная">
              <span className="font-serif text-[22px] font-medium leading-none text-foreground">NOVA</span>
            </button>
            {!mobile && <NotificationBell className="rounded-lg" onOpenChange={onHoldChange(setBellOpen)} />}
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-thin">
          <NavSections sections={sections} collapsed={collapsed} pathname={location.pathname} />
          {mobile && permissions.canCreatePages && (
            <button
              type="button"
              onClick={() => setCreatePageOpen(true)}
              className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-left text-[14px] font-medium text-sidebar-foreground hover:bg-foreground/5"
            >
              <Plus className="h-[18px] w-[18px] shrink-0" />
              Новый стол
            </button>
          )}
        </div>

        <div className={cn("mt-3 flex flex-col gap-1 border-t border-sidebar-border pt-3", collapsed && "items-center")}>
          {/* Закрепление живёт пунктом внизу, а не кнопкой на ребре панели:
              в рейке ребро перекрыто столом, и круглый шеврон там терялся. */}
          {!mobile && (
            <button
              type="button"
              onClick={togglePinned}
              aria-label={pinLabel}
              title={collapsed ? pinLabel : undefined}
              aria-pressed={pinned}
              className={cn(
                "flex items-center rounded-lg text-sidebar-foreground transition-colors duration-200 hover:bg-foreground/5",
                collapsed ? "h-10 w-10 justify-center" : "min-h-10 w-full gap-2.5 px-3 text-left text-[13px] font-medium"
              )}
            >
              <PinIcon className="h-[18px] w-[18px] shrink-0" />
              {!collapsed && <span className="min-w-0 flex-1 truncate">{pinLabel}</span>}
            </button>
          )}
          <DropdownMenu modal={false} onOpenChange={onHoldChange(setMenuOpen)}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={collapsed ? "Аккаунт" : undefined}
                className={cn(
                  "relative flex min-h-11 min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-foreground/5 lg:min-h-10",
                  collapsed && "h-10 w-10 justify-center px-0 py-0"
                )}
              >
                {profile ? (
                  <span className="relative shrink-0">
                    <MemberAvatar
                      id={profile.uid}
                      name={profile.name}
                      nickname={profile.nickname}
                      photoURL={profile.photoURL}
                      className="h-[34px] w-[34px]"
                    />
                    {privateUnreadTotal + workspaceChatUnread > 0 && (
                      <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary" />
                    )}
                  </span>
                ) : (
                  <Avatar className="h-[34px] w-[34px]">
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

        <CreatePageDialog open={createPageOpen} onOpenChange={setCreatePageOpen} />
        {canCreateWorkspace && <CreateWorkspaceDialog open={createWsOpen} onOpenChange={setCreateWsOpen} />}
      </div>
    </div>
  );
}
