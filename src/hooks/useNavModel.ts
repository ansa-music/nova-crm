import { createContext, createElement, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import {
  CalendarDays,
  ClipboardList,
  Contact,
  Download,
  HardHat,
  Home,
  Keyboard,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  ListChecks,
  LogOut,
  Megaphone,
  MessageCircle,
  MessageSquare,
  PackageCheck,
  PenLine,
  Plus,
  RefreshCw,
  ScanEye,
  Settings,
  Table2,
  Trophy,
  Users,
  UsersRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  DESK_SHORTCUTS_LIMIT,
  DESKS_ITEM_KEY,
  EXTRA_ROUTE_META,
  pathMatches,
  pathOnly,
  type NavChild,
  type NavItem,
  type NavSection,
  type PageMeta,
} from "@/config/nav";
import { memberHasRole, rolesLabel, type Role, type WorkspaceMember, type WorkspacePage } from "@/types";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { usePermissions } from "@/hooks/usePermissions";
import { usePeopleDesks } from "@/hooks/usePeopleDesks";
import { useInboxSummary } from "@/hooks/useInboxSummary";
import { useUserPageNav } from "@/hooks/useUserPageNav";
import { useUiStore, type ThemeMode } from "@/store/uiStore";
import { DISPATCH_ENABLED } from "@/config/features";
import { hasFullAccess } from "@/utils/permissions";
import { isWorkspaceAdmin } from "@/utils/adminAccess";
import { displayNameOf } from "@/utils/displayName";
import { PAGE_ICON_MAP } from "@/utils/pageIcons";
import { confirmDialog } from "@/utils/appDialog";
import { toast } from "@/components/ui/sonner";
import { THEME_OPTIONS } from "@/components/layout/ThemeToggle";
import { osDispatchLogState, subscribeOsDispatchLogState } from "@/services/osDispatchLogService";
import { openOrdersState, subscribeOpenOrdersState } from "@/services/openOrdersPulse";
import { requestReloadEverywhere } from "@/services/workspaceService";
import { downloadWorkspaceBackup } from "@/services/backupService";
import { setActiveRole } from "@/services/memberService";
import { signOutUser } from "@/firebase/auth";

/**
 * Бэкап уже собирается. На модуле, а не в состоянии хука: меню аккаунта живёт
 * в трёх местах (выпадашка, лист «Ещё», палитра), и второй клик из другого
 * меню запускал второе полное чтение workspace.
 */
let backupInFlight = false;

/** Подпись роли под именем в карточке аккаунта; у ролей без подписи — email. */
const ROLE_CAPTIONS: Partial<Record<Role, string>> = {
  owner: "Владелец",
  teamlead: "Тимлид",
  manager: "Технарь",
  os: "ОС",
};

export interface NavHome {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Свой стол — дом горит и на нём (`isHomeActive`). */
  myDeskId: string | null;
  /** На стол приехал заказ, который ещё не открывали. */
  alert: boolean;
}

export interface NavModel {
  home: NavHome;
  /**
   * «Свой стол» для нижней панели и G-S: у ОС — стол ОС, у технаря — его стол,
   * у Owner без стола — закреплённый или первый, иначе список столов.
   */
  myDeskTo: string;
  /** Секции с уже отфильтрованными по роли пунктами; пустые секции убраны. */
  sections: NavSection[];
  /** Все видимые пункты подряд — палитре и шапке телефона. */
  items: NavItem[];
  /** Закреплённые и недавние столы (без своего — он и так дом). */
  deskShortcuts: NavChild[];
  /** Сумма бейджей всех пунктов — на «Ещё» в нижней панели. */
  badgeTotal: number;
  /** Непрочитанные (сообщения + чат) — точка на аватаре в меню аккаунта. */
  inboxUnread: number;
  /** Заказы на бирже ждут — зелёный пункт «Заказы». */
  ordersAlert: boolean;
  /** Чистый ОС (без второй роли): дом — «Технари», стол — «Стол ОС». */
  isOs: boolean;
  /** Тимлид без Технаря: столов не видит, дом — «Пользователи». */
  isTeamlead: boolean;
  /**
   * Может выдавать заказы («Новый заказ» в палитре): от Тимлида и выше или
   * ОС. Остальным «/orders#new» открыл бы диалог, который правила не пропустят.
   */
  canIssueOrders: boolean;
  /** Заголовок экрана; та же функция, что в `usePageMeta` (бейджи её не меняют). */
  pageMeta: (pathname: string) => PageMeta;
}

type Permissions = ReturnType<typeof usePermissions>;

/**
 * Всё, из чего складывается СОСТАВ меню: роли, столы, участники, ярлыки.
 * Меняется редко (снимок столов/участников, смена роли, открытие стола).
 */
export interface NavInputs {
  uid: string | null;
  members: WorkspaceMember[];
  /** Все столы, с «Неактуальными» и столами ОС. */
  allPages: WorkspacePage[];
  /** Живые столы технарей (`useWorkspace().pages`). */
  pages: WorkspacePage[];
  permissions: Permissions;
  myDesk: WorkspacePage | null;
  recentIds: string[];
  pinnedIds: string[];
}

/**
 * Бейджи и зелёные пункты — меняются на каждое сообщение, заказ на бирже и
 * выдачу. Отдельно от состава: заголовок экрана и G-аккорды от них не зависят.
 */
export interface NavSignals {
  privateUnreadTotal: number;
  workspaceChatUnread: number;
  osDispatchUnseen: number;
  ordersAlert: boolean;
  deskAlerts: string[];
}

const NO_SIGNALS: NavSignals = {
  privateUnreadTotal: 0,
  workspaceChatUnread: 0,
  osDispatchUnseen: 0,
  ordersAlert: false,
  deskAlerts: [],
};

function deskChild(page: WorkspacePage): NavChild {
  return {
    key: page.id,
    to: `/page/${page.id}`,
    label: page.name,
    icon: PAGE_ICON_MAP[page.icon] ?? PAGE_ICON_MAP.LayoutGrid,
    color: page.color,
  };
}

/** Гейты по ролям и «где дом» — общие для модели и заголовков экранов. */
function navGates(inp: NavInputs) {
  const { permissions, myDesk } = inp;
  const myMembership = inp.members.find((m) => m.uid === inp.uid);
  const showUsersNav = permissions.canManageUsers;
  // Настоящая роль закрывает пункт сразу — Owner, смотрящий как Технарь,
  // должен его потерять, поэтому проверяется и эффективная (permissions.role):
  // то же правило, что держит сама DispatchPage.
  const showDispatchNav =
    DISPATCH_ENABLED &&
    permissions.isResolved &&
    (permissions.hasFullDeskAccess || permissions.realRole === "admin") &&
    (hasFullAccess(permissions.role) || permissions.role === "admin");
  // У ОС стола нет — его дом «Технари». Тимлид ведёт людей, а не столы — его
  // дом «Пользователи». Обоим не показываем столовые секции. Со второй ролью
  // права складываются: без Грока и столов остаётся только чистый ОС, без
  // столов — только Тимлид, который не Технарь.
  const isOs = permissions.isResolved && permissions.roles.every((role) => role === "os");
  const isTeamlead = permissions.isResolved && permissions.deskBlocked;
  // Наблюдателю (тихое право Owner) «Столы» нужны — иначе чужой стол открыть
  // неоткуда; `seesAllDesks` здесь и означает это право.
  const showDeskNav = (!isOs && !isTeamlead) || permissions.seesAllDesks;
  const showGrokNav = !isOs;
  const showTechniciansNav = permissions.canSeeTechnicians && !isOs;
  // «Стол ОС» — личная таблица ОС, пункт только у ОС (и как второй роли).
  // «Столы ОС» — все столы ОС на просмотр: у ВСЕХ, и у самих ОС тоже.
  const showOsDeskNav = permissions.isResolved && permissions.hasRole("os");
  const showOsDesksNav = permissions.isResolved;
  // «Выдачи ОС» — мониторинг выборочных выдач: от Тимлида и выше.
  const showOsDispatchNav = permissions.isResolved && hasFullAccess(permissions.role);
  // «Правка столов» — кто заполняет столы технарей: только НАСТОЯЩИЙ Owner
  // (режим пишет база только ему — rows_set_desk_mode).
  const showDeskEditingNav = permissions.isResolved && (permissions.isWorkspaceOwner || permissions.realRole === "owner");

  // «Где дом» — раньше это считали порознь HomePage и Sidebar. Без своего
  // стола дом — список столов (а не «/»: HomePage сама редиректит на home.to,
  // и «/» замкнул бы круг).
  const homeTo = isOs
    ? "/technicians"
    : isTeamlead
      ? "/users"
      : myDesk
        ? `/page/${myDesk.id}`
        : showDeskNav
          ? "/desks"
          : "/dashboard";
  const homeLabel = isOs
    ? "Технари"
    : isTeamlead
      ? "Пользователи"
      : myDesk && memberHasRole(myMembership, "manager")
        ? "Мой стол"
        : "Главная";
  const homeIcon = isOs ? HardHat : isTeamlead ? Users : Home;
  const canIssueOrders = permissions.isResolved && (hasFullAccess(permissions.role) || permissions.hasRole("os"));
  return {
    isOs,
    isTeamlead,
    showUsersNav,
    showDispatchNav,
    showDeskNav,
    showGrokNav,
    showTechniciansNav,
    showOsDeskNav,
    showOsDesksNav,
    showOsDispatchNav,
    showDeskEditingNav,
    homeTo,
    homeLabel,
    homeIcon,
    canIssueOrders,
  };
}

type NavGates = ReturnType<typeof navGates>;

/** Все секции ДО фильтра по `show` — заголовкам экранов нужны и скрытые. */
function buildRawSections(inp: NavInputs, g: NavGates, sig: NavSignals, deskShortcuts: NavChild[]): NavSection[] {
  const myDeskId = inp.myDesk?.id ?? null;
  // Зелёные пункты: «Заказы», пока на бирже есть ОТКРЫТЫЙ заказ (забрали
  // последний — гаснет само); дом — когда на стол приехал заказ и его ещё не
  // открывали (метку снимает сам стол, переживает перезагрузку).
  const deskAlert = Boolean(myDeskId && sig.deskAlerts.includes(myDeskId));
  const homeTo = g.homeTo;
  return [
    {
      key: "main",
      items: [
        {
          key: "home",
          to: homeTo,
          label: g.homeLabel,
          icon: g.homeIcon,
          activeOn: (pathname) => isHomeActive(pathname, { to: homeTo, myDeskId }),
          alert: deskAlert,
        },
        { key: "orders", to: "/orders", label: "Заказы", icon: ClipboardList, alert: sig.ordersAlert },
        { key: "dashboard", to: "/dashboard", label: "Дашборд", icon: LayoutDashboard },
        { key: "abs", to: "/abs", label: "ABS система", icon: Trophy },
      ],
    },
    {
      key: "desks",
      title: "Столы",
      items: [
        {
          key: DESKS_ITEM_KEY,
          to: "/desks",
          label: "Столы",
          icon: LayoutGrid,
          show: g.showDeskNav,
          children: deskShortcuts,
        },
        { key: "os-desk", to: "/os-desk", label: "Стол ОС", icon: Table2, show: g.showOsDeskNav },
        { key: "os-desks", to: "/os-desks", label: "Столы ОС", icon: ScanEye, show: g.showOsDesksNav },
        {
          key: "os-dispatch",
          to: "/os-dispatch",
          label: "Выдачи ОС",
          icon: ListChecks,
          show: g.showOsDispatchNav,
          badge: g.showOsDispatchNav ? sig.osDispatchUnseen : 0,
        },
        { key: "technicians", to: "/technicians", label: "Технари", icon: HardHat, show: g.showTechniciansNav },
        { key: "desk-editing", to: "/desk-editing", label: "Правка столов", icon: PenLine, show: g.showDeskEditingNav },
      ],
    },
    {
      key: "people",
      title: "Люди",
      items: [
        { key: "people", to: "/people", label: "Люди", icon: UsersRound },
        { key: "team", to: "/team", label: "Команда", icon: Contact, show: g.showUsersNav },
        { key: "users", to: "/users", label: "Пользователи", icon: Users, show: g.showUsersNav && !g.isTeamlead },
        { key: "schedule", to: "/schedule", label: "График", icon: CalendarDays },
      ],
    },
    {
      key: "talk",
      title: "Связь",
      items: [
        { key: "messages", to: "/messages", label: "Сообщения", icon: MessageCircle, badge: sig.privateUnreadTotal },
        { key: "chat", to: "/chat", label: "Чат", icon: MessageSquare, badge: sig.workspaceChatUnread },
        { key: "announcements", to: "/announcements", label: "Объявления", icon: Megaphone },
      ],
    },
    {
      key: "more",
      title: "Ещё",
      collapsible: true,
      defaultOpen: false,
      items: [
        { key: "grok", to: "/grok-limit", label: "Грок лимит", icon: KeyRound, show: g.showGrokNav },
        { key: "dispatch", to: "/dispatch", label: "Выдача", icon: PackageCheck, show: g.showDispatchNav },
        { key: "settings", to: "/settings", label: "Настройки", icon: Settings },
      ],
    },
  ];
}

/**
 * Заголовок экрана по пути. Строится только из состава меню (без бейджей):
 * сообщение в чате не должно перерисовывать шапку и `document.title`.
 */
export function buildPageMeta(inp: NavInputs): (pathname: string) => PageMeta {
  const g = navGates(inp);
  const rawSections = buildRawSections(inp, g, NO_SIGNALS, []);
  const { allPages, members } = inp;
  const { canAccessPage } = inp.permissions;
  return (pathname: string): PageMeta => {
    if (pathname === "/") return { title: g.homeLabel, eyebrow: "Nova" };
    // Свой стол — «Мой стол», чужой — его имя; стол ОС подписан отдельно.
    // На телефоне шапка стола прячет свой h1 — имя стола здесь единственное.
    // Закрытый стол не подписываем: имя чужого стола — тоже его содержимое.
    if (pathname.startsWith("/page/")) {
      const id = pathname.slice("/page/".length).split("/")[0];
      const page = allPages.find((p) => p.id === id);
      if (page && canAccessPage(page)) return { title: page.name, eyebrow: page.osDesk ? "Стол ОС" : "Стол" };
      return { title: "Стол", eyebrow: "Столы" };
    }
    if (pathname.startsWith("/messages/")) {
      const uid = pathname.slice("/messages/".length).split("/")[0];
      const peer = members.find((m) => m.uid === uid);
      if (peer) return { title: displayNameOf(peer), eyebrow: "Сообщения" };
    }
    // Пункт меню с самым длинным совпавшим путём — «/grok-limit/apps» под
    // «Грок лимит». Берём из НЕотфильтрованных секций: у ОС «Столы» скрыты,
    // а заголовок странице всё равно нужен. При равной длине побеждает не
    // дом: «/desks» без своего стола — «Столы», а не «Главная».
    let best: { item: NavItem; section: NavSection } | null = null;
    for (const section of rawSections) {
      for (const item of section.items) {
        const to = pathOnly(item.to);
        if (!pathMatches(pathname, to, item.end)) continue;
        const bestLen = best ? pathOnly(best.item.to).length : -1;
        if (to.length > bestLen || (to.length === bestLen && best?.item.key === "home")) best = { item, section };
      }
    }
    if (best) {
      const title = best.item.key === "home" ? g.homeLabel : best.item.label;
      return { title, eyebrow: best.section.title ?? "Nova" };
    }
    const extra = EXTRA_ROUTE_META.find((r) => pathMatches(pathname, r.prefix));
    if (extra) return { title: extra.title, eyebrow: extra.eyebrow };
    return { title: "Nova", eyebrow: "Nova" };
  };
}

/**
 * Модель навигации из входов — чистая функция: считается ОДИН раз на
 * приложение (`NavModelProvider`), а не в каждом меню. От адреса не зависит:
 * активность пунктов меню считают сами по `isNavItemActive`/`isHomeActive`.
 */
export function buildNavModel(
  inp: NavInputs,
  sig: NavSignals,
  pageMeta: (pathname: string) => PageMeta
): NavModel {
  const { permissions, myDesk, pages, allPages, pinnedIds, recentIds } = inp;
  const g = navGates(inp);
  const myDeskId = myDesk?.id ?? null;

  // «Свой стол» для G-S и нижней панели: у Owner без стола — закреплённый или
  // первый стол (так делал GoChordHotkeys), иначе список.
  let myDeskTo = g.showDeskNav ? "/desks" : "/os-desks";
  if (g.isOs) myDeskTo = "/os-desk";
  else if (myDesk) myDeskTo = `/page/${myDesk.id}`;
  else if (permissions.hasFullDeskAccess) {
    const pinned = pinnedIds.map((id) => pages.find((p) => p.id === id)).find((p) => p !== undefined);
    const target = pinned ?? pages[0];
    if (target) myDeskTo = `/page/${target.id}`;
  }

  // Закреплённые впереди недавних; только живые столы (закрытый по ссылке
  // «Неактуальный» в подсказки не лезет), свой стол не дублируем — он дом.
  // Доступ проверяем здесь же: недавний мог попасть в список до того, как
  // стол отобрали (или Owner смотрел «как Технарь»), и ярлык вёл бы в отказ.
  const deskShortcuts: NavChild[] = [];
  const seen = new Set<string>();
  for (const id of [...pinnedIds, ...recentIds]) {
    if (seen.has(id) || id === myDeskId) continue;
    const page = allPages.find((p) => p.id === id && !p.inactive);
    if (!page || !permissions.canAccessPage(page)) continue;
    seen.add(id);
    deskShortcuts.push(deskChild(page));
    if (deskShortcuts.length >= DESK_SHORTCUTS_LIMIT) break;
  }

  const rawSections = buildRawSections(inp, g, sig, deskShortcuts);
  // Без своего стола дом — чужой адрес («/desks»): отдельная «Главная» на тот
  // же путь дала бы два активных пункта рядом. Тогда дом — сам тот пункт.
  const homeDuplicated = rawSections.some((section) =>
    section.items.some((item) => item.key !== "home" && item.show !== false && pathOnly(item.to) === g.homeTo)
  );
  const sections = rawSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => item.show !== false && !(item.key === "home" && homeDuplicated)),
    }))
    .filter((section) => section.items.length > 0);
  const items = sections.flatMap((s) => s.items);
  const badgeTotal = items.reduce((sum, item) => sum + (item.badge ?? 0), 0);

  return {
    home: {
      to: g.homeTo,
      label: g.homeLabel,
      icon: g.homeIcon,
      myDeskId,
      alert: Boolean(myDeskId && sig.deskAlerts.includes(myDeskId)),
    },
    myDeskTo,
    sections,
    items,
    deskShortcuts,
    badgeTotal,
    inboxUnread: sig.privateUnreadTotal + sig.workspaceChatUnread,
    ordersAlert: sig.ordersAlert,
    isOs: g.isOs,
    isTeamlead: g.isTeamlead,
    canIssueOrders: g.canIssueOrders,
    pageMeta,
  };
}

/** Куда ведут G-D и G-S — отдельно, чтобы аккорды не перерисовывались на бейджи. */
export interface NavTargets {
  homeTo: string;
  myDeskTo: string;
}

const NavModelContext = createContext<NavModel | null>(null);
const PageMetaContext = createContext<((pathname: string) => PageMeta) | null>(null);
const NavTargetsContext = createContext<NavTargets | null>(null);

function missingProvider(): never {
  throw new Error("Навигационная модель читается только внутри NavModelProvider (AppLayout)");
}

/**
 * Считает навигационную модель ОДИН раз на приложение и раздаёт тремя
 * контекстами. Раньше `useNavModel` звали Sidebar, палитра, G-аккорды,
 * PageShell, Topbar, нижняя панель и лист «Ещё» — каждый со своими
 * `usePeopleDesks` (группировка участники×столы) и `useInboxSummary` (свои
 * setState), и одно сообщение в чате давало 7–8 перерисовок каркаса.
 *
 * Контексты разделены по частоте изменений: полная модель (бейджи —
 * перерисовываются меню и нижняя панель), `pageMeta` (только состав —
 * заголовок и `document.title`), адреса G-аккордов. `children` провайдера
 * создаёт AppLayout, поэтому новое значение будит только подписчиков,
 * а не весь каркас.
 */
export function NavModelProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const uid = profile?.uid ?? null;
  // `pages` из useWorkspace — кэшированный срез (один массив на снимок), так
  // что memo ниже не рвётся на каждый рендер провайдера.
  const { members, allPages, pages, activeWorkspaceId } = useWorkspace();
  const permissions = usePermissions();
  const { myDesk } = usePeopleDesks();
  const { privateUnreadTotal, workspaceChatUnread } = useInboxSummary(activeWorkspaceId, uid, {
    includeWorkspaceChat: true,
  });
  const { recentIds, pinnedIds } = useUserPageNav(uid ?? undefined);
  const deskAlerts = useUiStore((s) => s.deskAlerts);
  const osDispatchUnseen = useSyncExternalStore(subscribeOsDispatchLogState, osDispatchLogState).unseen;
  const openOrders = useSyncExternalStore(subscribeOpenOrdersState, openOrdersState);
  const ordersAlert = openOrders.loaded && openOrders.count > 0;

  const inputs = useMemo<NavInputs>(
    () => ({ uid, members, allPages, pages, permissions, myDesk, recentIds, pinnedIds }),
    [uid, members, allPages, pages, permissions, myDesk, recentIds, pinnedIds]
  );
  const signals = useMemo<NavSignals>(
    () => ({ privateUnreadTotal, workspaceChatUnread, osDispatchUnseen, ordersAlert, deskAlerts }),
    [privateUnreadTotal, workspaceChatUnread, osDispatchUnseen, ordersAlert, deskAlerts]
  );
  const pageMeta = useMemo(() => buildPageMeta(inputs), [inputs]);
  const model = useMemo(() => buildNavModel(inputs, signals, pageMeta), [inputs, signals, pageMeta]);
  const homeTo = model.home.to;
  const myDeskTo = model.myDeskTo;
  const targets = useMemo<NavTargets>(() => ({ homeTo, myDeskTo }), [homeTo, myDeskTo]);

  return createElement(
    NavModelContext.Provider,
    { value: model },
    createElement(
      PageMetaContext.Provider,
      { value: pageMeta },
      createElement(NavTargetsContext.Provider, { value: targets }, children)
    )
  );
}

/**
 * Живая модель навигации (из `NavModelProvider`). Перерисовывает на каждый
 * бейдж — брать там, где бейджи и рисуются (меню, нижняя панель, лист «Ещё»,
 * открытая палитра). Кому нужен только заголовок или адреса — `usePageMeta`,
 * `useNavTargets`. Закрыть drawer/лист после перехода — забота того, кто
 * рисует пункт: модель общая, и колбэка одного меню в ней нет.
 */
export function useNavModel(): NavModel {
  return useContext(NavModelContext) ?? missingProvider();
}

/** Адреса «дом» и «свой стол» — для G-аккордов; бейджи их не трогают. */
export function useNavTargets(): NavTargets {
  return useContext(NavTargetsContext) ?? missingProvider();
}

/** Вторая кнопка нижней панели — одна правда для BottomNav и листа «Ещё». */
export interface BottomBarSlot {
  key: string;
  to: string;
  label: string;
  icon: LucideIcon;
}

/**
 * «Стол»-кнопка нижней панели: у ОС — личный стол ОС, у остальных — список
 * столов (свой стол и так стоит домом). Кому «Столы» закрыты (Тимлид без
 * Технаря) — «Столы ОС», они видны всем. Если дом сам и есть этот адрес
 * (Owner без своего стола — дом «/desks»), две кнопки на один путь путали бы:
 * вторая становится «Дашбордом».
 */
export function bottomBarSlot(nav: Pick<NavModel, "home" | "items" | "isOs">): BottomBarSlot {
  if (nav.isOs) return { key: "os-desk", to: "/os-desk", label: "Стол ОС", icon: Table2 };
  const desks = nav.items.find((i) => i.key === DESKS_ITEM_KEY);
  const slot: BottomBarSlot = desks
    ? { key: desks.key, to: desks.to, label: "Столы", icon: LayoutGrid }
    : { key: "os-desks", to: "/os-desks", label: "Столы ОС", icon: ScanEye };
  if (pathOnly(slot.to) !== pathOnly(nav.home.to)) return slot;
  return { key: "dashboard", to: "/dashboard", label: "Дашборд", icon: LayoutDashboard };
}

/**
 * Активен ли «дом» на этом пути: «/», сам `home.to` и свой стол. `home.to`
 * нужен дому ОС («/technicians») и Тимлида («/users»); когда он совпадает с
 * другим пунктом («/desks»), модель убирает «Главную» из секций, и двух
 * активных пунктов не бывает.
 */
export function isHomeActive(pathname: string, home: Pick<NavHome, "to" | "myDeskId">) {
  return pathname === "/" || pathname === home.to || Boolean(home.myDeskId && pathname === `/page/${home.myDeskId}`);
}

/**
 * Только заголовок экрана — для `document.title` и шапки телефона. Берёт
 * `pageMeta` из своего контекста: бейджи его не меняют, и сообщение в чате
 * PageShell/Topbar не перерисовывает.
 */
export function usePageMeta(pathname: string): PageMeta {
  const pageMeta = useContext(PageMetaContext) ?? missingProvider();
  return useMemo(() => pageMeta(pathname), [pageMeta, pathname]);
}

/** Пункт меню аккаунта — общий для выпадашки Sidebar и нижнего листа «Ещё». */
export interface AccountMenuItem {
  key: string;
  label: string;
  icon: LucideIcon;
  run: () => void | Promise<void>;
  tone?: "destructive";
}

export interface AccountMenu {
  /** Имя и подпись роли (или email) в карточке аккаунта. */
  name: string;
  caption: string;
  /** Непрочитанные (сообщения + чат) — точка на аватаре. */
  unread: number;
  workspaces: Array<{ id: string; name: string; active: boolean; select: () => void }>;
  canCreateWorkspace: boolean;
  /** Действия над workspace/столами (Owner: «Обновить у всех», «Бэкап»; «Новый стол»). */
  actions: AccountMenuItem[];
  /** У Owner — «Смотреть как…» (RoleSwitcher embedded). */
  showRoleSwitcher: boolean;
  /** Смена симулируемой роли — для палитры Ctrl+K, где RoleSwitcher не встаёт. */
  simulatedRoles: Role[];
  realRole: Role;
  currentRole: Role;
  setSimulatedRole: (role: Role) => Promise<void>;
  theme: ThemeMode;
  themes: Array<{ value: ThemeMode; label: string; icon: LucideIcon; active: boolean; select: () => void }>;
  /** Тёмная ↔ светлая одним нажатием (палитра, плитка в «Ещё»). */
  toggleTheme: () => void;
  shortcuts: AccountMenuItem;
  signOut: AccountMenuItem;
  /** Есть ли что скачать — сервис бэкапа только у Owner. */
  canDownloadBackup: boolean;
}

/**
 * Меню аккаунта одним источником: выпадашка в Sidebar, лист «Ещё» на
 * телефоне и «Действия» в палитре берут пункты отсюда, а не переписывают
 * их по-своему. Диалоги («Новый стол», «Создать workspace») остаются у
 * компонентов — хук лишь получает колбэки их открыть.
 */
export function useAccountMenu(opts: { openCreatePage?: () => void; openCreateWorkspace?: () => void } = {}): AccountMenu {
  const { openCreatePage, openCreateWorkspace } = opts;
  const { profile } = useAuth();
  const { members, workspaces, activeWorkspace, activeWorkspaceId, setActiveWorkspaceId } = useWorkspace();
  const permissions = usePermissions();
  // Непрочитанные — из общей модели: свой useInboxSummary здесь был ещё одним
  // набором setState на каждое сообщение в каждом меню.
  const unread = useNavModel().inboxUnread;
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const canCreateWorkspace = isWorkspaceAdmin(profile?.email);
  const myMembership = members.find((m) => m.uid === profile?.uid);

  const caption =
    (myMembership &&
      ((myMembership.extraRoles?.length ? rolesLabel(myMembership) : null) || ROLE_CAPTIONS[myMembership.role])) ||
    profile?.email ||
    "";

  const actions: AccountMenuItem[] = [];
  if (canCreateWorkspace && openCreateWorkspace) {
    actions.push({ key: "create-workspace", label: "Создать workspace", icon: Plus, run: openCreateWorkspace });
  }
  // Только Owner: перезагрузить сайт во всех открытых вкладках команды.
  if (permissions.isWorkspaceOwner && activeWorkspaceId) {
    actions.push({
      key: "reload-everywhere",
      label: "Обновить сайт у всех",
      icon: RefreshCw,
      run: async () => {
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
      },
    });
  }
  const canDownloadBackup = Boolean(permissions.isWorkspaceOwner && activeWorkspace);
  if (canDownloadBackup && activeWorkspace) {
    actions.push({
      key: "backup",
      label: "Скачать бэкап",
      icon: Download,
      run: async () => {
        if (backupInFlight) {
          toast.info("Бэкап уже собирается");
          return;
        }
        // Бэкап читает базу целиком — случайный клик в палитре стоил бы квоты.
        const ok = await confirmDialog({
          title: "Скачать бэкап?",
          description:
            "Будут прочитаны все столы и строки workspace — это заметный расход квоты базы. Сбор займёт до минуты.",
          confirmLabel: "Скачать",
        });
        if (!ok || backupInFlight) return;
        backupInFlight = true;
        try {
          await downloadWorkspaceBackup(activeWorkspace.id, activeWorkspace.name);
          toast.success("Бэкап скачан");
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Не удалось собрать бэкап");
        } finally {
          backupInFlight = false;
        }
      },
    });
  }
  if (permissions.canCreatePages && openCreatePage) {
    actions.push({ key: "create-page", label: "Новый стол", icon: Plus, run: openCreatePage });
  }

  const setSimulatedRole = async (target: Role) => {
    if (!activeWorkspaceId || !profile) return;
    try {
      await setActiveRole(activeWorkspaceId, profile.uid, target === permissions.realRole ? null : target);
      toast.success(target === permissions.realRole ? "Вернулись к реальной роли" : "Режим переключён");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось переключить режим");
    }
  };

  // Из «системной» переключаем по тому, что реально на экране.
  const toggleTheme = () => {
    const dark =
      theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    setTheme(dark ? "light" : "dark");
  };

  return {
    name: profile?.nickname || profile?.name || "",
    caption,
    unread,
    workspaces: workspaces.map((ws) => ({
      id: ws.id,
      name: ws.name,
      active: ws.id === activeWorkspace?.id,
      select: () => setActiveWorkspaceId(ws.id),
    })),
    canCreateWorkspace,
    actions,
    showRoleSwitcher: permissions.allowedSimulatedRoles.length > 0,
    simulatedRoles: permissions.allowedSimulatedRoles,
    realRole: permissions.realRole,
    currentRole: permissions.role,
    setSimulatedRole,
    theme,
    themes: THEME_OPTIONS.map((opt) => ({
      value: opt.value,
      label: opt.label,
      icon: opt.icon,
      active: theme === opt.value,
      select: () => setTheme(opt.value),
    })),
    toggleTheme,
    shortcuts: {
      key: "shortcuts",
      label: "Клавиши",
      icon: Keyboard,
      run: () => useUiStore.getState().setShortcutsHelpOpen(true),
    },
    signOut: {
      key: "sign-out",
      label: "Выйти",
      icon: LogOut,
      tone: "destructive",
      run: async () => {
        if (activeWorkspaceId && profile) {
          try {
            await setActiveRole(activeWorkspaceId, profile.uid, null);
          } catch {
            /* выходим в любом случае */
          }
        }
        signOutUser();
      },
    },
    canDownloadBackup,
  };
}
