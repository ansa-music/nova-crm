import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { AlertTriangle, Archive, ArchiveRestore, BarChart3, Eye, EyeOff, HardHat, History, Lock, Maximize2, MessageSquare, MoreHorizontal, Settings2, User, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/table/DataTable";
import { TableChromeExit } from "@/components/table/TableChromeExit";
import { SubPageTabs } from "@/components/table/SubPageTabs";
import { SubPageStats } from "@/components/table/SubPageStats";
import { DeskAccessDialog } from "@/components/pagesnav/DeskAccessDialog";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { DeskStudioSheet } from "@/components/pagesnav/DeskStudioSheet";
import { HistoryPanel } from "@/components/history/HistoryPanel";
import { PageChatPanel } from "@/components/chat/PageChatPanel";
import { PersonalSpacePanel } from "@/components/personal/PersonalSpacePanel";
import { IncomingDispatchBanner } from "@/components/dispatch/IncomingDispatchBanner";
import { DISPATCH_ENABLED } from "@/config/features";
import { toast } from "@/components/ui/sonner";
import { RequestDeskViewButton } from "@/components/pagesnav/RequestDeskViewButton";
import { restoreDesk, retireDesk } from "@/components/desks/deskRetireActions";
import { PAGE_ICON_MAP } from "@/utils/pageIcons";
import { useWorkspace } from "@/hooks/useWorkspace";
import { usePageRows } from "@/hooks/usePageRows";
import { useSubPages, useSubPageRows } from "@/hooks/useSubPageData";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/hooks/useAuth";
import { useViewRequests } from "@/hooks/useViewRequests";
import { ensureDiskColumn, ensurePriceColumn, fetchPageIfAccessible, setPageTechnicianDesk, togglePageVisibility } from "@/services/pageService";
import { isOsDeskId } from "@/services/osDeskService";
import { displayNameOf, myDisplayName } from "@/utils/displayName";
import { canOpenDesk, isRestrictedDeskRole, worksAsTechnician } from "@/utils/peopleDesks";
import { useUiStore } from "@/store/uiStore";
import { cn } from "@/utils/cn";
import { recordRecentPage } from "@/hooks/useUserPageNav";
import { useCurrentMonthKey } from "@/hooks/useCurrentMonthKey";
import { useDeskLoadPublisher } from "@/hooks/useDeskLoadPublisher";
import { useOsFieldKeysPublisher } from "@/hooks/useOsFieldKeysPublisher";
import { useMyOrderRows } from "@/hooks/useMyOrderRows";
import { OsOrderPanel } from "@/components/os/OsOrderPanel";
import { isMonthlyDesk } from "@/services/monthTabService";
import type { PageIconName, SubPage, WorkspacePage } from "@/types";


function visibleSubPages(subPages: SubPage[]) {
  return subPages.filter((s) => !s.isArchived).sort((a, b) => a.order - b.order);
}

/** First tab on a desk visit. Hidden Основная is never the fallback. */
function initialSubPageId(page: WorkspacePage, subPages: SubPage[]): string | null {
  const visible = visibleSubPages(subPages);
  const def = page.defaultSubPageId ?? null;
  if (def && visible.some((s) => s.id === def)) return def;
  if (page.hideMainTab) return visible[0]?.id ?? null;
  return null;
}

export default function DynamicTablePage() {
  const { pageId } = useParams<{ pageId: string }>();
  const [searchParams] = useSearchParams();
  const focusRowId = searchParams.get("row");
  const { activeWorkspace, activeWorkspaceId, allPages, members } = useWorkspace();
  const permissions = usePermissions();
  const { profile } = useAuth();
  const { requests, resolveRequest, requestView, latestForPage, reload: reloadViewRequests, isLoading: viewRequestsLoading } = useViewRequests(activeWorkspaceId, profile?.uid ?? null);
  const clearDeskAlert = useUiStore((s) => s.clearDeskAlert);
  // Стол открыли — зелёная метка «сюда приехал заказ» в меню гаснет.
  // Именно здесь, а не на клике по пункту меню: стол открывают и с обложки,
  // и по ссылке из уведомления, и метка повисла бы навсегда.
  useEffect(() => {
    if (pageId) clearDeskAlert(pageId);
  }, [pageId, clearDeskAlert]);
  const setTableFullscreen = useUiStore((s) => s.setTableFullscreen);
  const setTableImmersive = useUiStore((s) => s.setTableImmersive);
  const tableFullscreen = useUiStore((s) => s.tableFullscreen);
  const tableImmersive = useUiStore((s) => s.tableImmersive);
  const chromeHidden = tableFullscreen || tableImmersive;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deskStudioOpen, setDeskStudioOpen] = useState(false);
  const [personalSpaceOpen, setPersonalSpaceOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [activeSubPageId, setActiveSubPageId] = useState<string | null>(null);
  const [tabsReady, setTabsReady] = useState(false);
  const appliedDefaultForPageRef = useRef<string | null>(null);
  const userPickedTabRef = useRef(false);

  const storePage = allPages.find((p) => p.id === pageId);
  const [fetchedPage, setFetchedPage] = useState<WorkspacePage | null>(null);
  const page = storePage ?? fetchedPage;
  const pageFetchKeyRef = useRef<string | null>(null);

  useEffect(() => {
    setFetchedPage(null);
    pageFetchKeyRef.current = null;
  }, [pageId, activeWorkspaceId]);

  // Direct desk URL: if the list store missed this page (technician is
  // responsibleUserId but not in allowedUsers; live LIST still denied),
  // one-shot getDoc. Single-doc read is allowed by canAccessPage. Do not loop.
  useEffect(() => {
    if (!permissions.isResolved || !permissions.hasMembership) return;
    if (!pageId || !activeWorkspaceId || !permissions.uid) return;
    if (storePage) return;
    const key = `${activeWorkspaceId}:${pageId}:${permissions.uid}`;
    if (pageFetchKeyRef.current === key) return;
    pageFetchKeyRef.current = key;
    let cancelled = false;
    void fetchPageIfAccessible(
      activeWorkspaceId,
      pageId,
      permissions.uid,
      permissions.seesAllDesks || (permissions.seesOsDesks && isOsDeskId(pageId))
    )
      .then((docPage) => {
        if (!cancelled && docPage) setFetchedPage(docPage);
      })
      .catch(() => {
        /* subscribeToPages is the source of truth; a denied get is not retried */
      });
    return () => {
      cancelled = true;
    };
  }, [
    permissions.isResolved,
    permissions.hasMembership,
    permissions.uid,
    pageId,
    activeWorkspaceId,
    storePage,
  ]);

  const isOwnDesk = Boolean(page && permissions.uid && page.responsibleUserId === permissions.uid);
  // Owner or Тимлид: every desk opens for them.
  const hasFullDeskAccess = permissions.hasFullDeskAccess;
  const personalOpen = page
    ? canOpenDesk({
        page,
        uid: permissions.uid,
        isOwner: hasFullDeskAccess,
        deskBlocked: permissions.deskBlocked,
        seesAllDesks: permissions.seesAllDesks,
        seesOsDesks: permissions.seesOsDesks,
      })
    : false;
  // Owner / responsible / allowedUsers — the same three cases canAccessPage
  // authorizes in firestore.rules, so the screen and the server agree.
  const hasAccess = permissions.isResolved && Boolean(page && personalOpen);
  const { subPages, isLoading: subPagesLoading } = useSubPages(activeWorkspaceId, hasAccess && page ? page.id : null);
  // First visit of a new month: the month autopilot (AppLayout) is about to
  // create/adopt this month's tab and make it default. Hold the initial tab
  // choice until the page doc says it's done, so the desk opens on the new
  // month instead of last month's tab — capped, so a failed write can't
  // leave the desk loading forever.
  const monthKey = useCurrentMonthKey();
  const awaitingMonthTab = Boolean(
    page &&
      hasAccess &&
      page.autoMonthKey !== monthKey &&
      (hasFullDeskAccess || isOwnDesk) &&
      isMonthlyDesk(page, members)
  );
  const [monthWaitExpired, setMonthWaitExpired] = useState(false);
  useEffect(() => {
    setMonthWaitExpired(false);
    if (!awaitingMonthTab) return;
    const timer = window.setTimeout(() => setMonthWaitExpired(true), 5000);
    return () => window.clearTimeout(timer);
  }, [awaitingMonthTab, pageId]);
  const activeSubPage = subPages.find((s) => s.id === activeSubPageId) ?? null;
  const tabScopeReady = tabsReady && appliedDefaultForPageRef.current === pageId;
  const listenMainRows = Boolean(hasAccess && page && tabScopeReady && !activeSubPageId);
  const listenSubRows = Boolean(hasAccess && page && tabScopeReady && activeSubPageId);
  const {
    rows: pageRows,
    isLoading: pageRowsLoading,
    serverSynced: pageRowsSynced,
    accessPending: pageRowsAccessPending,
    accessDenied: pageRowsAccessDenied,
    readError: pageRowsError,
    retry: retryPageRows,
  } = usePageRows(
    activeWorkspaceId,
    listenMainRows && page ? page.id : null
  );
  const {
    rows: subPageRows,
    isLoading: subPageRowsLoading,
    serverSynced: subPageRowsSynced,
    accessPending: subPageRowsAccessPending,
    accessDenied: subPageRowsAccessDenied,
    readError: subPageRowsError,
    retry: retrySubPageRows,
  } = useSubPageRows(
    activeWorkspaceId,
    listenSubRows && page ? page.id : null,
    listenSubRows ? activeSubPageId : null
  );

  // Apply the default tab once per desk visit. `page` is a new object on
  // every snapshot, so a ref (not [page]) is the "already applied" guard —
  // otherwise later snapshots yank the user back. Wait for subPages: the
  // first page snapshot often has hideMainTab without defaultSubPageId yet
  // (seed writes the month tab after the page doc). Changing default on an
  // already-open desk, or a later snapshot, must not steal a manual click.
  useEffect(() => {
    appliedDefaultForPageRef.current = null;
    userPickedTabRef.current = false;
    setTabsReady(false);
    setActiveSubPageId(null);
  }, [pageId]);

  useEffect(() => {
    if (!page || !pageId || !hasAccess) return;
    if (userPickedTabRef.current) {
      appliedDefaultForPageRef.current = pageId;
      setTabsReady(true);
      return;
    }
    if (appliedDefaultForPageRef.current === pageId) return;
    if (subPagesLoading) return;
    if (awaitingMonthTab && !monthWaitExpired) return;
    appliedDefaultForPageRef.current = pageId;
    setActiveSubPageId(initialSubPageId(page, subPages));
    setTabsReady(true);
  }, [pageId, page, subPages, subPagesLoading, hasAccess, awaitingMonthTab, monthWaitExpired]);

  function handleSelectTab(subPageId: string | null) {
    userPickedTabRef.current = true;
    appliedDefaultForPageRef.current = pageId ?? appliedDefaultForPageRef.current;
    setActiveSubPageId(subPageId);
    setTabsReady(true);
  }

  // "Продолжить с того места" — remembers the last table page you had open
  // so reopening/reloading the site can jump straight back to it (see the
  // once-only redirect in AppLayout.tsx) instead of always landing on the
  // Dashboard. Purely a browser-local convenience, not synced anywhere.
  useEffect(() => {
    if (!pageId) return;
    try {
      window.localStorage.setItem("nova-crm:last-page-id", pageId);
    } catch {
      /* localStorage can throw in private-browsing edge cases — not worth failing over */
    }
    if (profile?.uid) recordRecentPage(profile.uid, pageId);
  }, [pageId, profile?.uid]);

  const rows = activeSubPageId ? subPageRows : pageRows;
  const rowsLoading = !tabsReady || (activeSubPageId ? subPageRowsLoading : pageRowsLoading);
  // Строки в Supabase, а права на стол туда ещё не доехали — см. useSyncedTableRows.
  const rowsAccessPending = activeSubPageId ? subPageRowsAccessPending : pageRowsAccessPending;
  // Права на стол есть, а этого человека в них нет — доступ закрыли.
  const rowsAccessDenied = activeSubPageId ? subPageRowsAccessDenied : pageRowsAccessDenied;
  // Строки не прочитались (нет прав, нет связи, кончилась квота) — таблица
  // остаётся скелетом, и без этой полосы человек не знает, что случилось.
  const rowsReadError = activeSubPageId ? subPageRowsError : pageRowsError;
  const retryRows = activeSubPageId ? retrySubPageRows : retryPageRows;
  const rowsFromServer = tabsReady && (activeSubPageId ? subPageRowsSynced : pageRowsSynced);

  // Карта столбцов месячной вкладки — её читает ОС, когда ведёт заказ в
  // чужом столе (см. WorkspacePage.osFieldKeys).
  useOsFieldKeysPublisher({ page: hasAccess ? page : null, subPage: activeSubPage, canEdit: Boolean(page && permissions.canEditPageData(page)) });

  // Ник ОС — он уходит в столбец «Ответственный» стола технаря: по нему
  // считаются заказы ОС, его оценки и право оценивать.
  const myOsNickValue = members.find((m) => m.uid === permissions.uid)?.osNickValue ?? "";
  // Стол ОС: заказы этого ОС в столах технарей — один запрос на весь стол.
  const isMyOsDesk = Boolean(page?.osDesk && page.responsibleUserId === permissions.uid);
  const myOrders = useMyOrderRows(activeWorkspaceId, permissions.uid, isMyOsDesk);

  useDeskLoadPublisher({
    page: hasAccess ? page : null,
    subPage: activeSubPage,
    rows,
    rowsLoading,
    rowsFromServer,
    canEdit: Boolean(page && permissions.canEditPageData(page)),
    uid: permissions.uid,
    responsibleOptions: activeWorkspace?.responsibleOptions,
  });

  // Retrofit: pages created before "Цена" / "Диск" became standard columns
  // don't have them. If an Owner/Admin opens such a page, silently add
  // once. Chained so both writes see the latest column list. Never wipes cells.
  const standardColumnMigrationRan = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!page || !hasAccess || !permissions.canManagePage(page)) return;
    if (standardColumnMigrationRan.current.has(page.id)) return;
    const needsPrice = !page.columns.some((c) => c.type === "currency");
    const needsDisk = !page.columns.some((c) => c.type === "url");
    if (!needsPrice && !needsDisk) return;
    standardColumnMigrationRan.current.add(page.id);
    void (async () => {
      try {
        let cols = page.columns;
        cols = await ensurePriceColumn(page.workspaceId, page.id, cols);
        await ensureDiskColumn(page.workspaceId, page.id, cols);
      } catch (err) {
        console.error("Не удалось добавить стандартные колонки:", err);
      }
    })();
  }, [page, hasAccess, permissions.canManagePage]);

  // 1. Still resolving user -> role -> workspace -> pages. Never render a
  //    verdict here: this is precisely the window where the old code could
  //    flash "Страница не найдена" / "Access denied" and needed an F5.
  if (!permissions.isResolved) {
    return (
      <div className="p-5">
        <div className="mb-4 flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-full" />
          <Skeleton className="h-6 w-40" />
        </div>
        <div className="overflow-hidden rounded-[16px] border border-border/60">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 border-t border-border/50 px-4 py-3 first:border-t-0">
              <Skeleton className="h-3 w-6" />
              <Skeleton className="h-3.5 flex-1" />
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 2. Resolved, but this account has no member record in the workspace.
  if (!permissions.hasMembership) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <Lock className="h-8 w-8 text-muted-foreground" />
        <p className="page-title">Вы не участник этого workspace</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Попросите владельца добавить вас — после этого страница откроется без перезагрузки.
        </p>
      </div>
    );
  }

  // 3. Resolved and a member, but this page id is not in the workspace list.
  //    Pages are listed for every member (covers); missing here means deleted
  //    or a load miss — not "hidden desk". Own desk is found by id above.
  if (!page) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <Lock className="h-8 w-8 text-muted-foreground" />
        <p className="page-title">Страница недоступна</p>
        <p className="text-sm text-muted-foreground">
          Она удалена, либо у вас нет к ней доступа. Обратитесь к Owner workspace или к
          ответственному за страницу.
        </p>
      </div>
    );
  }

  // Wait for this user's view-requests before denying — an already-approved grant
  // should not flash the request screen.
  if (
    page &&
    !hasAccess &&
    viewRequestsLoading &&
    permissions.roles.some(isRestrictedDeskRole) &&
    !isOwnDesk &&
    !hasFullDeskAccess
  ) {
    return (
      <div className="p-5">
        <div className="mb-4 flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-full" />
          <Skeleton className="h-6 w-40" />
        </div>
        <div className="overflow-hidden rounded-[16px] border border-border/60">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 border-t border-border/50 px-4 py-3 first:border-t-0">
              <Skeleton className="h-3 w-6" />
              <Skeleton className="h-3.5 flex-1" />
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!hasAccess && permissions.deskBlocked) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <Lock className="h-8 w-8 text-primary" />
        <p className="page-title">Таблицы закрыты</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Тимлид ведёт людей и доступы, а не заказы: таблицы столов открываются, только если у него есть ещё роль
          «Технарь». Доступы к «{page.name}» настраиваются в «Пользователях».
        </p>
      </div>
    );
  }

  if (!hasAccess) {
    const toUid = page.responsibleUserId || members.find((m) => m.role === "owner")?.uid || "";
    const hidden = Boolean(page.hiddenByResponsible);
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <Lock className="h-8 w-8 text-primary" />
        <p className="page-title">{hidden ? "Стол скрыт" : "Нужно разрешение"}</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          {hidden
            ? `«${page.name}» можно смотреть после разрешения ответственного. Данные листа не открываются.`
            : `Чтобы открыть «${page.name}», запросите просмотр у ответственного. Данные листа не открываются.`}
        </p>
        {toUid && toUid !== permissions.uid ? (
          <div className="w-full max-w-xs">
            <RequestDeskViewButton
              page={page}
              mine={latestForPage(page.id)}
              onRequest={async () => {
                await requestView(page, myDisplayName(profile, members), toUid);
                await reloadViewRequests();
              }}
            />
          </div>
        ) : null}
      </div>
    );
  }

  const Icon = PAGE_ICON_MAP[(page.icon as PageIconName) ?? "LayoutGrid"] ?? PAGE_ICON_MAP.LayoutGrid;
  const canEditData = permissions.canEditPageData(page);
  const isResponsible = permissions.isResponsibleForPage(page);
  // Кнопка «Доступ» в шапке: кто, кроме Owner, открывает стол, и сколько
  // запросов на просмотр ждут именно меня по этому столу.
  const accessMembers = members.filter(
    (m) =>
      m.status === "active" &&
      m.role !== "owner" &&
      (m.uid === page.responsibleUserId || Boolean(page.allowedUsers?.includes(m.uid)))
  );
  const pendingDeskRequests = requests.filter(
    (r) => r.pageId === page.id && r.status === "pending" && r.toUid === profile?.uid
  );
  const responsibleMember = members.find((m) => m.uid === page.responsibleUserId) ?? null;
  // Стол ОС принадлежит своему ОС: Тимлид смотрит его, но ответственного не
  // меняет и доступ не раздаёт (правила тоже не дают переназначить).
  const canOpenAccess = permissions.canManagePage(page) || (permissions.canAssignResponsible && !page.osDesk);
  const canRetireThisDesk = permissions.canRetireDesks && (!page.osDesk || permissions.hasFullDeskAccess);
  // Personal Space is visible only to whoever is actually responsible for
  // THIS page (or explicitly whitelisted) — being a Manager elsewhere in the
  // workspace does not grant it. Owner keeps oversight, matching how every
  // other "responsible person" page-scoped feature in this app works.
  const canUsePersonalSpace =
    permissions.role === "owner" ||
    isResponsible ||
    Boolean(page.personalZoneAllowedUsers?.includes(permissions.uid));

  const responsibleWorksAsTechnician = Boolean(
    page?.responsibleUserId && worksAsTechnician(members.find((m) => m.uid === page.responsibleUserId))
  );

  async function handleToggleTechnicianDesk(next: boolean) {
    if (!page) return;
    try {
      await setPageTechnicianDesk(page.workspaceId, page.id, next);
      toast.success(
        next
          ? "Это стол технаря: вкладка месяца и строка на «Технари»"
          : "Стол больше не считается столом технаря"
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось изменить стол");
    }
  }

  async function handleToggleVisibility() {
    if (!page) return;
    const willShow = Boolean(page.hiddenByResponsible);
    try {
      const allActiveMemberUids = members.filter((m) => m.status === "active").map((m) => m.uid);
      await togglePageVisibility(page.workspaceId, page.id, willShow, allActiveMemberUids, page.responsibleUserId);
      toast.success(
        willShow
          ? "Страница видна всем — доступ на просмотр (без редактирования)"
          : "Доступ убран у всех, кроме вас и Owner"
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось изменить видимость");
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {tableImmersive && !tableFullscreen ? <TableChromeExit label="Назад" /> : null}
      <div className={cn("page-header", chromeHidden && "hidden")}>
        <span
          className="relative flex h-8 w-8 items-center justify-center rounded-lg"
          style={{ backgroundColor: `hsl(${page.color} / 0.15)`, color: `hsl(${page.color})` }}
        >
          <Icon className="h-4 w-4" />
          {page.accentColor ? (
            <span className="absolute bottom-0 left-1 right-1 h-0.5 rounded-full" style={{ backgroundColor: `hsl(${page.accentColor})` }} />
          ) : null}
        </span>
        <h1 className="page-title">{page.name}</h1>
        {!canEditData && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex cursor-default items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                <Lock className="h-3 w-3" /> Только просмотр
              </span>
            </TooltipTrigger>
            <TooltipContent>
              Правку выдаёт {responsibleMember ? `ответственный — ${displayNameOf(responsibleMember)}` : "ответственный за стол"} или Owner
            </TooltipContent>
          </Tooltip>
        )}
        <div className="flex-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Чат страницы" onClick={() => setChatOpen(true)}>
              <MessageSquare className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Чат страницы</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={statsOpen ? "Скрыть статистику" : "Показать статистику"}
              className={cn(statsOpen && "bg-primary/10 text-primary")}
              onClick={() => setStatsOpen((v) => !v)}
            >
              <BarChart3 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{statsOpen ? "Скрыть статистику" : "Показать статистику"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="На весь экран" onClick={() => { setTableFullscreen(true); setTableImmersive(true); }}>
              <Maximize2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>На весь экран</TooltipContent>
        </Tooltip>

        {/* Everything else lives behind one menu instead of a wall of
            text buttons — up to 5 of these could show at once for an
            Owner viewing their own page, which crowded the header badly.
            Frequency-of-use decided what stayed outside: chat + fullscreen
            get used far more often per session than stats/history/settings. */}
        {/* Доступ виден прямо в шапке: аватары тех, кому открыт стол, замок у
            скрытого и счётчик запросов на просмотр. Раньше всё это лежало за
            «⋯ → Доступ к листу», и кто видит стол, можно было узнать только
            открыв диалог. */}
        {canOpenAccess && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="hidden h-8 gap-1.5 sm:inline-flex"
                onClick={() => setSettingsOpen(true)}
                aria-label="Доступ к столу"
              >
                {page.hiddenByResponsible ? (
                  <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <Users className="h-3.5 w-3.5" />
                )}
                {accessMembers.length > 0 ? (
                  <span className="flex items-center -space-x-1.5">
                    {accessMembers.slice(0, 3).map((m) => (
                      <MemberAvatar
                        key={m.uid}
                        id={m.uid}
                        name={m.name}
                        nickname={m.nickname}
                        photoURL={m.photoURL}
                        className="h-5 w-5 ring-2 ring-background"
                      />
                    ))}
                  </span>
                ) : (
                  <span className="text-muted-foreground">только вы</span>
                )}
                {accessMembers.length > 3 && (
                  <span className="text-xs text-muted-foreground">+{accessMembers.length - 3}</span>
                )}
                {pendingDeskRequests.length > 0 && (
                  <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-4 text-primary-foreground">
                    {pendingDeskRequests.length}
                  </span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {page.hiddenByResponsible ? "Стол скрыт · " : ""}
              {accessMembers.length === 0
                ? "Стол открыт только вам и Owner"
                : `Открыт: ${accessMembers.map((m) => displayNameOf(m)).join(", ")}`}
              {pendingDeskRequests.length > 0 ? ` · ждут ответа: ${pendingDeskRequests.length}` : ""}
            </TooltipContent>
          </Tooltip>
        )}
        {permissions.canManagePage(page) && (
          <Button
            variant="outline"
            size="sm"
            className="hidden h-8 gap-1.5 sm:inline-flex"
            onClick={() => setDeskStudioOpen(true)}
          >
            <Settings2 className="h-3.5 w-3.5" /> Настроить стол
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Ещё" className="relative">
              <MoreHorizontal className="h-4 w-4" />
              {personalSpaceOpen && (
                <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {isResponsible && (
              <DropdownMenuItem onClick={handleToggleVisibility}>
                {page.hiddenByResponsible ? (
                  <>
                    <EyeOff className="h-4 w-4 text-destructive" /> Скрыто от других — показать
                  </>
                ) : (
                  <>
                    <Eye className="h-4 w-4" /> Видно другим — скрыть
                  </>
                )}
              </DropdownMenuItem>
            )}
            {canUsePersonalSpace && (
              <DropdownMenuItem onClick={() => setPersonalSpaceOpen((v) => !v)}>
                <User className="h-4 w-4" /> Личное пространство
              </DropdownMenuItem>
            )}
            {permissions.canViewHistory && (
              <DropdownMenuItem onClick={() => setHistoryOpen(true)}>
                <History className="h-4 w-4" /> История
              </DropdownMenuItem>
            )}
            {permissions.canManagePage(page) && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setDeskStudioOpen(true)}>
                  <Settings2 className="h-4 w-4" /> Настроить стол
                </DropdownMenuItem>
              </>
            )}
            {canOpenAccess && (
              <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
                <Users className="h-4 w-4" /> Доступ к столу
                {pendingDeskRequests.length > 0 && (
                  <span className="ml-auto rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-4 text-primary-foreground">
                    {pendingDeskRequests.length}
                  </span>
                )}
              </DropdownMenuItem>
            )}
            {/* Owner-only: Технарь desks get month tabs and a row on «Технари»
                on their own; any other desk (e.g. the Owner's) opts in here. */}
            {canRetireThisDesk && (
              <>
                <DropdownMenuSeparator />
                {page.inactive ? (
                  <DropdownMenuItem onClick={() => void restoreDesk(page, members, permissions.uid)}>
                    <ArchiveRestore className="h-4 w-4" /> Вернуть в столы
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => void retireDesk(page, members, permissions.uid)}>
                    <Archive className="h-4 w-4" /> В неактуальные
                  </DropdownMenuItem>
                )}
              </>
            )}
            {/* Стол Технаря и стол Owner считаются столом технаря сами
                (`worksAsTechnician`) — галочка там только путала бы: снять её
                нельзя, а стояла бы она пустой. */}
            {permissions.role === "owner" && page.responsibleUserId && !responsibleWorksAsTechnician && (
              <DropdownMenuCheckboxItem
                checked={Boolean(page.technicianDesk)}
                onCheckedChange={(checked) => void handleToggleTechnicianDesk(checked === true)}
              >
                <HardHat className="h-4 w-4" /> Стол технаря
              </DropdownMenuCheckboxItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {page.inactive && !chromeHidden && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-warning/30 bg-warning/[0.07] px-4 py-2 text-sm">
          <Archive className="h-4 w-4 shrink-0 text-warning" />
          <span className="min-w-0 flex-1">
            <span className="font-medium">Стол в неактуальных.</span>{" "}
            <span className="text-muted-foreground">Его нет в «Столах», на дашборде и в «Технарях» — данные сохранены.</span>
          </span>
          {canRetireThisDesk && (
            <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => void restoreDesk(page, members, permissions.uid)}>
              <ArchiveRestore className="h-3.5 w-3.5" /> Вернуть
            </Button>
          )}
        </div>
      )}

      {rowsAccessDenied && !rowsLoading && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-destructive/30 bg-destructive/[0.07] px-4 py-2 text-sm">
          <Lock className="h-4 w-4 shrink-0 text-destructive" />
          <span className="min-w-0 flex-1">
            <span className="font-medium">Строки этого стола вам закрыты.</span>{" "}
            <span className="text-muted-foreground">
              Доступ к строкам снят или ещё не выдан — попросите ответственного за стол или Owner открыть его.
            </span>
          </span>
        </div>
      )}

      {rowsReadError && !rowsAccessPending && !rowsAccessDenied && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-destructive/30 bg-destructive/[0.07] px-4 py-2 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          <span className="min-w-0 flex-1">
            <span className="font-medium">Строки не загрузились.</span>{" "}
            <span className="text-muted-foreground">{rowsReadError} Повторяем попытку сами.</span>
          </span>
          <Button size="sm" variant="outline" className="min-h-9" onClick={retryRows}>
            Повторить сейчас
          </Button>
        </div>
      )}

      {rowsAccessPending && !rowsLoading && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-warning/30 bg-warning/[0.07] px-4 py-2 text-sm">
          <Lock className="h-4 w-4 shrink-0 text-warning" />
          <span className="min-w-0 flex-1">
            <span className="font-medium">Строки этого стола пока не видны.</span>{" "}
            <span className="text-muted-foreground">
              Доступ к столу ещё не дошёл до базы строк — он обновится сам, когда Owner или Тимлид откроет приложение.
              Данные не пропали: не вбивайте заказы заново.
            </span>
          </span>
        </div>
      )}

      {DISPATCH_ENABLED && isOwnDesk && !chromeHidden && (
        <IncomingDispatchBanner workspaceId={page.workspaceId} uid={permissions.uid} page={page} />
      )}

      {personalSpaceOpen ? (
        <div className="flex-1 overflow-hidden">
          <PersonalSpacePanel
            workspaceId={page.workspaceId}
            pageId={page.id}
            uid={permissions.uid}
            onClose={() => setPersonalSpaceOpen(false)}
          />
        </div>
      ) : (
        <>
          <div className={cn(chromeHidden && "hidden")}>
            <SubPageTabs
              workspaceId={page.workspaceId}
              page={page}
              subPages={subPages}
              activeSubPageId={activeSubPageId}
              onSelect={handleSelectTab}
              canManage={canEditData || permissions.canManagePage(page)}
              canSetDefault={permissions.canManagePage(page)}
              userId={profile?.uid ?? ""}
            />
          </div>

          {statsOpen && !chromeHidden && <SubPageStats columns={activeSubPage ? activeSubPage.columns : page.columns} rows={rows} />}

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {rowsLoading ? (
              <div className="p-4">
                <div className="overflow-hidden rounded-[16px] border border-border/60">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 border-t border-border/50 px-4 py-3 first:border-t-0">
                      <Skeleton className="h-3 w-6" />
                      <Skeleton className="h-3.5 flex-1" />
                      <Skeleton className="h-5 w-20 rounded-full" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <DataTable
                workspaceId={page.workspaceId}
                page={activeSubPage ? { ...page, columns: activeSubPage.columns } : page}
                subPageId={activeSubPage?.id}
                manualRowOrder={(activeSubPage ? activeSubPage.rowOrder : page.rowOrder) === "manual"}
                rows={rows}
                canEdit={canEditData}
                renderRowPanel={
                  isMyOsDesk
                    ? (row) => (
                        <OsOrderPanel
                          row={row}
                          pageId={page.id}
                          subPageId={activeSubPageId}
                          osUid={permissions.uid}
                          osNickValue={myOsNickValue}
                          mirror={myOrders.bySource.get(row.id) ?? null}
                          onChanged={myOrders.refresh}
                        />
                      )
                    : undefined
                }
                // Кто смотрит — для замка строк-заказов: их ведёт ОС.
                viewer={{
                  uid: permissions.uid,
                  isOwner: permissions.isWorkspaceOwner || permissions.realRole === "owner",
                  isTeamLead: permissions.hasRole("teamlead"),
                }}
                canEditStructure={permissions.canManagePage(page)}
                userId={profile?.uid ?? ""}
                userName={myDisplayName(profile, members)}
                focusRowId={focusRowId}
              />
            )}
          </div>
        </>
      )}

      {settingsOpen && (
        <DeskAccessDialog
          page={page}
          onOpenChange={() => setSettingsOpen(false)}
          canToggleVisibility={isResponsible}
          pendingRequests={pendingDeskRequests}
          onResolveRequest={(request, status) => resolveRequest(request, page, status, myDisplayName(profile, members))}
        />
      )}
      {permissions.canManagePage(page) && (
        <DeskStudioSheet page={page} open={deskStudioOpen} onOpenChange={setDeskStudioOpen} uid={profile?.uid} />
      )}
      {permissions.canViewHistory && (
        <HistoryPanel open={historyOpen} onOpenChange={setHistoryOpen} workspaceId={page.workspaceId} pageId={page.id} columns={page.columns} />
      )}
      <PageChatPanel open={chatOpen} onOpenChange={setChatOpen} workspaceId={page.workspaceId} pageId={page.id} pageName={page.name} />
    </div>
  );
}
