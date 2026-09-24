import { memo, useEffect, useRef, useState, type FocusEvent, type PointerEvent } from "react";
import { NavLink, useLocation, useNavigate } from "react-router";
import {
  ChevronDown,
  MoreVertical,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  User,
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
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { cn } from "@/utils/cn";
import { useUiStore } from "@/store/uiStore";
import { useCanHover } from "@/hooks/useMediaQuery";
import { useAccountMenu, useNavModel } from "@/hooks/useNavModel";
import { NAV_SECTIONS_KEY, isNavItemActive, pathMatches, type NavChild, type NavSection } from "@/config/nav";
import { preloadRoute } from "@/config/pageLoaders";

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

function AppNavLink({
  to,
  end,
  icon: Icon,
  label,
  onNavigate,
  activeOn,
  badge,
  collapsed,
  alert,
}: {
  to: string;
  end?: boolean;
  icon: LucideIcon;
  label: string;
  onNavigate?: () => void;
  activeOn?: (pathname: string) => boolean;
  badge?: number;
  collapsed?: boolean;
  /** Зелёная подсветка «сюда приехал заказ». */
  alert?: boolean;
}) {
  const { pathname } = useLocation();
  const active = isNavItemActive({ to, end, activeOn }, pathname);
  const preload = () => preloadRoute(to);
  return (
    <NavLink
      to={to}
      end={end}
      // Chunk страницы начинает качаться, пока мышь ещё над пунктом (или
      // фокус пришёл с клавиатуры) — к клику он обычно уже в кэше.
      onPointerEnter={preload}
      onFocus={preload}
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

function readSectionState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(NAV_SECTIONS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

/** Подпункт-стол под «Столами»: иконка в цвете обложки + имя, с отступом под текст родителя. */
function DeskSubLink({ child, pathname, onNavigate }: { child: NavChild; pathname: string; onNavigate?: () => void }) {
  const Icon = child.icon;
  const active = pathMatches(pathname, child.to);
  const preload = () => preloadRoute(child.to);
  return (
    <NavLink
      to={child.to}
      onClick={() => onNavigate?.()}
      onPointerEnter={preload}
      onFocus={preload}
      data-nav-active={active ? "true" : undefined}
      className={cn(
        "flex min-h-10 w-full items-center gap-2.5 rounded-lg py-1 pl-[38px] pr-3 text-left text-[13px] transition-colors duration-200 lg:min-h-8",
        active ? "nav-link-active" : "text-sidebar-foreground/85 hover:bg-foreground/5"
      )}
    >
      <Icon className="h-[15px] w-[15px] shrink-0" style={{ color: child.color ? `hsl(${child.color})` : undefined }} />
      <span className="min-w-0 flex-1 truncate">{child.label}</span>
    </NavLink>
  );
}

function NavSections({
  sections,
  collapsed,
  pathname,
  onNavigate,
}: {
  sections: NavSection[];
  collapsed: boolean;
  pathname: string;
  /** Drawer планшета закрывает себя после перехода; меню в потоке — нет. */
  onNavigate?: () => void;
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
        const hasActive = section.items.some((i) => isNavItemActive(i, pathname));
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
                  activeOn={item.activeOn}
                  alert={item.alert}
                  badge={item.badge}
                  onNavigate={onNavigate}
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
                <div key={item.key} className="flex flex-col gap-0.5">
                  <AppNavLink
                    to={item.to}
                    end={item.end}
                    icon={item.icon}
                    label={item.label}
                    activeOn={item.activeOn}
                    alert={item.alert}
                    badge={item.badge}
                    onNavigate={onNavigate}
                  />
                  {/* Закреплённые/недавние столы — подпунктами под «Столами».
                      В рейке их нет: пять безымянных иконок там не читаются. */}
                  {item.children?.map((child) => (
                    <DeskSubLink key={child.key} child={child} pathname={pathname} onNavigate={onNavigate} />
                  ))}
                </div>
              ))}
          </div>
        );
      })}
    </nav>
  );
}

/**
 * `memo`: AppLayout перерисовывается на каждую смену адреса, клавиатуру и
 * флаги полноэкранного стола — меню от этого не меняется. Своё оно ловит само:
 * адрес (useLocation), модель навигации и меню аккаунта (контекст).
 */
export const Sidebar = memo(function Sidebar({ mobile, onNavigate }: { mobile?: boolean; onNavigate?: () => void }) {
  const { profile } = useAuth();
  const permissions = usePermissions();
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

  // Секции, гейты по ролям, бейджи и «где дом» — в модели (`useNavModel`);
  // здесь только отрисовка. Пункты аккаунта — оттуда же (`useAccountMenu`),
  // одним списком с листом «Ещё» на телефоне.
  const nav = useNavModel();
  const account = useAccountMenu({
    openCreatePage: () => setCreatePageOpen(true),
    openCreateWorkspace: () => setCreateWsOpen(true),
  });
  const sections: NavSection[] = nav.sections;
  function goHome() {
    navigate(nav.home.to);
    onNavigate?.();
  }
  function openPalette() {
    window.dispatchEvent(new Event("nova:command-palette"));
    onNavigate?.();
  }

  const PinIcon = pinned ? PanelLeftClose : PanelLeftOpen;
  const pinLabel = pinned ? "Свернуть в рейку" : "Закрепить меню";

  return (
    <div
      className={cn(
        // z-[45], а не z-40: фейды прокрутки стола (DataTable, absolute z-40)
        // стоят в DOM позже и при равном z ложились поверх раскрытой панели.
        // PageShell постоянного stacking context больше не создаёт (GSAP с
        // его остаточным transform убран): на 150 мс CSS-появления opacity<1
        // даёт свой stacking context, containing block не создаётся. RowCardSheet z-50 и полосы z-[60] остаются выше. `isolate` на main не ставим — это меняло бы наложение
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

        {/* Подсказка ⌘K — в широкой панели, где есть место для подписи; в
            рейке она была бы ещё одной безымянной иконкой. */}
        {!collapsed && (
          <button
            type="button"
            onClick={openPalette}
            className="mb-3 flex h-9 w-full items-center gap-2 rounded-lg border border-sidebar-border bg-background/60 px-2.5 text-[13px] text-muted-foreground transition-colors duration-200 hover:border-border hover:text-foreground"
          >
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1 truncate text-left">Поиск и переход…</span>
            <kbd className="hidden rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10px] tracking-wide lg:inline">
              Ctrl K
            </kbd>
          </button>
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-thin">
          <NavSections sections={sections} collapsed={collapsed} pathname={location.pathname} onNavigate={onNavigate} />
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
                    {account.unread > 0 && (
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
                    <span className="block truncate text-[13px] font-medium text-foreground">{account.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{account.caption}</span>
                  </span>
                )}
                {!collapsed && <MoreVertical className="h-4 w-4 shrink-0 text-muted-foreground" />}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="z-[330] w-56">
              {account.workspaces.map((ws) => (
                <DropdownMenuItem key={ws.id} onClick={ws.select}>
                  {ws.name}
                  {ws.active ? " ·" : ""}
                </DropdownMenuItem>
              ))}
              {/* У drawer'а «Новый стол» стоит в списке разделов, в меню не
                  дублируется; бэкап живёт на вкладке настроек и в палитре. */}
              {account.actions
                .filter((a) => a.key !== "backup" && !(mobile && a.key === "create-page"))
                .map((a) => (
                  <DropdownMenuItem key={a.key} onClick={() => void a.run()}>
                    <a.icon className="h-4 w-4" /> {a.label}
                  </DropdownMenuItem>
                ))}
              {/* «Режим доступа» есть только у Owner — у остальных RoleSwitcher
                  рисует null, и без этого гейта в меню оставались две
                  разделительные линии подряд с пустотой между ними. */}
              {account.showRoleSwitcher && (
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
              {account.themes.map((opt) => (
                <DropdownMenuItem key={opt.value} onClick={opt.select}>
                  <opt.icon className="h-4 w-4" />
                  {opt.label}
                  {opt.active ? " ·" : ""}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onClick={() => void account.shortcuts.run()}>
                <account.shortcuts.icon className="h-4 w-4" /> {account.shortcuts.label}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void account.signOut.run()} className="text-destructive focus:text-destructive">
                <account.signOut.icon className="h-4 w-4" /> {account.signOut.label}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <CreatePageDialog open={createPageOpen} onOpenChange={setCreatePageOpen} />
        {account.canCreateWorkspace && <CreateWorkspaceDialog open={createWsOpen} onOpenChange={setCreateWsOpen} />}
      </div>
    </div>
  );
});
