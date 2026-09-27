import { createContext, createElement, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import {
  CalendarCheck2,
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
  LayoutList,
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
  Send,
  Settings,
  Table2,
  Trophy,
  Users,
  UsersRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Building2 as PlatformIcon, FileChartColumn, Smartphone, Sparkles } from "lucide-react";
import { useInstallMode } from "@/utils/pwa";
import { startInstall } from "@/components/common/InstallApp";
import { DESKS_ITEM_KEY, DESK_SHORTCUTS_LIMIT, EXTRA_ROUTE_META, MORE_ITEM_KEY, MORE_SECTION_KEY, pathMatches, pathOnly, type NavChild, type NavItem, type NavSection, type PageMeta } from "@/config/nav";
import { roleLabel, memberHasRole, rolesLabel, type Role, type WorkspaceMember, type WorkspacePage } from "@/types";
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
import { displayNameOf, myDisplayName } from "@/utils/displayName";
import { PAGE_ICON_MAP } from "@/utils/pageIcons";
import { confirmDialog } from "@/utils/appDialog";
import { toast } from "@/components/ui/sonner";
import { THEME_OPTIONS } from "@/components/layout/ThemeToggle";
import { osDispatchLogState, subscribeOsDispatchLogState } from "@/services/osDispatchLogService";
import { openOrdersState, subscribeOpenOrdersState } from "@/services/openOrdersPulse";
import { useGrokPoolSignal } from "@/hooks/useGrokPoolSignal";
import { brandName, term, useSiteConfig } from "@/config/siteTerms";
import { HOME_TARGETS, isModuleEnabled, moduleOfPath, type SiteConfig } from "@/types/siteConfig";
import { applySiteNav } from "@/config/siteNav";
import { useOsPendingOrderRequests } from "@/hooks/useOsPendingOrderRequests";
import { useTelegramAccess, useTelegramRevokeGuard } from "@/services/telegram/telegramAccess";
import { useTgTechAccess } from "@/services/telegram/tgServer";
import { subscribeTgInbox, tgInboxPulse, tgUnreadTotal } from "@/services/telegram/tgInboxPulse";
import { useWeeklyRating, weeklyLeftToRate } from "@/services/weeklyRatingService";

/** Пути разделов страницы «Ещё» — на них в меню горит сам пункт «Ещё». */
const MORE_PAGE_PATHS = [
  "/reports",
  "/platform",
  "/os-dispatch",
  "/desk-editing",
  "/people",
  "/team",
  "/users",
  "/announcements",
  "/dispatch",
  "/settings",
];
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
function roleCaption(role: Role): string | undefined {
  if (role === "owner") return "Владелец";
  if (role === "teamlead" || role === "manager" || role === "os") return roleLabel(role);
  return undefined;
}

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
  /** Непрочитанное по видам — переключатель «Общий / Личные» на странице чата. */
  chatUnread: { workspace: number; private: number };
  /** Сколько мне ещё оценить на этой неделе — счётчик вкладки «Оценки». */
  weeklyToRate: number;
  /** Заказы на бирже ждут — зелёный пункт «Заказы». */
  ordersAlert: boolean;
  /** Сколько заказов открыто на бирже (0 — нет или не знаем). */
  openOrdersCount: number;
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
  /** Администратор платформы (почта Nurba) — пункт «Платформа». */
  platformAdmin?: boolean;
  /** «Конструктор сайта» компании: слова, скрытые пункты, модули, «Главная». */
  site: SiteConfig;
}

/**
 * Бейджи и зелёные пункты — меняются на каждое сообщение, заказ на бирже и
 * выдачу. Отдельно от состава: заголовок экрана и G-аккорды от них не зависят.
 */
export interface NavSignals {
  privateUnreadTotal: number;
  workspaceChatUnread: number;
  osDispatchUnseen: number;
  /** Ожидающие просьбы технарей к этому ОС (счётчик на «Стол ОС»). */
  osRequestsPending: number;
  ordersAlert: boolean;
  openOrdersCount: number;
  deskAlerts: string[];
  /** Аккаунты Грока: сколько доступно из скольких (null — ещё не читали). */
  grokPool: { available: number; total: number } | null;
  /** Owner открыл мне раздел «Telegram». */
  telegramGranted: boolean;
  /** Технарь: ОС открыл ему чаты клиентов (SQL 20261035). */
  telegramTech: boolean;
  /** Непрочитанные в Telegram (из вкладки с соединением). */
  telegramUnread: number;
  /** Сколько мне ещё оценить на этой неделе («Оценка недели»). */
  weeklyToRate: number;
}

const NO_SIGNALS: NavSignals = {
  privateUnreadTotal: 0,
  workspaceChatUnread: 0,
  osDispatchUnseen: 0,
  osRequestsPending: 0,
  ordersAlert: false,
  openOrdersCount: 0,
  deskAlerts: [],
  grokPool: null,
  telegramGranted: false,
  telegramTech: false,
  telegramUnread: 0,
  weeklyToRate: 0,
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
    (permissions.hasFullDeskAccess || permissions.role === "admin") &&
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
  const showDeskEditingNav = permissions.isResolved && (permissions.actsAsOwner);
  // «Платформа» — админка продаж (коды компаний, тарифы): только по почте
  // администратора платформы, как и её права в базе.
  const showPlatformNav = Boolean(inp.platformAdmin);

  // «Где дом» — раньше это считали порознь HomePage и Sidebar. Без своего
  // стола дом — список столов (а не «/»: HomePage сама редиректит на home.to,
  // и «/» замкнул бы круг).
  const site = inp.site;
  const on = (path: string) => {
    const mod = moduleOfPath(path);
    return !mod || isModuleEnabled(site, mod);
  };
  let homeTo = isOs && on("/technicians")
    ? "/technicians"
    : isTeamlead
      ? "/users"
      : myDesk
        ? `/page/${myDesk.id}`
        : showDeskNav
          ? "/desks"
          : on("/dashboard")
            ? "/dashboard"
            : "/more";
  let homeLabel = homeTo === "/technicians"
    ? term("technician", "many", site)
    : isTeamlead
      ? "Пользователи"
      : myDesk && memberHasRole(myMembership, "manager")
        ? `Мой ${term("desk", "one", site).toLowerCase()}`
        : "Главная";
  let homeIcon = homeTo === "/technicians" ? HardHat : isTeamlead ? Users : Home;
  // «Главная» по ролям из «Конструктора сайта»: только туда, куда человеку
  // и так можно, и только во включённый раздел — иначе прежний дом.
  const wanted = permissions.isResolved ? site.nav?.home?.[permissions.role] : undefined;
  if (wanted && on(wanted) && HOME_TARGETS.some((t) => t.path === wanted)) {
    const allowed =
      wanted === "/desks"
        ? showDeskNav
        : wanted === "/os-desk"
          ? showOsDeskNav
          : wanted === "/technicians"
            ? permissions.canSeeTechnicians
            : true;
    if (allowed) {
      homeTo = wanted;
      homeLabel = "Главная";
      homeIcon = Home;
    }
  }
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
    showPlatformNav,
    homeTo,
    homeLabel,
    homeIcon,
    canIssueOrders,
  };
}

type NavGates = ReturnType<typeof navGates>;

/** Все секции ДО фильтра по `show` — заголовкам экранов нужны и скрытые. */
function buildRawSections(inp: NavInputs, g: NavGates, sig: NavSignals, deskShortcuts: NavChild[]): NavSection[] {
  return applySiteNav(buildDefaultSections(inp, g, sig, deskShortcuts), inp.site);
}

function buildDefaultSections(inp: NavInputs, g: NavGates, sig: NavSignals, deskShortcuts: NavChild[]): NavSection[] {
  const site = inp.site;
  const myDeskId = inp.myDesk?.id ?? null;
  // Зелёные пункты: «Заказы», пока на бирже есть ОТКРЫТЫЙ заказ (забрали
  // последний — гаснет само); дом — когда на стол приехал заказ и его ещё не
  // открывали (метку снимает сам стол, переживает перезагрузку).
  const deskAlert = Boolean(myDeskId && sig.deskAlerts.includes(myDeskId));
  const homeTo = g.homeTo;
  // «Грок лимит» — частая функция (просьба Nurba 25.09.2026: «сделать чуть
  // главнее и удобнее»): в главной секции, жирным, с «доступно N из M».
  const grokHint = sig.grokPool ? `${sig.grokPool.available} из ${sig.grokPool.total}` : undefined;
  // Просьба Nurba 25.09.2026: «в левой части слишком много кнопок — оставить
  // только нужные: заказ, ABS, стол, Грок лимит, остальное скрыть или в
  // отдельное меню». Главная секция — ровно они, всё прочее — под одной
  // свёрнутой шапкой «Остальное» (в рейке — за чертой). Секция с активным
  // пунктом раскрыта всегда (NavSections), так что «где я» не теряется.
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
        // «Заказы» — главный пункт (просьба Nurba 25.09.2026: «покажи как
        // главную с удобным доступом»): жирным, рядом — сколько открыто на
        // бирже. Вне меню те же кнопки «Мой стол · Заказы» — QuickAccess.
        {
          key: "orders",
          to: "/orders",
          label: term("order", "many", site),
          icon: ClipboardList,
          alert: sig.ordersAlert,
          emphasis: true,
          hint: sig.openOrdersCount > 0 ? `${sig.openOrdersCount} откр.` : undefined,
        },
        // У ОС дом — «Технари» (дубль убирает фильтр ниже); стол ОС — свой пункт.
        {
          key: "os-desk",
          to: "/os-desk",
          label: term("osDesk", "one", site),
          icon: Table2,
          show: g.showOsDeskNav,
          emphasis: true,
          badge: g.showOsDeskNav ? sig.osRequestsPending : 0,
        },
        {
          key: DESKS_ITEM_KEY,
          to: "/desks",
          label: term("desk", "many", site),
          icon: LayoutGrid,
          show: g.showDeskNav,
          children: deskShortcuts,
        },
        { key: "technicians", to: "/technicians", label: term("technician", "many", site), icon: HardHat, show: g.showTechniciansNav },
        { key: "os-desks", to: "/os-desks", label: term("osDesk", "many", site), icon: ScanEye, show: g.showOsDesksNav },
        // «Telegram» — рабочий аккаунт прямо в Nova (26.09.2026): у тех, кому
        // Owner открыл раздел (любая роль), и у самого Owner — он там выдаёт
        // доступ и ключи (просьба Nurba: «сделай слева как главное»).
        {
          key: "telegram",
          to: "/telegram",
          label: term("telegram", "one", site),
          icon: Send,
          show: sig.telegramGranted || sig.telegramTech || (inp.permissions.isResolved && inp.permissions.actsAsOwner),
          badge: sig.telegramGranted ? sig.telegramUnread : 0,
        },
        { key: "grok", to: "/grok-limit", label: term("grok", "one", site), icon: KeyRound, show: g.showGrokNav, hint: grokHint, emphasis: true },
        // «Промты» (27.09.2026): личные и общие, копирование в один клик.
        { key: "prompts", to: "/prompts", label: term("prompts", "one", site), icon: Sparkles, show: inp.permissions.isResolved },
        // Чат — ОДИН пункт (просьба Nurba 25.09.2026: «чат в быстром доступе,
        // одна страница, внутри переключиться на общий и личный»): горит и на
        // «/chat», и на «/messages», бейдж — сумма. Ведёт туда, где ждут:
        // есть непрочитанные только в личных — сразу в личные.
        {
          key: "chat",
          to: sig.privateUnreadTotal > 0 && sig.workspaceChatUnread === 0 ? "/messages" : "/chat",
          label: term("chat", "one", site),
          icon: MessageSquare,
          badge: sig.privateUnreadTotal + sig.workspaceChatUnread,
          activeOn: (pathname) => pathMatches(pathname, "/chat") || pathMatches(pathname, "/messages"),
        },
        // График — тоже частое (та же просьба): смены и выходные на сегодня.
        { key: "schedule", to: "/schedule", label: term("schedule", "one", site), icon: CalendarDays },
        // «Дашборд» и «ABS система» — ОДИН пункт (просьба Nurba 25.09.2026:
        // «объедини так же Дашборд и ABS в одну вкладку»): горит на обоих
        // адресах, внутри переключатель «Дашборд / ABS система».
        // Третья вкладка внутри — «Оценка недели» (27.09.2026): пока есть
        // кого оценить, пункт ведёт прямо туда и несёт счётчик.
        {
          key: "dashboard",
          to: sig.weeklyToRate > 0 ? "/weekly-rating" : "/dashboard",
          label: `${term("dashboard", "one", site)} · ${site.terms?.abs?.one ? term("abs", "one", site) : "ABS"}`,
          icon: LayoutDashboard,
          badge: sig.weeklyToRate,
          activeOn: (pathname) =>
            pathMatches(pathname, "/dashboard") || pathMatches(pathname, "/abs") || pathMatches(pathname, "/weekly-rating"),
        },
        // Всё остальное — отдельной страницей (просьба Nurba 25.09.2026), а в
        // меню один пункт. Бейдж — сумма непрочитанного с той страницы.
        {
          key: MORE_ITEM_KEY,
          to: "/more",
          label: "Ещё",
          icon: LayoutList,
          badge: g.showOsDispatchNav ? sig.osDispatchUnseen : 0,
          // «Ещё» горит и на своих разделах: человек пришёл туда через неё.
          activeOn: (pathname) =>
            pathname === "/more" ||
            MORE_PAGE_PATHS.some((to) => pathMatches(pathname, to)),
        },
      ],
    },
    {
      key: MORE_SECTION_KEY,
      title: "Остальное",
      items: [
        // «ABS система» — вкладка пункта «Дашборд · ABS»; скрытый пункт — только
        // ради заголовка экрана «/abs» (buildPageMeta читает и скрытые).
        { key: "abs", to: "/abs", label: term("abs", "one", site), icon: Trophy, show: false },
        { key: "weekly-rating", to: "/weekly-rating", label: "Оценка недели", icon: CalendarCheck2, show: false },
        // «Отчёты» — итоги прошлых периодов (касса технарей, KPI ОС), всем ролям.
        { key: "reports", to: "/reports", label: term("reports", "one", site), icon: FileChartColumn },
        {
          key: "os-dispatch",
          to: "/os-dispatch",
          label: `Выдачи ${term("os", "one", site)}`,
          icon: ListChecks,
          show: g.showOsDispatchNav,
          badge: g.showOsDispatchNav ? sig.osDispatchUnseen : 0,
        },
        { key: "desk-editing", to: "/desk-editing", label: `Правка ${term("desk", "many", site).toLowerCase()}`, icon: PenLine, show: g.showDeskEditingNav },
        { key: "platform", to: "/platform", label: "Платформа", icon: PlatformIcon, show: g.showPlatformNav },
        { key: "people", to: "/people", label: term("people", "one", site), icon: UsersRound },
        { key: "team", to: "/team", label: term("team", "one", site), icon: Contact, show: g.showUsersNav },
        { key: "users", to: "/users", label: "Пользователи", icon: Users, show: g.showUsersNav && !g.isTeamlead },
        // «Сообщения» в меню нет — это вкладка «Личные» того же «Чата». Пункт
        // остаётся скрытым ради заголовка экрана «/messages» (buildPageMeta
        // читает и скрытые пункты).
        { key: "messages", to: "/messages", label: "Сообщения", icon: MessageCircle, show: false },
        { key: "announcements", to: "/announcements", label: term("announcements", "one", site), icon: Megaphone },
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
    if (pathname === "/") return { title: g.homeLabel, eyebrow: brandName(inp.site) };
    // Свой стол — «Мой стол», чужой — его имя; стол ОС подписан отдельно.
    // На телефоне шапка стола прячет свой h1 — имя стола здесь единственное.
    // Закрытый стол не подписываем: имя чужого стола — тоже его содержимое.
    if (pathname.startsWith("/page/")) {
      const id = pathname.slice("/page/".length).split("/")[0];
      const page = allPages.find((p) => p.id === id);
      if (page && canAccessPage(page)) return { title: page.name, eyebrow: page.osDesk ? term("osDesk", "one", inp.site) : term("desk", "one", inp.site) };
      return { title: term("desk", "one", inp.site), eyebrow: term("desk", "many", inp.site) };
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
      // Разделы со страницы «Ещё» — надзаголовок «Ещё»: так и в шапке
      // телефона видно, откуда сюда пришли.
      const eyebrow = best.section.key === MORE_SECTION_KEY ? "Ещё" : (best.section.title ?? brandName(inp.site));
      return { title, eyebrow };
    }
    const extra = EXTRA_ROUTE_META.find((r) => pathMatches(pathname, r.prefix));
    if (extra) return { title: extra.title, eyebrow: extra.eyebrow === "Nova" ? brandName(inp.site) : extra.eyebrow };
    const brand = brandName(inp.site);
    return { title: brand, eyebrow: brand };
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
  if (g.isOs) myDeskTo = isModuleEnabled(inp.site, "osDesk") ? "/os-desk" : g.homeTo;
  else if (myDesk) myDeskTo = `/page/${myDesk.id}`;
  else if (permissions.hasFullDeskAccess) {
    const pinned = pinnedIds.map((id) => pages.find((p) => p.id === id)).find((p) => p !== undefined);
    const target = pinned ?? pages[0];
    if (target) myDeskTo = `/page/${target.id}`;
  }

  // Подпункты «Столов» — ДВА последних посещённых стола (просьба Nurba
  // 25.09.2026), закреплённые сюда больше не лезут: они наверху списка
  // «Столов» и в палитре. Только живые столы (закрытый по ссылке
  // «Неактуальный» в подсказки не лезет), свой стол не дублируем — он дом.
  // Доступ проверяем здесь же: недавний мог попасть в список до того, как
  // стол отобрали (или Owner смотрел «как Технарь»), и ярлык вёл бы в отказ.
  const deskShortcuts: NavChild[] = [];
  const seen = new Set<string>();
  for (const id of recentIds) {
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
    chatUnread: { workspace: sig.workspaceChatUnread, private: sig.privateUnreadTotal },
    weeklyToRate: sig.weeklyToRate,
    ordersAlert: sig.ordersAlert,
    openOrdersCount: sig.ordersAlert ? sig.openOrdersCount : 0,
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
  const platformAdmin = isWorkspaceAdmin(profile?.email);
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
  const openOrdersCount = openOrders.loaded ? openOrders.count : 0;
  // Просьбы технарей к ОС — одна подписка на приложение (её же читает стол ОС).
  const osRequestsPending = useOsPendingOrderRequests(
    activeWorkspaceId,
    uid,
    permissions.isResolved && permissions.hasRole("os")
  ).requests.length;
  const grokPool = useGrokPoolSignal(activeWorkspaceId, permissions.isResolved && !permissions.roles.every((r) => r === "os"));
  // Раздел «Telegram»: Owner открывает его любому участнику (с 20261012 роль
  // не важна), поэтому свой доступ проверяет каждый.
  const canHaveTelegram = permissions.isResolved;
  const telegramAccess = useTelegramAccess(activeWorkspaceId, uid, canHaveTelegram);
  // Owner заходит и без строки доступа (аккаунт workspace на сервере) — у
  // него автовыход не нужен.
  useTelegramRevokeGuard(permissions.upkeepOwner ? null : activeWorkspaceId, uid, telegramAccess, { resolved: permissions.isResolved, canHaveAccess: canHaveTelegram });
  const telegramGranted = canHaveTelegram && telegramAccess.granted;
  const telegramTech = useTgTechAccess(activeWorkspaceId, uid, canHaveTelegram && !telegramAccess.loading && !telegramGranted);
  const telegramUnread = tgUnreadTotal(useSyncExternalStore(subscribeTgInbox, tgInboxPulse));
  // Оценка недели: один запрос на загрузку (модуль weeklyRatingService общий
  // со страницей, ABS и «Технарями»). Выключен раздел «Дашборд» — не спрашиваем.
  const site = useSiteConfig();
  const weeklySnap = useWeeklyRating(activeWorkspaceId, permissions.isResolved && isModuleEnabled(site, "dashboard"));
  const weeklyToRate = useMemo(() => weeklyLeftToRate(weeklySnap, members, uid), [weeklySnap, members, uid]);

  const inputs = useMemo<NavInputs>(
    () => ({ uid, members, allPages, pages, permissions, myDesk, recentIds, pinnedIds, platformAdmin, site }),
    [uid, members, allPages, pages, permissions, myDesk, recentIds, pinnedIds, platformAdmin, site]
  );
  const signals = useMemo<NavSignals>(
    () => ({ privateUnreadTotal, workspaceChatUnread, osDispatchUnseen, osRequestsPending, ordersAlert, openOrdersCount, deskAlerts, grokPool, telegramGranted, telegramTech, telegramUnread, weeklyToRate }),
    [privateUnreadTotal, workspaceChatUnread, osDispatchUnseen, osRequestsPending, ordersAlert, openOrdersCount, deskAlerts, grokPool, telegramGranted, telegramTech, telegramUnread, weeklyToRate]
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
  const osDesk = nav.items.find((i) => i.key === "os-desk");
  if (nav.isOs && osDesk) return { key: "os-desk", to: osDesk.to, label: osDesk.label, icon: Table2 };
  const desks = nav.items.find((i) => i.key === DESKS_ITEM_KEY);
  const osDesks = nav.items.find((i) => i.key === "os-desks");
  const dashboard = nav.items.find((i) => i.key === "dashboard");
  const slot: BottomBarSlot | null = desks
    ? { key: desks.key, to: desks.to, label: desks.label, icon: LayoutGrid }
    : osDesks
      ? { key: "os-desks", to: osDesks.to, label: osDesks.label, icon: ScanEye }
      : null;
  if (slot && pathOnly(slot.to) !== pathOnly(nav.home.to)) return slot;
  if (dashboard) return { key: "dashboard", to: "/dashboard", label: term("dashboard", "one"), icon: LayoutDashboard };
  return { key: "more-page", to: "/more", label: "Ещё", icon: LayoutList };
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
  /** Включён режим другой роли — подпись под именем говорит «Режим: …» (вместо плашки сверху). */
  simulating: boolean;
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
  const installMode = useInstallMode();
  const myMembership = members.find((m) => m.uid === profile?.uid);

  const caption = permissions.isSimulating
    ? `Режим: ${roleLabel(permissions.role)}`
    : (myMembership &&
      ((myMembership.extraRoles?.length ? rolesLabel(myMembership) : null) || roleCaption(myMembership.role))) ||
    profile?.email ||
    "";

  const actions: AccountMenuItem[] = [];
  // Приложение на экран — без магазинов (PWA). В установленном пункта нет.
  if (installMode !== "installed" && installMode !== "unsupported") {
    actions.push({ key: "install-app", label: "Установить приложение", icon: Smartphone, run: () => startInstall(installMode) });
  }
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
    name: profile ? myDisplayName(profile, members) : "",
    caption,
    simulating: permissions.isSimulating,
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
