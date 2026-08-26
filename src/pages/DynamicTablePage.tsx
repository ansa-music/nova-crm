import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { BarChart3, Eye, EyeOff, History, Lock, Maximize2, MessageSquare, MoreHorizontal, Settings2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
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
import { EditPageDialog } from "@/components/pagesnav/EditPageDialog";
import { DeskStudioSheet } from "@/components/pagesnav/DeskStudioSheet";
import { HistoryPanel } from "@/components/history/HistoryPanel";
import { PageChatPanel } from "@/components/chat/PageChatPanel";
import { PersonalSpacePanel } from "@/components/personal/PersonalSpacePanel";
import { DailyDispatchPanel } from "@/components/dispatch/DailyDispatchPanel";
import { toast } from "@/components/ui/sonner";
import { RequestDeskViewButton } from "@/components/pagesnav/RequestDeskViewButton";
import { PAGE_ICON_MAP } from "@/utils/pageIcons";
import { useWorkspace } from "@/hooks/useWorkspace";
import { usePageRows } from "@/hooks/usePageRows";
import { useSubPages, useSubPageRows } from "@/hooks/useSubPageData";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/hooks/useAuth";
import { useViewRequests } from "@/hooks/useViewRequests";
import { ensureDiskColumn, ensurePriceColumn, fetchPageIfAccessible, togglePageVisibility } from "@/services/pageService";
import { displayNameOf } from "@/utils/displayName";
import { canOpenDesk, isRestrictedDeskRole } from "@/utils/peopleDesks";
import { useUiStore } from "@/store/uiStore";
import { cn } from "@/utils/cn";
import { recordRecentPage } from "@/hooks/useUserPageNav";
import type { PageIconName, WorkspacePage } from "@/types";

export default function DynamicTablePage() {
  const { pageId } = useParams<{ pageId: string }>();
  const [searchParams] = useSearchParams();
  const focusRowId = searchParams.get("row");
  const { activeWorkspace, activeWorkspaceId, pages, members } = useWorkspace();
  const permissions = usePermissions();
  const { profile } = useAuth();
  const { requestView, latestForPage, reload: reloadViewRequests, isLoading: viewRequestsLoading } = useViewRequests(activeWorkspaceId, profile?.uid ?? null);
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
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [activeSubPageId, setActiveSubPageId] = useState<string | null>(null);
  const [tabsReady, setTabsReady] = useState(false);
  const appliedDefaultForPageRef = useRef<string | null>(null);

  const storePage = pages.find((p) => p.id === pageId);
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
    void fetchPageIfAccessible(activeWorkspaceId, pageId, permissions.uid)
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
  const isWorkspaceOwner = permissions.isWorkspaceOwner || permissions.realRole === "owner";
  const personalOpen = page
    ? canOpenDesk({
        page,
        uid: permissions.uid,
        isOwner: isWorkspaceOwner,
        role: permissions.role,
        latestRequest: latestForPage(page.id),
      })
    : false;
  // Owner / responsible always open. Технар/viewer: own desk or accepted view-request only.
  // Do not use allowedUsers membership — live pages often list everyone.
  const hasAccess = permissions.isResolved && Boolean(page && personalOpen);
  const canSeeDispatch =
    permissions.isResolved &&
    (permissions.realRole === "owner" || permissions.realRole === "admin" || permissions.isWorkspaceOwner) &&
    (permissions.role === "owner" || permissions.role === "admin");
  const canBindDispatch = permissions.isWorkspaceOwner || permissions.realRole === "owner";
  const { subPages } = useSubPages(activeWorkspaceId, hasAccess && page ? page.id : null);
  const activeSubPage = subPages.find((s) => s.id === activeSubPageId) ?? null;
  const tabScopeReady = tabsReady && appliedDefaultForPageRef.current === pageId;
  const listenMainRows = Boolean(hasAccess && page && tabScopeReady && !activeSubPageId && !dispatchOpen);
  const listenSubRows = Boolean(hasAccess && page && tabScopeReady && activeSubPageId);
  const { rows: pageRows, isLoading: pageRowsLoading } = usePageRows(
    activeWorkspaceId,
    listenMainRows && page ? page.id : null
  );
  const { rows: subPageRows, isLoading: subPageRowsLoading } = useSubPageRows(
    activeWorkspaceId,
    listenSubRows && page ? page.id : null,
    listenSubRows ? activeSubPageId : null
  );

  // Reset the active tab whenever navigating to a different page entirely
  // — and apply that page's own "opens by default" tab (defaultSubPageId)
  // exactly once per visit, as soon as real page data has loaded. Guarded
  // by the ref (not just [pageId]) because `page` is a fresh object on
  // every Firestore snapshot, so this effect re-runs on unrelated field
  // changes too — without the guard it would keep yanking someone back to
  // the default tab every time the page doc updates for any reason.
  useEffect(() => {
    appliedDefaultForPageRef.current = null;
    setTabsReady(false);
    setActiveSubPageId(null);
    setDispatchOpen(false);
  }, [pageId]);

  useEffect(() => {
    if (!page) return;
    if (appliedDefaultForPageRef.current === pageId) return;
    appliedDefaultForPageRef.current = pageId ?? null;
    setActiveSubPageId(page.defaultSubPageId ?? null);
    setTabsReady(true);
  }, [pageId, page]);

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
    isRestrictedDeskRole(permissions.role) &&
    !isOwnDesk &&
    !isWorkspaceOwner
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
                await requestView(page, displayNameOf(profile), toUid);
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
  // Personal Space is visible only to whoever is actually responsible for
  // THIS page (or explicitly whitelisted) — being a Manager elsewhere in the
  // workspace does not grant it. Owner keeps oversight, matching how every
  // other "responsible person" page-scoped feature in this app works.
  const canUsePersonalSpace =
    permissions.role === "owner" ||
    isResponsible ||
    Boolean(page.personalZoneAllowedUsers?.includes(permissions.uid));

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
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Только просмотр</span>
        )}
        <div className="flex-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={() => setChatOpen(true)}>
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
            <Button variant="ghost" size="icon" onClick={() => { setTableFullscreen(true); setTableImmersive(true); }}>
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
            <Button variant="ghost" size="icon" className="relative">
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
              <DropdownMenuItem onClick={() => { setDispatchOpen(false); setPersonalSpaceOpen((v) => !v); }}>
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
            {(permissions.canManagePage(page) || permissions.canAssignResponsible) && (
              <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
                <Settings2 className="h-4 w-4" /> Доступ к листу
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

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
              onSelect={(id) => {
                setDispatchOpen(false);
                setActiveSubPageId(id);
              }}
              canManage={canEditData || permissions.canManagePage(page)}
              userId={profile?.uid ?? ""}
              showDispatchTab={canSeeDispatch}
              dispatchActive={dispatchOpen}
              onSelectDispatch={() => {
                setPersonalSpaceOpen(false);
                setDispatchOpen(true);
              }}
            />
          </div>

          {statsOpen && !chromeHidden && !dispatchOpen && <SubPageStats columns={activeSubPage ? activeSubPage.columns : page.columns} rows={rows} />}

          {dispatchOpen ? (
            <DailyDispatchPanel
              workspaceId={page.workspaceId}
              pageId={page.id}
              uid={permissions.uid}
              members={members}
              pages={pages}
              isOwner={canBindDispatch}
              responsibleOptions={activeWorkspace?.responsibleOptions ?? []}
            />
          ) : (
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
                rows={rows}
                canEdit={canEditData}
                canEditStructure={permissions.canManagePage(page)}
                userId={profile?.uid ?? ""}
                userName={displayNameOf(profile)}
                focusRowId={focusRowId}
              />
            )}
          </div>
          )}
        </>
      )}

      {settingsOpen && <EditPageDialog page={page} onOpenChange={() => setSettingsOpen(false)} />}
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
