import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useLocation } from "react-router";
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
import { memberHasRole, rolesLabel, type Role, type WorkspacePage } from "@/types";
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
  /** Дом активен на «/», на своём пути и на своём столе — не только по `to`. */
  active: boolean;
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
  pageMeta: (pathname: string) => PageMeta;
}

function deskChild(page: WorkspacePage, onNavigate?: () => void): NavChild {
  return {
    key: page.id,
    to: `/page/${page.id}`,
    label: page.name,
    icon: PAGE_ICON_MAP[page.icon] ?? PAGE_ICON_MAP.LayoutGrid,
    color: page.color,
    onNavigate,
  };
}

/**
 * Живая модель навигации. `onNavigate` вешается на каждый пункт — drawer и
 * нижний лист закрывают себя после перехода; Sidebar в потоке его не передаёт.
 */
export function useNavModel(opts: { onNavigate?: () => void } = {}): NavModel {
  const { onNavigate } = opts;
  const { pathname } = useLocation();
  const { profile } = useAuth();
  const { members, activeWorkspaceId, allPages, pages } = useWorkspace();
  const permissions = usePermissions();
  const { myDesk } = usePeopleDesks();
  const { privateUnreadTotal, workspaceChatUnread } = useInboxSummary(activeWorkspaceId, profile?.uid ?? null, {
    includeWorkspaceChat: true,
  });
  const { recentIds, pinnedIds } = useUserPageNav(profile?.uid);
  const deskAlerts = useUiStore((s) => s.deskAlerts);
  const osDispatchLog = useSyncExternalStore(subscribeOsDispatchLogState, osDispatchLogState);
  const openOrders = useSyncExternalStore(subscribeOpenOrdersState, openOrdersState);

  const myMembership = members.find((m) => m.uid === profile?.uid);
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
  const osDispatchUnseen = showOsDispatchNav ? osDispatchLog.unseen : 0;

  // Зелёные пункты: «Заказы», пока на бирже есть ОТКРЫТЫЙ заказ (забрали
  // последний — гаснет само); дом — когда на стол приехал заказ и его ещё не
  // открывали (метку снимает сам стол, переживает перезагрузку).
  const ordersAlert = openOrders.loaded && openOrders.count > 0;
  const deskAlert = Boolean(myDesk && deskAlerts.includes(myDesk.id));

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
  const homeActive = isHomeActive(pathname, { to: homeTo }, myDesk?.id);
  const canIssueOrders = permissions.isResolved && (hasFullAccess(permissions.role) || permissions.hasRole("os"));

  // «Свой стол» для G-S и нижней панели: у Owner без стола — закреплённый или
  // первый стол (так делал GoChordHotkeys), иначе список.
  const myDeskTo = useMemo(() => {
    if (isOs) return "/os-desk";
    if (myDesk) return `/page/${myDesk.id}`;
    if (permissions.hasFullDeskAccess) {
      const pinned = pinnedIds.map((id) => pages.find((p) => p.id === id)).find((p) => p !== undefined);
      const target = pinned ?? pages[0];
      if (target) return `/page/${target.id}`;
    }
    return showDeskNav ? "/desks" : "/os-desks";
  }, [isOs, myDesk, permissions.hasFullDeskAccess, pinnedIds, pages, showDeskNav]);

  // Закреплённые впереди недавних; только живые столы (закрытый по ссылке
  // «Неактуальный» в подсказки не лезет), свой стол не дублируем — он дом.
  // Доступ проверяем здесь же: недавний мог попасть в список до того, как
  // стол отобрали (или Owner смотрел «как Технарь»), и ярлык вёл бы в отказ.
  const { canAccessPage } = permissions;
  const deskShortcuts = useMemo<NavChild[]>(() => {
    const out: NavChild[] = [];
    const seen = new Set<string>();
    for (const id of [...pinnedIds, ...recentIds]) {
      if (seen.has(id) || id === myDesk?.id) continue;
      const page = allPages.find((p) => p.id === id && !p.inactive);
      if (!page || !canAccessPage(page)) continue;
      seen.add(id);
      out.push(deskChild(page, onNavigate));
      if (out.length >= DESK_SHORTCUTS_LIMIT) break;
    }
    return out;
  }, [pinnedIds, recentIds, myDesk?.id, allPages, onNavigate, canAccessPage]);

  const rawSections: NavSection[] = [
    {
      key: "main",
      items: [
        { key: "home", to: homeTo, label: homeLabel, icon: homeIcon, forceActive: homeActive, alert: deskAlert, onNavigate },
        { key: "orders", to: "/orders", label: "Заказы", icon: ClipboardList, alert: ordersAlert, onNavigate },
        { key: "dashboard", to: "/dashboard", label: "Дашборд", icon: LayoutDashboard, onNavigate },
        { key: "abs", to: "/abs", label: "ABS система", icon: Trophy, onNavigate },
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
          show: showDeskNav,
          onNavigate,
          children: deskShortcuts,
        },
        { key: "os-desk", to: "/os-desk", label: "Стол ОС", icon: Table2, show: showOsDeskNav, onNavigate },
        { key: "os-desks", to: "/os-desks", label: "Столы ОС", icon: ScanEye, show: showOsDesksNav, onNavigate },
        {
          key: "os-dispatch",
          to: "/os-dispatch",
          label: "Выдачи ОС",
          icon: ListChecks,
          show: showOsDispatchNav,
          badge: osDispatchUnseen,
          onNavigate,
        },
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
  // Без своего стола дом — чужой адрес («/desks»): отдельная «Главная» на тот
  // же путь дала бы два активных пункта рядом. Тогда дом — сам тот пункт.
  const homeDuplicated = rawSections.some((section) =>
    section.items.some((item) => item.key !== "home" && item.show !== false && pathOnly(item.to) === homeTo)
  );
  const sections = rawSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => item.show !== false && !(item.key === "home" && homeDuplicated)),
    }))
    .filter((section) => section.items.length > 0);
  const items = sections.flatMap((s) => s.items);
  const badgeTotal = items.reduce((sum, item) => sum + (item.badge ?? 0), 0);

  const pageMeta = useCallback(
    (pathname: string): PageMeta => {
      if (pathname === "/") return { title: homeLabel, eyebrow: "Nova" };
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
        const title = best.item.key === "home" ? homeLabel : best.item.label;
        return { title, eyebrow: best.section.title ?? "Nova" };
      }
      const extra = EXTRA_ROUTE_META.find((r) => pathMatches(pathname, r.prefix));
      if (extra) return { title: extra.title, eyebrow: extra.eyebrow };
      return { title: "Nova", eyebrow: "Nova" };
    },
    // rawSections пересобираются каждый рендер; их содержимое зависит от
    // этих же значений, так что список честный.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [homeLabel, allPages, members, isOs, isTeamlead, showDeskNav, showUsersNav, showOsDispatchNav, canAccessPage]
  );

  return {
    home: {
      to: homeTo,
      label: homeLabel,
      icon: homeIcon,
      active: homeActive,
      alert: deskAlert,
    },
    myDeskTo,
    sections,
    items,
    deskShortcuts,
    badgeTotal,
    ordersAlert,
    isOs,
    isTeamlead,
    canIssueOrders,
    pageMeta,
  };
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
export function isHomeActive(pathname: string, home: Pick<NavHome, "to">, myDeskId?: string | null) {
  return pathname === "/" || pathname === home.to || Boolean(myDeskId && pathname === `/page/${myDeskId}`);
}

/** Только заголовок экрана — для `document.title` и шапки телефона. */
export function usePageMeta(pathname: string): PageMeta {
  const { pageMeta } = useNavModel();
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
  const { privateUnreadTotal, workspaceChatUnread } = useInboxSummary(activeWorkspaceId, profile?.uid ?? null, {
    includeWorkspaceChat: true,
  });
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
    unread: privateUnreadTotal + workspaceChatUnread,
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
