import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  BarChart3,
  Eye,
  EyeOff,
  HardHat,
  HelpCircle,
  History,
  Lock,
  Maximize2,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Settings2,
  User,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { Skeleton } from "@/components/ui/skeleton";
import { AccessDenied } from "@/components/common/AccessDenied";
import { DataTable } from "@/components/table/DataTable";
import { TableChromeExit } from "@/components/table/TableChromeExit";
import { SubPageTabs } from "@/components/table/SubPageTabs";
import { SubPageStats } from "@/components/table/SubPageStats";
import { OsDeskStats } from "@/components/os/OsDeskStats";
import { DeskAccessDialog } from "@/components/pagesnav/DeskAccessDialog";
import { DeskStudioSheet } from "@/components/pagesnav/DeskStudioSheet";
import { HistoryPanel } from "@/components/history/HistoryPanel";
import { PageChatPanel } from "@/components/chat/PageChatPanel";
import { PersonalSpacePanel } from "@/components/personal/PersonalSpacePanel";
import { IncomingDispatchBanner } from "@/components/dispatch/IncomingDispatchBanner";
import { DISPATCH_ENABLED } from "@/config/features";
import { toast } from "@/components/ui/sonner";
import { RequestDeskViewButton } from "@/components/pagesnav/RequestDeskViewButton";
import { restoreDesk, retireDesk } from "@/components/desks/deskRetireActions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { usePageRows } from "@/hooks/usePageRows";
import { useSubPages, useSubPageRows } from "@/hooks/useSubPageData";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/hooks/useAuth";
import { useViewRequests } from "@/hooks/useViewRequests";
import {
  ensureDiskColumn,
  ensurePriceColumn,
  fetchPageIfAccessible,
  setPageTechnicianDesk,
  togglePageVisibility,
  updateRowCellsBulk,
} from "@/services/pageService";
import {
  ensureOsDeskColumns,
  ensureOsDeskMonth,
  isOsDeskId,
  missingOsDeskColumns,
  OS_RETURNED_REISSUE_ERROR,
  pushOsRowToTech,
  resolveOsDeskKeys,
  returnedRowOnTechDesk,
} from "@/services/osDeskService";
import { techUidByNick } from "@/services/rows/osOrderMirror";
import { claimCount, useMyExchangeOrders } from "@/hooks/useMyExchangeOrders";
import { OsExchangePicker } from "@/components/os/OsExchangePicker";
import {
  CellActionButton,
  type CellActionView,
} from "@/components/table/CellActionButton";
import { StatusBadge } from "@/components/table/StatusBadge";
import { OsTechLeftView, TechBadge } from "@/components/os/TechBadge";
import {
  OsDeskGuide,
  osDeskGuideDismissed,
  setOsDeskGuideDismissed,
} from "@/components/os/OsDeskGuide";
import {
  osRowIssued,
  osTechCellState,
  type OsTechAction,
  type OsTechCellState,
} from "@/utils/osTechCell";
import {
  resolveTechIdentity,
  techIdentityOfUid,
  techIdentitySignature,
  techShortName,
  type TechIdentity,
} from "@/utils/techIdentity";
import {
  DEFAULT_STATUS_OPTIONS,
  ensureApprovalStatus,
  ensureDoneStatus,
  findDoneStatusOption,
  findInProgressStatusOption,
  getColumnOptions,
  isApprovalOption,
  isApprovalStatusValue,
} from "@/utils/columnOptions";
import { firestoreErrorText } from "@/utils/dbError";
import { displayNameOf, myDisplayName } from "@/utils/displayName";
import {
  canOpenDesk,
  isRestrictedDeskRole,
  worksAsTechnician,
} from "@/utils/peopleDesks";
import { useUiStore } from "@/store/uiStore";
import { cn } from "@/utils/cn";
import { recordRecentPage } from "@/hooks/useUserPageNav";
import { useCurrentPeriodKey, usePeriodSettings } from "@/hooks/useCurrentPeriodKey";
import { useDeskLoadPublisher } from "@/hooks/useDeskLoadPublisher";
import { useOsFieldKeysPublisher } from "@/hooks/useOsFieldKeysPublisher";
import { useTableDiagWatch } from "@/hooks/useTableDiagWatch";
import { useMyOrderRows } from "@/hooks/useMyOrderRows";
import {
  OS_CLAIM_KICK_EVENT,
  OS_CLAIMED_EVENT,
} from "@/services/rows/osOrderClaim";
import {
  OS_DEAD_LINK_PROBLEM,
  useOsDeskDispatch,
} from "@/hooks/useOsDeskDispatch";
import { OsOrderPanel } from "@/components/os/OsOrderPanel";
import { OsDispatchChoiceDialog } from "@/components/os/OsDispatchChoiceDialog";
import { OsOrderRequestsPanel } from "@/components/os/OsOrderRequestsPanel";
import { OsRequestDecisionDialog } from "@/components/os/OsRequestDecisionDialog";
import { useOsPendingOrderRequests } from "@/hooks/useOsPendingOrderRequests";
import { findRequestMirror } from "@/services/orderRequestDecision";
import { TechPickerSheet } from "@/components/os/TechPickerSheet";
import { sbPatchRow } from "@/services/rows/supabaseRowStore";
import { useDeskModeSupported } from "@/services/rows/deskMode";
import { usesSupabaseRows } from "@/services/rows/rowsBackend";
import { DESK_ROWS_TABLE, supabaseRows } from "@/lib/supabaseRows";
import {
  MAIN_TAB_PARAM,
  deskTabParam,
  readDeskFrom,
  readStoredDeskTab,
  storeDeskTab,
} from "@/utils/deskLinks";
import { TechOrderPanel } from "@/components/os/TechOrderPanel";
import { OrderStatusRequestDialog } from "@/components/os/OrderStatusRequestDialog";
import { useMyPendingOrderRequests } from "@/hooks/useMyPendingOrderRequests";
import { orderRequestId, type OrderRequest } from "@/services/orderRequestService";
import { isMonthlyDesk } from "@/services/monthTabService";
import type { PageRow, PaymentMethod, SubPage, WorkspacePage } from "@/types";
import type { DeskSummary, DeskTableActions } from "@/types/deskSummary";
import { formatNumber } from "@/utils/format";
import { PaymentChip } from "@/components/cashbox/PaymentChip";
import {
  OsDatesCell,
  OsDatesInline,
  OsUpsellDate,
  type OsDatesInfo,
} from "@/components/os/OsDatesCell";
import { osDateSlots, slotShown, type OsDateSlot } from "@/utils/osDates";
import { PaymentMethodsDialog } from "@/components/cashbox/PaymentMethodsDialog";
import { useOsTotalsKeeper } from "@/hooks/useOsTotalsKeeper";
import { osRowTotal, paymentMethodsOf, paymentPatch } from "@/utils/payment";
import { normalizeNumericInput, parseLooseNumber } from "@/utils/numberInput";
import {
  updateSubPageColumns,
  updateSubPageRowCellsBulk,
} from "@/services/subPageService";

function visibleSubPages(subPages: SubPage[]) {
  return subPages
    .filter((s) => !s.isArchived)
    .sort((a, b) => a.order - b.order);
}

/** First tab on a desk visit. Hidden Основная is never the fallback. */
function initialSubPageId(
  page: WorkspacePage,
  subPages: SubPage[],
): string | null {
  const visible = visibleSubPages(subPages);
  const def = page.defaultSubPageId ?? null;
  if (def && visible.some((s) => s.id === def)) return def;
  if (page.hideMainTab) return visible[0]?.id ?? null;
  return null;
}

/**
 * Вкладка из адреса (`?tab=`) или из памяти браузера → id вкладки.
 * `null` — «Основная», `undefined` — такой вкладки на столе нет (удалена,
 * в архиве, скрыта «Основная»): тогда решает обычное умолчание стола.
 */
function resolveTabRef(
  ref: string | null | undefined,
  page: WorkspacePage,
  subPages: SubPage[],
): string | null | undefined {
  if (ref === null || ref === MAIN_TAB_PARAM)
    return page.hideMainTab ? undefined : null;
  if (!ref) return undefined;
  return visibleSubPages(subPages).some((s) => s.id === ref) ? ref : undefined;
}

/**
 * Ссылка на строку без вкладки (`?row` без `?tab`): на какой вкладке лежит
 * строка. Один крошечный запрос по первичному ключу — только в режиме
 * Supabase; в Firestore строки разложены по подколлекциям вкладок, и обход
 * их всех ради одной ссылки не стоит квоты. `undefined` — не нашли.
 */
async function lookupRowTab(
  workspaceId: string,
  pageId: string,
  rowId: string,
): Promise<string | null | undefined> {
  if (!usesSupabaseRows(workspaceId)) return undefined;
  const { data, error } = await supabaseRows
    .from(DESK_ROWS_TABLE)
    .select("tab_id")
    .eq("workspace_id", workspaceId)
    .eq("page_id", pageId)
    .eq("id", rowId)
    .limit(1);
  if (error || !data || data.length === 0) return undefined;
  const tab = (data[0] as { tab_id?: string | null }).tab_id ?? "";
  return tab === "" ? null : tab;
}

/**
 * Сводка стола для шапки («Общий · Готово · В работе · Ждём») — маленький
 * стор на экземпляр страницы, а не state страницы: DataTable отдаёт сводку
 * после правки, и setState у страницы перерисовывал её ЦЕЛИКОМ вместе с
 * таблицей — второй полный проход стола на каждую правку денег или статуса.
 * Теперь перерисовывается только блок итогов в шапке.
 */
interface DeskSummaryStore {
  get: () => DeskSummary | null;
  set: (next: DeskSummary | null) => void;
  subscribe: (listener: () => void) => () => void;
}

function createDeskSummaryStore(): DeskSummaryStore {
  let value: DeskSummary | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      if (next === value) return;
      value = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Итоги по видимым строкам в шапке стола — подписаны на стор сами. */
function DeskSummaryInline({ store }: { store: DeskSummaryStore }) {
  const summary = useSyncExternalStore(store.subscribe, store.get, store.get);
  // Моно, без валюты: числа читаются столбиком. «В работе» и «Ждём» при нуле
  // молчат, без денежного столбца блока нет вовсе, без статуса — только
  // «Общий». На узком экране блок не влезает — прячем.
  if (!summary?.hasCurrency) return null;
  return (
    <div className="hidden shrink-0 items-center gap-4 font-mono text-[12.5px] text-muted-foreground xl:flex">
      <span>
        Общий{" "}
        <b className="font-medium text-foreground">
          {formatNumber(summary.total)}
        </b>
      </span>
      {summary.hasStatus && (
        <span>
          Готово{" "}
          <b className="font-medium text-success">
            {formatNumber(summary.done)}
          </b>
        </span>
      )}
      {summary.hasStatus && summary.inProgress > 0 && (
        <span>
          В работе{" "}
          <b className="font-medium text-primary">
            {formatNumber(summary.inProgress)}
          </b>
        </span>
      )}
      {summary.hasStatus && summary.waiting > 0 && (
        <span>
          Ждём{" "}
          <b className="font-medium text-warning">
            {formatNumber(summary.waiting)}
          </b>
        </span>
      )}
    </div>
  );
}

export default function DynamicTablePage() {
  const { pageId } = useParams<{ pageId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const focusRowId = searchParams.get("row");
  const tabParam = searchParams.get("tab");
  const location = useLocation();
  const navigate = useNavigate();
  // Откуда пришли — «Технари», «Люди», уведомление кладут сюда `from`.
  const cameFrom = readDeskFrom(location.state);
  // Все `setSearchParams` стола передают state дальше: без него `from`
  // затирается, и после клика по месяцу «← Заказы» становится «Назад».
  // Через ref — чтобы эффекты не перезапускались на каждый новый объект state.
  const locationStateRef = useRef<unknown>(location.state);
  useEffect(() => {
    locationStateRef.current = location.state;
  }, [location.state]);
  const {
    activeWorkspace,
    activeWorkspaceId,
    allPages,
    pages: workspaceDesks,
    members,
  } = useWorkspace();
  const permissions = usePermissions();
  const { profile } = useAuth();
  const {
    requests,
    resolveRequest,
    requestView,
    latestForPage,
    reload: reloadViewRequests,
    isLoading: viewRequestsLoading,
  } = useViewRequests(activeWorkspaceId, profile?.uid ?? null);
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
  // Переход на другой стол по ссылке (уведомление, дашборд, «Технари») не
  // должен открывать его «без меню»: полный экран — про тот стол, где его
  // включили. Сбрасываем при монтировании и смене адреса (`ErrorBoundary` в
  // AppLayout перемонтирует страницу по pathname, но полагаться на это не
  // стоит — эффект по pageId покрывает оба случая).
  useEffect(() => {
    setTableFullscreen(false);
    setTableImmersive(false);
  }, [pageId, setTableFullscreen, setTableImmersive]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deskStudioOpen, setDeskStudioOpen] = useState(false);
  const [personalSpaceOpen, setPersonalSpaceOpen] = useState(false);
  // Статистика — по кнопке в шапке, ОКНОМ поверх стола (просьба Nurba
  // 25.09.2026: панель над таблицей «занимает место — сделай по вызову
  // кнопки»). Не запоминается: открыл — посмотрел — закрыл. Стол технаря —
  // сводка по столбцам, стол ОС — KPI и % от апсейла (OsDeskStats); их
  // подписки живут, только пока окно открыто. На телефоне — лист снизу.
  const [statsOpen, setStatsOpen] = useState(false);
  const statsOnPhone = useIsMobile();
  // Сводка и действия стола — их считает DataTable (у него отфильтрованные
  // строки и статусы), шапка только рисует. См. types/deskSummary.ts.
  const [summaryStore] = useState(createDeskSummaryStore);
  const [actions, setActions] = useState<DeskTableActions | null>(null);
  const [activeSubPageId, setActiveSubPageId] = useState<string | null>(null);
  // Пока грузится другой стол или вкладка, DataTable ещё не смонтирован и
  // ничего не отдал — без сброса в шапке висели бы итоги и «+ Заказ» прошлого
  // стола. Сброс только по смене адреса, а не на каждый ререндер: иначе
  // кнопка мигала бы при каждом пересчёте сводки.
  useEffect(() => {
    summaryStore.set(null);
    setActions(null);
  }, [pageId, activeSubPageId, summaryStore]);
  const [tabsReady, setTabsReady] = useState(false);
  const appliedDefaultForPageRef = useRef<string | null>(null);
  const userPickedTabRef = useRef(false);
  /**
   * `?tab`, который стол САМ только что записал, и ключ адреса на момент
   * записи. Навигация роутера идёт в transition, а `setActiveSubPageId` —
   * срочно: один рендер вкладка уже новая, а адрес ещё старый, и эффект
   * «смена ?tab» откатывал бы вкладку назад (мигание и лишняя переподписка
   * строк — в Firestore это лишнее чтение всей вкладки).
   */
  const urlTabRef = useRef<{ value: string; key: string } | null>(null);

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
      permissions.seesAllDesks ||
        (permissions.seesOsDesks && isOsDeskId(pageId)),
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

  const isOwnDesk = Boolean(
    page && permissions.uid && page.responsibleUserId === permissions.uid,
  );
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
  const { subPages, isLoading: subPagesLoading } = useSubPages(
    activeWorkspaceId,
    hasAccess && page ? page.id : null,
  );
  // First visit of a new month: the month autopilot (AppLayout) is about to
  // create/adopt this month's tab and make it default. Hold the initial tab
  // choice until the page doc says it's done, so the desk opens on the new
  // month instead of last month's tab — capped, so a failed write can't
  // leave the desk loading forever.
  const monthKey = useCurrentPeriodKey();
  const periods = usePeriodSettings();
  const awaitingMonthTab = Boolean(
    page &&
    hasAccess &&
    page.autoMonthKey !== monthKey &&
    (hasFullDeskAccess || isOwnDesk) &&
    isMonthlyDesk(page, members),
  );
  const [monthWaitExpired, setMonthWaitExpired] = useState(false);
  useEffect(() => {
    setMonthWaitExpired(false);
    if (!awaitingMonthTab) return;
    const timer = window.setTimeout(() => setMonthWaitExpired(true), 5000);
    return () => window.clearTimeout(timer);
  }, [awaitingMonthTab, pageId]);
  const activeSubPage = subPages.find((s) => s.id === activeSubPageId) ?? null;
  const tabScopeReady =
    tabsReady && appliedDefaultForPageRef.current === pageId;
  const listenMainRows = Boolean(
    hasAccess && page && tabScopeReady && !activeSubPageId,
  );
  const listenSubRows = Boolean(
    hasAccess && page && tabScopeReady && activeSubPageId,
  );
  const {
    rows: pageRows,
    isLoading: pageRowsLoading,
    serverSynced: pageRowsSynced,
    accessPending: pageRowsAccessPending,
    accessDenied: pageRowsAccessDenied,
    readError: pageRowsError,
    retry: retryPageRows,
  } = usePageRows(activeWorkspaceId, listenMainRows && page ? page.id : null);
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
    listenSubRows ? activeSubPageId : null,
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
    const fromUrl = resolveTabRef(tabParam, page, subPages);
    // `?tab` без `?row` на месячном столе — это F5 или закладка, а не ссылка
    // на строку: 1 октября F5 на сентябрьской вкладке открыл бы сентябрь, и
    // новые заказы ушли бы в прошлый месяц. Такую вкладку решает автопилот.
    const urlTabMonth =
      fromUrl ? subPages.find((s) => s.id === fromUrl)?.monthKey : undefined;
    const urlTabStale =
      tabParam !== null &&
      !focusRowId &&
      fromUrl !== undefined &&
      isMonthlyDesk(page, members) &&
      (awaitingMonthTab || (Boolean(urlTabMonth) && urlTabMonth !== monthKey));
    // Вкладка из адреса — это выбор человека (ссылка на строку прошлого
    // месяца): она не ждёт автопилот месяца и не перебивается им.
    if (tabParam !== null && fromUrl !== undefined && !urlTabStale) {
      userPickedTabRef.current = true;
      appliedDefaultForPageRef.current = pageId;
      setActiveSubPageId(fromUrl);
      setTabsReady(true);
      return;
    }
    if (awaitingMonthTab && !monthWaitExpired) return;
    appliedDefaultForPageRef.current = pageId;
    // Память последней вкладки (только этот месяц) — потом умолчание стола.
    const remembered = resolveTabRef(
      readStoredDeskTab(pageId, monthKey),
      page,
      subPages,
    );
    const chosen =
      remembered !== undefined ? remembered : initialSubPageId(page, subPages);
    setActiveSubPageId(chosen);
    setTabsReady(true);
    // Устаревшую вкладку в адресе переписываем актуальной: иначе F5 и
    // «поделиться» снова вели бы на прошлый месяц. Запись помечаем своей —
    // эффект «смена ?tab» не должен вернуть старую вкладку, пока адрес не
    // догнал.
    if (urlTabStale) {
      const value = deskTabParam(chosen);
      urlTabRef.current = { value, key: location.key };
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("tab", value);
          return next;
        },
        { replace: true, state: locationStateRef.current },
      );
    }
  }, [
    pageId,
    page,
    subPages,
    subPagesLoading,
    hasAccess,
    awaitingMonthTab,
    monthWaitExpired,
    tabParam,
    focusRowId,
    members,
    monthKey,
    location.key,
    setSearchParams,
  ]);

  function handleSelectTab(subPageId: string | null) {
    userPickedTabRef.current = true;
    appliedDefaultForPageRef.current =
      pageId ?? appliedDefaultForPageRef.current;
    setActiveSubPageId(subPageId);
    setTabsReady(true);
    if (pageId) storeDeskTab(pageId, subPageId, monthKey);
    // Человек выбрал вкладку сам — недоделанный поиск строки по `?row` не
    // должен перекинуть его обратно, когда ответ базы придёт.
    rowLookupTargetRef.current = null;
    // Вкладка — в адрес (F5 и «поделиться» возвращают на неё), `?row`
    // остаётся: в истории браузера — без новой записи, чипы месяцев жмут
    // часто.
    const value = deskTabParam(subPageId);
    urlTabRef.current = { value, key: location.key };
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", value);
        return next;
      },
      { replace: true, state: location.state },
    );
  }

  // Адрес сменился уже на открытом столе (уведомление о строке в другой
  // вкладке, «Назад» браузера) — переключаемся на вкладку из адреса. После
  // своего клика адрес и вкладка совпадают, так что эффект молчит.
  useEffect(() => {
    const own = urlTabRef.current;
    if (own) {
      // Свою запись ждём: пока ключ адреса прежний, роутер её ещё не
      // применил. Ключ сменился, а `?tab` не наш — адрес поменял кто-то
      // другой («Назад» браузера), и он главнее.
      if (tabParam !== own.value && location.key === own.key) return;
      urlTabRef.current = null;
    }
    if (!tabsReady || !page || tabParam === null) return;
    if (appliedDefaultForPageRef.current !== pageId) return;
    const target = resolveTabRef(tabParam, page, subPages);
    if (target === undefined || target === activeSubPageId) return;
    // В память не пишем: вкладку по ссылке человек не выбирал, и завтра
    // «Мой стол» не должен открываться на прошлом месяце из-за уведомления.
    userPickedTabRef.current = true;
    setActiveSubPageId(target);
  }, [
    tabParam,
    location.key,
    tabsReady,
    page,
    pageId,
    subPages,
    activeSubPageId,
  ]);

  function goBack() {
    if (cameFrom) {
      navigate(cameFrom.to);
      return;
    }
    // `idx` в history.state ставит роутер: 0 — эта запись первая в вкладке,
    // и «назад» ушёл бы с сайта.
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(page?.osDesk ? "/os-desks" : "/desks");
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
  }, [pageId]);

  const rows = activeSubPageId ? subPageRows : pageRows;
  const rowsLoading =
    !tabsReady || (activeSubPageId ? subPageRowsLoading : pageRowsLoading);
  // Строки в Supabase, а права на стол туда ещё не доехали — см. useSyncedTableRows.
  const rowsAccessPending = activeSubPageId
    ? subPageRowsAccessPending
    : pageRowsAccessPending;
  // Права на стол есть, а этого человека в них нет — доступ закрыли.
  const rowsAccessDenied = activeSubPageId
    ? subPageRowsAccessDenied
    : pageRowsAccessDenied;
  // Строки не прочитались (нет прав, нет связи, кончилась квота) — таблица
  // остаётся скелетом, и без этой полосы человек не знает, что случилось.
  const rowsReadError = activeSubPageId ? subPageRowsError : pageRowsError;
  const retryRows = activeSubPageId ? retrySubPageRows : retryPageRows;
  const rowsFromServer =
    tabsReady && (activeSubPageId ? subPageRowsSynced : pageRowsSynced);

  // В «недавние» — только стол, который открылся: строки пришли с сервера.
  // Недоступный стол (экран «Нужно разрешение», отказ политики Supabase —
  // там строки «с сервера» не бывают) в список не попадает.
  useEffect(() => {
    if (!pageId || !profile?.uid || !hasAccess || !rowsFromServer) return;
    recordRecentPage(profile.uid, pageId);
  }, [pageId, profile?.uid, hasAccess, rowsFromServer]);

  // `?row` без `?tab`: строки нет на открытой вкладке — спрашиваем базу, где
  // она, и дописываем вкладку в адрес (дальше сработает эффект смены `?tab`,
  // а фокус строки в DataTable — уже после загрузки её строк). Один раз на
  // ссылку: повторный поиск той же строки ничего не даст.
  //
  // Ответ отменяет только смена ЦЕЛИ (другая строка, другой стол, вкладка
  // уже в адресе), а не перезапуск эффекта: `rows` и `page` — новые объекты
  // на каждом снимке, и отмена по cleanup глушила ответ, а повтор запрещала
  // метка «уже искали» — строка молча не открывалась.
  const rowLookupRef = useRef<string | null>(null);
  const rowLookupTargetRef = useRef<string | null>(null);
  useEffect(() => {
    const target =
      focusRowId && pageId && tabParam === null
        ? `${pageId}:${focusRowId}`
        : null;
    rowLookupTargetRef.current = target;
    if (!target || !focusRowId || !pageId) return;
    if (!tabsReady || !page || !activeWorkspaceId || !hasAccess) return;
    // «Строки нет на вкладке» решаем только по снимку с сервера: кэш или
    // пустота Supabase до подтверждения прав — ещё не ответ, и метку
    // «уже искали» до него не ставим.
    if (rowsLoading || !rowsFromServer) return;
    if (rowLookupRef.current === target) return;
    rowLookupRef.current = target;
    if (rows.some((r) => r.id === focusRowId)) return;
    const notFound = () => {
      if (rowLookupTargetRef.current === target)
        toast.error("Строка не найдена на этом столе");
    };
    void lookupRowTab(activeWorkspaceId, pageId, focusRowId)
      .then((tab) => {
        if (rowLookupTargetRef.current !== target) return;
        if (tab === undefined) {
          notFound();
          return;
        }
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.set("tab", deskTabParam(tab));
            return next;
          },
          { replace: true, state: locationStateRef.current },
        );
      })
      .catch(notFound);
  }, [
    focusRowId,
    tabParam,
    tabsReady,
    page,
    pageId,
    activeWorkspaceId,
    hasAccess,
    rowsLoading,
    rowsFromServer,
    rows,
    setSearchParams,
  ]);

  // Карта столбцов месячной вкладки — её читает ОС, когда ведёт заказ в
  // чужом столе (см. WorkspacePage.osFieldKeys).
  useOsFieldKeysPublisher({
    page: hasAccess ? page : null,
    subPage: activeSubPage,
    canEdit: Boolean(page && permissions.canEditPageData(page)),
  });

  // Ник ОС — он уходит в столбец «Ответственный» стола технаря: по нему
  // считаются заказы ОС, его оценки и право оценивать.
  const myOsNickValue =
    members.find((m) => m.uid === permissions.uid)?.osNickValue ?? "";
  // Стол ОС: заказы этого ОС в столах технарей — один запрос на весь стол.
  const isMyOsDesk = Boolean(
    page?.osDesk && page.responsibleUserId === permissions.uid,
  );
  // Кто смотрит — для замка строк-заказов. Один объект на смену прав, а не
  // новый на каждый рендер: от него зависит `cellLockFor`, а от неё — memo
  // каждой строки таблицы.
  const viewerIsOwner =
    permissions.actsAsOwner;
  const viewerIsTeamLead = permissions.hasRole("teamlead");
  const viewer = useMemo(
    () => ({
      uid: permissions.uid,
      isOwner: viewerIsOwner,
      isTeamLead: viewerIsTeamLead,
    }),
    [permissions.uid, viewerIsOwner, viewerIsTeamLead],
  );
  // «Заказы заводит только ОС»: в столе ТЕХНАРЯ пропадают «Строка» и
  // «Быстрый заказ», а ячейки закрыты замком (Owner не ограничиваем).
  const ordersFromOsOnly = Boolean(
    activeWorkspace?.osManagedDesks &&
    page &&
    !page.osDesk &&
    // Owner разрешил технарю править этот стол самому.
    !page.techEditable &&
    !permissions.actsAsOwner,
  );
  // «Технари заполняют сами» (вкладка Owner «Правка столов»): всем разом
  // (`workspace.techFillsAll`) или этому столу (`page.techEditable`) —
  // строки-заказы ОС технарь тогда тоже правит; базу держит `rows_tech_fills`.
  // Пока база не знает этот режим (SQL 20261001 не вставлен), строки ОС в
  // Supabase заперты — интерфейс их не открывает, иначе правка упала бы.
  const deskModeSupported = useDeskModeSupported(activeWorkspaceId);
  const techFills = Boolean(
    page &&
    !page.osDesk &&
    (activeWorkspace?.techFillsAll || page.techEditable) &&
    deskModeSupported === true,
  );
  const myOrders = useMyOrderRows(
    activeWorkspaceId,
    permissions.uid,
    isMyOsDesk,
  );
  // Заказы технарей с ником ОС сами едут на стол (useOsOrderClaims):
  // открыли свой стол — проверить сразу, забрали заказ — перечитать свои
  // заказы, иначе проход стола не увидит копию нового заказа.
  const refreshMyOrders = myOrders.refresh;
  useEffect(() => {
    if (!isMyOsDesk) return;
    window.dispatchEvent(new Event(OS_CLAIM_KICK_EVENT));
    const onClaimed = () => refreshMyOrders();
    window.addEventListener(OS_CLAIMED_EVENT, onClaimed);
    return () => window.removeEventListener(OS_CLAIMED_EVENT, onClaimed);
  }, [isMyOsDesk, refreshMyOrders]);
  // Свои заказы на «Заказах» со стола — с живыми откликами: выбрать технаря
  // можно прямо в ячейке «Технарь» (OsExchangePicker), не уходя на «Заказы».
  const exchange = useMyExchangeOrders(
    activeWorkspaceId,
    permissions.uid,
    isMyOsDesk,
  );
  // Просьбы технарей к этому ОС («поставьте „Готово“», «удалите») — та же
  // подписка, что счётчик на «Стол ОС» в меню. На строке — метка «Просит: …»
  // в ячейке статуса, решение — в окне (OsRequestDecisionDialog).
  // Owner и Тимлид на ЧУЖОМ столе ОС тоже видят просьбы к этому ОС и решают
  // их (жалоба Nurba 25.09.2026: «зашёл на стол ОС — ничего не вижу»):
  // правило orderRequests пускает руководство читать и решать.
  const leaderSeesOsRequests = Boolean(
    page?.osDesk &&
      !isMyOsDesk &&
      page.responsibleUserId &&
      permissions.canManageUsers,
  );
  const osRequestsUid = isMyOsDesk
    ? permissions.uid
    : leaderSeesOsRequests
      ? (page?.responsibleUserId ?? null)
      : null;
  const osRequests = useOsPendingOrderRequests(
    activeWorkspaceId,
    osRequestsUid,
    isMyOsDesk || leaderSeesOsRequests,
  );
  // Заказы этого ОС у технарей — для руководства отдельным чтением (свой
  // список `myOrders` у хозяина стола держит проход выдачи, его не трогаем).
  const viewedOsOrders = useMyOrderRows(
    activeWorkspaceId,
    leaderSeesOsRequests ? (page?.responsibleUserId ?? null) : null,
    leaderSeesOsRequests,
  );
  const requestMirrors = isMyOsDesk ? myOrders.rows : viewedOsOrders.rows;
  const refreshRequestMirrors = isMyOsDesk
    ? myOrders.refresh
    : viewedOsOrders.refresh;
  const osRequestByRow = useMemo(() => {
    const map = new Map<string, OrderRequest>();
    if (!osRequestsUid) return map;
    for (const request of osRequests.requests) {
      // Строку ОС ищем через строку-заказ ОС у технаря; запрос пишет технарь.
      const mirror = findRequestMirror(
        request,
        requestMirrors,
        osRequestsUid,
      );
      const rowId = mirror?.srcRowId || request.srcRowId;
      if (rowId && !map.has(rowId)) map.set(rowId, request);
    }
    return map;
  }, [osRequests.requests, requestMirrors, osRequestsUid]);
  const [decideRequestId, setDecideRequestId] = useState<string | null>(null);
  const [pickOrderId, setPickOrderId] = useState<string | null>(null);
  const pickOrder = pickOrderId
    ? (exchange.byId.get(pickOrderId) ?? null)
    : null;
  // Уведомление «готов взять заказ» ведёт сюда с `?pick=<заказ>` — сразу
  // открываем выбор. Параметр снимаем: F5 не должен открывать окно снова.
  const pickParam = searchParams.get("pick");
  useEffect(() => {
    if (!pickParam || !exchange.loaded) return;
    if (exchange.byId.has(pickParam)) setPickOrderId(pickParam);
    else toast.info("Этот заказ уже отдан или снят с «Заказов»");
    const next = new URLSearchParams(searchParams);
    next.delete("pick");
    setSearchParams(next, { replace: true, state: locationStateRef.current });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickParam, exchange.loaded]);
  // Ключи ячеек открытой таблицы стола ОС: столбец мог завести сам ОС, и
  // фиксированные `status`/`technician` тогда смотрели бы мимо.
  const osTableColumns = activeSubPage ? activeSubPage.columns : page?.columns;
  const osKeys = useMemo(
    () => resolveOsDeskKeys(osTableColumns),
    [osTableColumns],
  );
  const osTechPickerKeys = useMemo(
    () => [osKeys.technician],
    [osKeys.technician],
  );
  // Касса ОС: способ оплаты у «Цены» и «Апсейла», «Итого» только для чтения.
  const isOsDeskPage = Boolean(page?.osDesk);
  // Добавки в ячейках стола ОС: способ оплаты у «Цены» и «Апсейла» (у
  // апсейла ещё и его дата) и столбец «Даты» — получен / выдан.
  const osAddonKeys = useMemo(
    () => [osKeys.price, osKeys.upsell, osKeys.dates],
    [osKeys.price, osKeys.upsell, osKeys.dates],
  );
  const osLockedKeys = useMemo(
    () =>
      isOsDeskPage
        ? {
            [osKeys.total]:
              "«Итого» считает стол сам: цена и апсейл за вычетом комиссии способа оплаты",
            [osKeys.dates]:
              "Даты ставятся кнопками в ячейке: пунктир — рекомендуемая дата, нажмите, чтобы поставить; поставленную — нажмите, чтобы поменять",
          }
        : undefined,
    [isOsDeskPage, osKeys.total, osKeys.dates],
  );
  const paymentMethods = useMemo(
    () => paymentMethodsOf(activeWorkspace),
    [activeWorkspace],
  );
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  /**
   * Даты заказа (только дата) для столбца «Даты», апсейла и карточки строки:
   * поставленные ОС (`osReceivedOn`/`osIssuedOn`/`{апсейл}__on`) и
   * рекомендуемые для кнопки — дата строки, выдача копии технарю
   * (`osIssuedAt`, у выданных раньше — когда завели копию), дата апсейла.
   * Пока заказ на «Заказах» — «ждёт откликов» / «едет».
   */
  function osSlotsOf(row: PageRow) {
    const mirror = myOrders.bySource.get(row.id);
    return osDateSlots(row, {
      upsellKey: osKeys.upsell,
      mirrorCreatedAt: mirror?.createdAt ?? null,
    });
  }
  function osDatesOf(row: PageRow): OsDatesInfo {
    const slots = osSlotsOf(row);
    const onExchange = row.orderId ? exchange.byRow.get(row.id) : undefined;
    return {
      received: slots.received,
      issued: slots.issued,
      exchange:
        onExchange &&
        (onExchange.status === "open" || onExchange.status === "assigned")
          ? { status: onExchange.status }
          : null,
    };
  }
  /** ОС ставит дату сам (кнопкой «рекомендуем» или выбором дня). */
  async function setOsRowDate(
    row: PageRow,
    slot: OsDateSlot,
    value: number | null,
  ) {
    if (!activeWorkspaceId || !page) return;
    const patch = { [slot.key]: value === null ? null : String(value) };
    try {
      if (activeSubPageId)
        await updateSubPageRowCellsBulk(
          activeWorkspaceId,
          page.id,
          activeSubPageId,
          row.id,
          patch,
        );
      else await updateRowCellsBulk(activeWorkspaceId, page.id, row.id, patch);
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось поставить дату"));
    }
  }
  // Здесь, а не `canEditData` ниже: тот объявлен после ранних возвратов.
  const osDatesEditable = Boolean(page && permissions.canEditPageData(page));
  const setOsDate = osDatesEditable
    ? (row: PageRow) => (slot: OsDateSlot, value: number | null) =>
        void setOsRowDate(row, slot, value)
    : null;
  // Что ещё, кроме самой строки, меняет «Даты»: копии у технарей (дата
  // заведения — запасная «выдан») и заказы на «Заказах». Строки таблицы
  // перерисовываются только при смене этой подписи (TableRow сравнивает пропсы).
  const osDatesVersion = isOsDeskPage
    ? [
        ...[...exchange.byRow].map(([id, o]) => `${id}:${o.status}`),
        ...[...myOrders.bySource].map(([id, m]) => `${id}@${m.createdAt ?? 0}`),
      ]
        .sort()
        .join("|")
    : "";

  // Стол ОС выдаёт заказы сам: заполнил строку, выбрал технаря — заказ у
  // него. Тот же проход везёт статус в обе стороны (см. хук).
  /**
   * Строка стола ОС, которой выбирают технаря (полноэкранный список), и
   * зачем: `give` — выбор и есть выдача, `change` — сменить технаря (заказ
   * переедет).
   */
  const [techPick, setTechPick] = useState<{
    rowId: string;
    mode: "give" | "change";
  } | null>(null);
  const techPickRow = techPick
    ? (rows.find((r) => r.id === techPick.rowId) ?? null)
    : null;
  const [techPickBusy, setTechPickBusy] = useState(false);
  /** «Только наметить технаря — отдам позже»: выбор пишет один ник. */
  const [techPlanOnly, setTechPlanOnly] = useState(false);
  function openTechPicker(rowId: string, mode: "give" | "change") {
    setTechPlanOnly(false);
    setTechPick({ rowId, mode });
  }
  /** Заказ строки уже у технаря: есть копия или её адрес на строке. */
  const rowIssued = (row: PageRow) =>
    osRowIssued(row, myOrders.bySource.get(row.id) ?? null);
  async function setRowTechnician(nick: string, name = "") {
    if (!activeWorkspaceId || !page || !techPickRow) return;
    const row = techPickRow;
    const client = cellStr(row, osKeys.client) || "Заказ";
    const issued = rowIssued(row);
    const onApproval = isApprovalStatusValue(
      cellStr(row, osKeys.status),
      osStatusOptions,
    );
    // Выбрать технаря невыданному заказу на «Утверждении» — это и есть
    // выдача (решение Nurba 24.09.2026): ник и «В работе» ОДНОЙ записью, как
    // «Одному технарю» в «Как выдать?». Раньше писался только ник, и ОС
    // искал вторую кнопку «В работу». «Только наметить» — по-старому, ник.
    // Сам проход заказ на «Утверждении» по-прежнему не отдаёт. Строка без
    // клиента — ещё не заказ: ей только ник.
    const isOrder = cellStr(row, osKeys.client) !== "";
    const cells: Record<string, string> = { [osKeys.technician]: nick };
    if (nick && isOrder && onApproval && !issued && !techPlanOnly) {
      const inProgress = findInProgressStatusOption([...osStatusOptions])?.value;
      if (inProgress) cells[osKeys.status] = inProgress;
    }
    setTechPickBusy(true);
    try {
      await sbPatchRow(
        activeWorkspaceId,
        page.id,
        activeSubPageId,
        row.id,
        { cells },
      );
      setTechPick(null);
      const who = name || "технарю";
      if (!nick) {
        if (issued)
          toast.success(`${client}: технарь снят`, {
            description: "Заказ уберётся из его стола через секунду.",
          });
      } else if (cells[osKeys.status]) {
        toast.success(`${client} → ${who}`, {
          description:
            "Статус — «В работе», заказ уедет в его стол через секунду.",
        });
      } else if (issued) {
        toast.success(`${client} → ${who}`, {
          description:
            "Заказ переедет: у прежнего технаря уберётся, у нового появится.",
        });
      } else if (!onApproval) {
        toast.success(`${client} → ${who}`, {
          description: "Заказ уедет в его стол через секунду.",
        });
      }
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось выбрать технаря"));
    } finally {
      setTechPickBusy(false);
    }
  }
  const osDispatch = useOsDeskDispatch({
    workspaceId: activeWorkspaceId,
    enabled: isMyOsDesk && hasAccess,
    pageId: page?.id ?? "",
    subPageId: activeSubPageId,
    rows,
    columns: osTableColumns,
    orders: myOrders,
    osUid: permissions.uid,
    osNickValue: myOsNickValue,
    rowsFromServer,
    exchange,
  });

  // «Итого» стола ОС догоняет цену, апсейл и способы оплаты — кто бы их ни
  // поменял. Пишет сессия того, кто вправе править стол (сам ОС или Owner).
  useOsTotalsKeeper({
    workspaceId: activeWorkspaceId,
    pageId: page?.id ?? "",
    subPageId: activeSubPageId,
    rows,
    columns: osTableColumns,
    keys: osKeys,
    enabled: Boolean(
      isOsDeskPage && hasAccess && page && permissions.canEditPageData(page),
    ),
    rowsFromServer,
  });

  // Ячейка «Технарь» стола ОС — ОДНО состояние на таблицу, «Карточки» и
  // карточку строки (utils/osTechCell.ts): кто технарь и одно следующее
  // действие. Жалоба Nurba 24.09.2026: «непонятно, кто технарь и что
  // нажимать» — было пять входов с разными словами.
  const [osActionBusy, setOsActionBusy] = useState<Set<string>>(
    () => new Set(),
  );
  const osStatusOptions = ensureApprovalStatus(
    ensureDoneStatus(activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS),
  );
  // Метка «статус не совпал» показывается не сразу после правки, а когда
  // проход уже должен был довезти статус (8 с). Раньше ради неё раз в 10 с
  // перерисовывалась вся страница вместе с таблицей; теперь таблица сама
  // пересчитывает ТОЛЬКО метки (`cellAction.tickMs`, см. DataTable).
  const OS_CELL_ACTION_TICK_MS = 10_000;
  const cellStr = (row: PageRow, key: string | null | undefined) => {
    const v = key ? row.cells[key] : null;
    return v === null || v === undefined ? "" : String(v).trim();
  };
  const techNickOptions = activeWorkspace?.techNickOptions;
  // Кто за ником — один расчёт на ник, пока не сменились люди и ники
  // (ячеек на столе сотни, людей — десятки).
  const techIdentityOf = useMemo(() => {
    const cache = new Map<string, TechIdentity | null>();
    return (nick: string): TechIdentity | null => {
      if (!cache.has(nick))
        cache.set(nick, resolveTechIdentity(nick, members, techNickOptions));
      return cache.get(nick) ?? null;
    };
  }, [members, techNickOptions]);
  /** Состояние ячейки «Технарь» строки своего стола ОС. */
  function osTechStateOf(row: PageRow): OsTechCellState | null {
    const nick = cellStr(row, osKeys.technician);
    const order = exchange.byRow.get(row.id);
    return osTechCellState({
      row,
      keys: osKeys,
      statusOptions: osStatusOptions,
      mirror: myOrders.bySource.get(row.id) ?? null,
      mirrorsLoading: myOrders.loading,
      problem: osDispatch.problems[row.id] ?? null,
      exchange: order
        ? {
            id: order.id,
            status: order.status,
            claims: claimCount(order),
            assignedName: order.assignedName,
          }
        : null,
      exchangeLoaded: exchange.loaded,
      identity: nick ? techIdentityOf(nick) : null,
      assignedIdentity:
        order?.status === "assigned"
          ? techIdentityOfUid(
              order.assignedUid,
              order.assignedName,
              members,
              techNickOptions,
            )
          : null,
      issuedAt: slotShown(osSlotsOf(row).issued),
      now: Date.now(),
    });
  }
  /** Чип действия в ячейке — из того же состояния. */
  /** Метка в ячейке статуса стола ОС: технарь просит сменить статус / удалить. */
  function osRequestCellView(row: PageRow): CellActionView | null {
    const request = osRequestByRow.get(row.id);
    if (!request) return null;
    // Только значок в конце ячейки (Nurba 25.09.2026: подпись «Просит: Ждём
    // оплату» закрывала весь статус); что просят — во всплывашке и в окне.
    return {
      kind: `req:${request.id}`,
      label: "",
      title: `${(() => {
        const tech = members.find((m) => m.uid === request.techUid);
        return tech ? displayNameOf(tech) : "Технарь";
      })()} просит ${request.kind === "delete" ? "удалить заказ" : `статус «${request.statusLabel ?? request.status}»`}. Нажмите, чтобы решить`,
      tone: "warning",
      icon: "hand",
    };
  }
  function osCellView(row: PageRow): CellActionView | null {
    const state = osTechStateOf(row);
    if (!state?.chip) return null;
    return {
      kind: state.kind,
      label: state.chip.label,
      title: state.title,
      tone: state.chip.tone,
      icon: state.chip.icon ?? undefined,
      passive: state.chip.passive,
      busy: osActionBusy.has(row.id),
    };
  }
  /**
   * Своя отрисовка ячеек стола ОС: в «Технаре» — кто (бейдж: аватар, ник,
   * имя) или что (не выдан, ждём отклики); у статуса «Утверждение» —
   * подсказка, что это значит (нигде не объяснялось).
   */
  function osCellDisplay(row: PageRow, colKey: string): React.ReactNode | undefined {
    if (colKey === osKeys.status) {
      const status = cellStr(row, osKeys.status);
      if (!status || !isApprovalStatusValue(status, osStatusOptions))
        return undefined;
      return (
        <span
          className="flex min-w-0"
          title="Утверждение — заказ ещё не выдан. Выдайте его в столбце «Технарь»"
        >
          <StatusBadge
            value={status}
            options={osStatusOptions}
            variant="plain"
            muteDone
          />
        </span>
      );
    }
    if (colKey !== osKeys.technician) return undefined;
    const state = isMyOsDesk ? osTechStateOf(row) : null;
    if (state) return <OsTechLeftView left={state.left} title={state.title} />;
    const nick = cellStr(row, osKeys.technician);
    return nick ? <TechBadge identity={techIdentityOf(nick)} /> : undefined;
  }
  // От чего ещё, кроме самой строки, зависит эта отрисовка: люди, фото и
  // ники, заказы на «Заказах» (отклики, кому отдан), копии у технарей.
  const osCellDisplayVersion = isOsDeskPage
    ? [
        techIdentitySignature(members, techNickOptions),
        osStatusOptions.map((o) => `${o.value}:${o.label}:${o.color}`).join("|"),
        isMyOsDesk
          ? [...exchange.byRow]
              .map(
                ([id, o]) =>
                  `${id}:${o.status}:${claimCount(o)}:${o.assignedUid ?? ""}:${o.assignedName ?? ""}`,
              )
              .sort()
              .join("|")
          : "",
        isMyOsDesk
          ? // Левая часть от статуса копии не зависит (его показывает чип),
            // поэтому `myOrders.loading` сюда не входит: перечитывание своих
            // заказов после каждой выдачи перерисовывало бы все строки.
            `${exchange.loaded ? 1 : 0}:${[...myOrders.bySource.keys()].sort().join(",")}`
          : "",
      ].join("#")
    : "";
  const osDisplayKeys = useMemo(
    () => [osKeys.technician, osKeys.status],
    [osKeys.technician, osKeys.status],
  );
  /** «Карточки» на телефоне: под карточкой — технарь и тот же чип. */
  function osCardFooter(row: PageRow) {
    const state = osTechStateOf(row);
    if (!state) return null;
    const view = osCellView(row);
    return (
      <>
        <span className="flex min-w-0 flex-1">
          <OsTechLeftView left={state.left} title={state.title} />
        </span>
        {view ? (
          <CellActionButton
            view={view}
            inline
            coarsePointer
            onRun={() => void runOsCellAction(row)}
          />
        ) : null}
      </>
    );
  }
  /** Выбор способа оплаты у цены или апсейла: id, снимок комиссии и новое «Итого» — одной записью. */
  async function pickPayment(
    row: PageRow,
    colKey: string,
    method: PaymentMethod | null,
  ) {
    if (!activeWorkspaceId || !page) return;
    const patch: Record<string, string | number | null> = paymentPatch(
      colKey,
      method,
    );
    if (osTableColumns?.some((c) => c.key === osKeys.total)) {
      const total = osRowTotal({ cells: { ...row.cells, ...patch } }, osKeys);
      patch[osKeys.total] = total === null ? null : String(total);
    }
    try {
      if (activeSubPageId)
        await updateSubPageRowCellsBulk(
          activeWorkspaceId,
          page.id,
          activeSubPageId,
          row.id,
          patch,
        );
      else await updateRowCellsBulk(activeWorkspaceId, page.id, row.id, patch);
    } catch (error) {
      toast.error(
        firestoreErrorText(error, "Не удалось сохранить способ оплаты"),
      );
    }
  }
  /**
   * Сумма цены или апсейла из «Кассы» карточки строки (просьба Nurba
   * 25.09.2026: «тут надо, чтобы можно было изменять суммы»). Число
   * канонизируется, как в ячейке («1 500,50» → «1500.5»), «Итого» пересчитано
   * той же записью; дату апсейла ставит useOsTotalsKeeper, как при правке в
   * таблице.
   */
  async function setOsAmount(row: PageRow, colKey: string, raw: string) {
    if (!activeWorkspaceId || !page) return;
    const value = raw.trim() === "" ? "" : normalizeNumericInput(raw);
    if (value !== "" && parseLooseNumber(value) === null) {
      toast.error("Нужна сумма числом");
      return;
    }
    if (String(row.cells[colKey] ?? "") === value) return;
    const patch: Record<string, string | number | null> = { [colKey]: value };
    if (osTableColumns?.some((c) => c.key === osKeys.total)) {
      const total = osRowTotal({ cells: { ...row.cells, ...patch } }, osKeys);
      patch[osKeys.total] = total === null ? null : String(total);
    }
    try {
      if (activeSubPageId)
        await updateSubPageRowCellsBulk(
          activeWorkspaceId,
          page.id,
          activeSubPageId,
          row.id,
          patch,
        );
      else await updateRowCellsBulk(activeWorkspaceId, page.id, row.id, patch);
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось сохранить сумму"));
    }
  }
  const isRealOwner =
    permissions.actsAsOwner;

  /** «Выдать…» из ячейки или карточки — вопрос открыт кнопкой, а не статусом. */
  const [choiceFromButton, setChoiceFromButton] = useState<string | null>(
    null,
  );
  function openOsChoice(rowId: string) {
    setChoiceFromButton(rowId);
    osDispatch.openChoice(rowId);
  }
  /** Выдать заново тому же технарю (копию у него удалили). */
  async function reissueOsRow(row: PageRow) {
    if (!activeWorkspaceId || !page) return;
    const client = cellStr(row, osKeys.client) || "Заказ";
    try {
      const { techName } = await pushOsRowToTech({
        workspaceId: activeWorkspaceId,
        osUid: permissions.uid,
        osNickValue: myOsNickValue,
        row,
        pageId: page.id,
        subPageId: activeSubPageId,
        keys: osKeys,
        mirror: myOrders.bySource.get(row.id) ?? null,
        pages: workspaceDesks,
        members,
        statusOptions: osStatusOptions,
      });
      myOrders.refresh();
      toast.success(`${client} → ${techName}`, {
        description: "Заказ снова в его столе.",
      });
    } catch (error) {
      toast.error(
        firestoreErrorText(
          error,
          error instanceof Error ? error.message : "Не удалось выдать заказ",
        ),
      );
    }
  }
  /**
   * Одно действие ячейки «Технарь» (чип, нажатие на ячейку, главная кнопка
   * карточки). Решает `kind` состояния, а не подпись метки: раньше ветки
   * сравнивали тексты «Не доехал» / «Статус не совпал» и ломались от правки
   * слов.
   */
  async function runOsTechAction(row: PageRow, action: OsTechAction) {
    if (!activeWorkspaceId || !page) return;
    const client = cellStr(row, osKeys.client) || "Заказ";
    const state = osTechStateOf(row);
    switch (action) {
      case "none":
        return;
      case "choice":
        openOsChoice(row.id);
        return;
      case "picker-give":
        openTechPicker(row.id, "give");
        return;
      case "picker-change":
        openTechPicker(row.id, "change");
        return;
      case "exchange-picker": {
        const id = state?.exchangeId ?? exchange.byRow.get(row.id)?.id;
        if (id && exchange.byId.has(id)) setPickOrderId(id);
        else navigate("/orders");
        return;
      }
      case "handoff-toast":
        toast.info(`${client}: заказ едет к технарю`, {
          description:
            "Ник технаря появится в строке сам, как только заказ доедет.",
        });
        return;
      case "loading-toast":
        toast.info(`${client}: секунду`, { description: state?.title });
        return;
      case "problem-toast": {
        const problem = osDispatch.problems[row.id] ?? state?.title ?? "";
        // Копию у технаря удалили (или заказ вернули ему на «Правке столов») —
        // тому же технарю заказ сам больше не уходит. После удаления выдать
        // заново можно здесь; после «Вернуть» строка заказа лежит у технаря,
        // и новая копия была бы дублем — тогда кнопки нет, только объяснение.
        const lost = problem === OS_DEAD_LINK_PROBLEM;
        let returned = false;
        if (lost) {
          const techUid = techUidByNick(members, cellStr(row, osKeys.technician));
          if (techUid) {
            returned = await returnedRowOnTechDesk({
              workspaceId: activeWorkspaceId,
              row,
              techUid,
              pages: workspaceDesks,
            }).catch(() => false);
          }
        }
        toast.error(`${client}: заказ не доходит до технаря`, {
          description: returned ? OS_RETURNED_REISSUE_ERROR : problem,
          action:
            lost && !returned
              ? { label: "Выдать заново", onClick: () => void reissueOsRow(row) }
              : undefined,
        });
        return;
      }
      case "give":
      case "push-status":
        break;
    }
    setOsActionBusy((prev) => new Set(prev).add(row.id));
    try {
      if (action === "push-status") {
        const mirror = myOrders.bySource.get(row.id) ?? null;
        if (!mirror?.statusKey || !mirror.deskPageId)
          throw new Error("Копия заказа у технаря ещё не прочитана");
        await sbPatchRow(
          activeWorkspaceId,
          mirror.deskPageId,
          mirror.tabId || null,
          mirror.id,
          {
            cells: { [mirror.statusKey]: cellStr(row, osKeys.status) },
          },
        );
        myOrders.refresh();
        toast.success(`${client}: статус отправлен технарю`);
      } else {
        const inProgress = findInProgressStatusOption([
          ...osStatusOptions,
        ])?.value;
        if (!inProgress) throw new Error("В списке статусов нет «В работе»");
        await sbPatchRow(activeWorkspaceId, page.id, activeSubPageId, row.id, {
          cells: { [osKeys.status]: inProgress },
        });
        const who =
          state?.left.type === "badge"
            ? techShortName(state.left.identity)
            : "технарю";
        toast.success(`${client} → ${who}`, {
          description:
            "Статус — «В работе», заказ уедет в его стол через секунду.",
        });
      }
    } catch (error) {
      toast.error(
        firestoreErrorText(
          error,
          error instanceof Error ? error.message : "Не удалось отдать заказ",
        ),
      );
    } finally {
      setOsActionBusy((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
    }
  }
  /** Чип в ячейке «Технарь». */
  async function runOsCellAction(row: PageRow) {
    const state = osTechStateOf(row);
    if (state) await runOsTechAction(row, state.chipAction);
  }
  /** Нажатие (или Enter) на саму ячейку «Технарь». */
  function openOsTechCell(row: PageRow) {
    const state = osTechStateOf(row);
    if (state) {
      void runOsTechAction(row, state.bodyAction);
      return;
    }
    // Строка ещё не заказ (нет клиента) — просто выбрать технаря.
    openTechPicker(row.id, cellStr(row, osKeys.technician) ? "change" : "give");
  }
  /** Заголовок группы «Утверждение» — «не выданы». */
  const osGroupHint = (label: string, column: { type: string } | null) =>
    column?.type === "status" && isApprovalOption({ value: "", label })
      ? "не выданы"
      : null;
  // Подсказка «как выдать заказ» под шапкой своего стола ОС.
  const [osGuideHidden, setOsGuideHidden] = useState(osDeskGuideDismissed);

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

  // Вкладка месяца стола ОС (октябрь и дальше) — те же недостающие столбцы:
  // вкладку могли завести до «Итого», а столбцы у вкладки свои.
  const osTabColumnsRan = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (
      !page?.osDesk ||
      !activeSubPage ||
      !hasAccess ||
      !permissions.canManagePage(page)
    )
      return;
    if (osTabColumnsRan.current.has(activeSubPage.id)) return;
    const next = missingOsDeskColumns(activeSubPage.columns ?? []);
    osTabColumnsRan.current.add(activeSubPage.id);
    if (!next || !activeSubPage.columns?.length) return;
    void updateSubPageColumns(
      page.workspaceId,
      page.id,
      activeSubPage.id,
      next,
    ).catch((err) =>
      console.error("Не удалось дописать столбцы вкладке стола ОС:", err),
    );
  }, [page, activeSubPage, hasAccess, permissions]);

  // Retrofit: pages created before "Цена" / "Диск" became standard columns
  // don't have them. If an Owner/Admin opens such a page, silently add
  // once. Chained so both writes see the latest column list. Never wipes cells.
  const standardColumnMigrationRan = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!page || !hasAccess || !permissions.canManagePage(page)) return;
    if (standardColumnMigrationRan.current.has(page.id)) return;
    // Стол ОС: дописываем столбец «Статус» (у заведённых до того, как статус
    // переехал сюда, его нет) и называем вкладку месяцем — она же сама уходит
    // в следующий (см. osDeskService).
    if (page.osDesk) {
      standardColumnMigrationRan.current.add(page.id);
      void (async () => {
        try {
          // «Статус» и «Итого» (касса) — у столов, заведённых раньше них.
          await ensureOsDeskColumns(page.workspaceId, page.id, page.columns);
          await ensureOsDeskMonth(page, permissions.uid);
        } catch (err) {
          console.error("Не удалось подготовить стол ОС:", err);
        }
      })();
      return;
    }
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

  // Стол для таблицы: у месячной вкладки — со столбцами вкладки. Один объект
  // на смену стола/столбцов, а не новый на каждый рендер страницы.
  const activeSubColumns = activeSubPage?.columns;
  const tablePage = useMemo(
    () =>
      page && activeSubColumns ? { ...page, columns: activeSubColumns } : page,
    [page, activeSubColumns],
  );

  // Просьба к ОС сменить статус заказа, который он ведёт (просьба Nurba
  // 25.09.2026): кнопка «Готово?» в ячейке статуса у того, за чьим столом
  // заказ, — технаря и Owner за своим столом. «Готово» — первым.
  const askOsEnabled = Boolean(
    page &&
      !page.osDesk &&
      activeWorkspaceId &&
      permissions.uid &&
      page.responsibleUserId === permissions.uid,
  );
  const myOrderRequests = useMyPendingOrderRequests(
    activeWorkspaceId,
    permissions.uid,
    askOsEnabled,
  );
  const askStatusColumn = useMemo(
    () => tablePage?.columns?.find((c) => c.type === "status") ?? null,
    [tablePage],
  );
  const askStatusOptions = useMemo(
    () =>
      askStatusColumn
        ? getColumnOptions(askStatusColumn, activeWorkspace)
        : [],
    [askStatusColumn, activeWorkspace],
  );
  const [statusRequestRowId, setStatusRequestRowId] = useState<string | null>(
    null,
  );
  const askDoneValue = findDoneStatusOption(askStatusOptions)?.value ?? null;
  function canAskOs(row: PageRow): boolean {
    return Boolean(
      askOsEnabled &&
        row.osUid &&
        row.osUid !== permissions.uid &&
        row.srcPageId &&
        row.srcRowId,
    );
  }
  function pendingRequestOf(row: PageRow) {
    if (!page) return null;
    return (
      myOrderRequests.get(orderRequestId(row.deskPageId || page.id, row.id)) ??
      null
    );
  }
  function askOsCellView(row: PageRow): CellActionView | null {
    if (!canAskOs(row) || !askStatusColumn) return null;
    const current = String(
      row.cells[row.statusKey || askStatusColumn.key] ?? "",
    );
    const pending = pendingRequestOf(row);
    // ОС уже поставил то, о чём просили, — метка своё отжила.
    if (pending && pending.kind === "status" && pending.status !== current) {
      return {
        kind: "req-pending",
        // Значок без подписи: подпись закрывала сам статус в ячейке.
        label: "",
        title: `Вы попросили ОС поставить «${pending.statusLabel ?? pending.status}». Нажмите, чтобы отозвать`,
        tone: "warning",
        icon: "hand",
      };
    }
    if (pending && pending.kind === "delete") {
      return {
        kind: "req-pending",
        label: "",
        title: "Вы попросили ОС удалить заказ",
        tone: "warning",
        icon: "hand",
      };
    }
    if (askDoneValue && current === askDoneValue) return null;
    return {
      kind: "req",
      label: "Готово?",
      title: "Заказ ведёт ОС. Попросить его поставить «Готово» или другой статус",
      tone: "neutral",
      icon: "hand",
    };
  }

  // Диагностика `?diag=table` (utils/tableDiag.ts): что сменилось на рендере.
  useTableDiagWatch("desk", {
    pageId,
    page,
    tablePage,
    subPages,
    activeSubPageId,
    tabParam,
    locationKey: location.key,
    hasAccess,
    tabsReady,
    rowsLoading,
    rowsFromServer,
    rows,
    rowsAccessPending,
    rowsAccessDenied,
    rowsReadError,
    isResolved: permissions.isResolved,
    permissions,
    role: permissions.role,
    members,
    activeWorkspace,
    ordersFromOsOnly,
    techFills,
    canEditData: page ? permissions.canEditPageData(page) : null,
    myOrderRequests,
  });

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
            <div
              key={i}
              className="flex items-center gap-3 border-t border-border/50 px-4 py-3 first:border-t-0"
            >
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
      <AccessDenied
        title="Вы не участник этого workspace"
        reason="Попросите владельца добавить вас — после этого стол откроется без перезагрузки."
      />
    );
  }

  // 3. Resolved and a member, but this page id is not in the workspace list.
  //    Pages are listed for every member (covers); missing here means deleted
  //    or a load miss — not "hidden desk". Own desk is found by id above.
  if (!page) {
    return (
      <AccessDenied
        title="Стол недоступен"
        reason="Он удалён, либо у вас нет к нему доступа."
        hint="Обратитесь к Owner workspace или к ответственному за стол."
        backTo={cameFrom ?? { to: "/desks", label: "Столы" }}
      />
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
            <div
              key={i}
              className="flex items-center gap-3 border-t border-border/50 px-4 py-3 first:border-t-0"
            >
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
      <AccessDenied
        title="Таблицы закрыты"
        reason="Тимлид ведёт людей и доступы, а не заказы: таблицы столов открываются, только если у него есть ещё роль «Технарь»."
        hint={`Доступы к «${page.name}» настраиваются в «Пользователях».`}
        backTo={cameFrom ?? { to: "/users", label: "Пользователи" }}
      />
    );
  }

  if (!hasAccess) {
    const toUid =
      page.responsibleUserId ||
      members.find((m) => m.role === "owner")?.uid ||
      "";
    const hidden = Boolean(page.hiddenByResponsible);
    return (
      <AccessDenied
        title={hidden ? "Стол скрыт" : "Нужно разрешение"}
        reason={
          hidden
            ? `«${page.name}» можно смотреть после разрешения ответственного.`
            : `Чтобы открыть «${page.name}», запросите просмотр у ответственного.`
        }
        hint="Данные листа не открываются."
        backTo={cameFrom ?? { to: "/desks", label: "Столы" }}
      >
        {toUid && toUid !== permissions.uid ? (
          <div className="mx-auto w-full max-w-xs">
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
      </AccessDenied>
    );
  }

  const canEditData = permissions.canEditPageData(page);
  const isResponsible = permissions.isResponsibleForPage(page);
  // Счётчик у «Доступ к столу» в меню ⋯: сколько запросов на просмотр ждут
  // именно меня по этому столу.
  const pendingDeskRequests = requests.filter(
    (r) =>
      r.pageId === page.id &&
      r.status === "pending" &&
      r.toUid === profile?.uid,
  );
  const responsibleMember =
    members.find((m) => m.uid === page.responsibleUserId) ?? null;
  // Стол ОС принадлежит своему ОС: Тимлид смотрит его, но ответственного не
  // меняет и доступ не раздаёт (правила тоже не дают переназначить).
  const canOpenAccess =
    permissions.canManagePage(page) ||
    (permissions.canAssignResponsible && !page.osDesk);
  const canRetireThisDesk =
    permissions.canRetireDesks &&
    (!page.osDesk || permissions.hasFullDeskAccess);
  // Personal Space is visible only to whoever is actually responsible for
  // THIS page (or explicitly whitelisted) — being a Manager elsewhere in the
  // workspace does not grant it. Owner keeps oversight, matching how every
  // other "responsible person" page-scoped feature in this app works.
  const canUsePersonalSpace =
    permissions.role === "owner" ||
    isResponsible ||
    Boolean(page.personalZoneAllowedUsers?.includes(permissions.uid));

  const responsibleWorksAsTechnician = Boolean(
    page?.responsibleUserId &&
    worksAsTechnician(members.find((m) => m.uid === page.responsibleUserId)),
  );

  async function handleToggleTechnicianDesk(next: boolean) {
    if (!page) return;
    try {
      await setPageTechnicianDesk(page.workspaceId, page.id, next);
      toast.success(
        next
          ? "Это стол технаря: вкладка месяца и строка на «Технари»"
          : "Стол больше не считается столом технаря",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Не удалось изменить стол",
      );
    }
  }

  async function handleToggleVisibility() {
    if (!page) return;
    const willShow = Boolean(page.hiddenByResponsible);
    try {
      const allActiveMemberUids = members
        .filter((m) => m.status === "active")
        .map((m) => m.uid);
      await togglePageVisibility(
        page.workspaceId,
        page.id,
        willShow,
        allActiveMemberUids,
        page.responsibleUserId,
      );
      toast.success(
        willShow
          ? "Страница видна всем — доступ на просмотр (без редактирования)"
          : "Доступ убран у всех, кроме вас и Owner",
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Не удалось изменить видимость",
      );
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {isMyOsDesk ? (
        <OsExchangePicker
          order={pickOrder}
          onClose={() => setPickOrderId(null)}
        />
      ) : null}
      {isMyOsDesk
        ? (() => {
            const row = techPickRow;
            const client = row ? cellStr(row, osKeys.client) || "заказа" : "";
            const nick = row ? cellStr(row, osKeys.technician) : "";
            // «Только наметить» — только у невыданного заказа на «Утверждении»:
            // остальным выбор технаря и так ничего не выдаёт сверх ника.
            const canPlan = Boolean(
              row &&
              cellStr(row, osKeys.client) &&
              !rowIssued(row) &&
              isApprovalStatusValue(cellStr(row, osKeys.status), osStatusOptions),
            );
            const planning = canPlan && techPlanOnly;
            const change = techPick?.mode === "change";
            const current = nick ? techShortName(techIdentityOf(nick), "") : "";
            return (
              <TechPickerSheet
                open={Boolean(row)}
                mode={change ? "change" : "give"}
                title={
                  planning
                    ? `Наметить технаря для «${client}»`
                    : change
                      ? `Сменить технаря для «${client}»`
                      : `Кому отдать «${client}»?`
                }
                description={
                  planning
                    ? "Заказ останется на «Утверждении» — отдадите позже кнопкой «Отдать» в столбце «Технарь»."
                    : change
                      ? `${current ? `Сейчас у ${current}. ` : ""}Заказ переедет: у него уберётся, у нового появится.`
                      : canPlan
                        ? "Заказ сразу уедет в стол выбранного технаря, статус станет «В работе»."
                        : "Заказ сразу уедет в стол выбранного технаря."
                }
                selectedNick={nick || null}
                busy={techPickBusy}
                allowClear
                onPick={(tech) => void setRowTechnician(tech.nick, tech.name)}
                onClear={() => void setRowTechnician("")}
                onClose={() => setTechPick(null)}
                secondary={
                  canPlan
                    ? {
                        label: "Только наметить технаря — отдам позже",
                        active: techPlanOnly,
                        onClick: () => setTechPlanOnly((v) => !v),
                      }
                    : null
                }
              />
            );
          })()
        : null}
      {isOsDeskPage ? (
        <PaymentMethodsDialog
          open={paymentDialogOpen}
          onClose={() => setPaymentDialogOpen(false)}
        />
      ) : null}
      {isMyOsDesk && page && osDispatch.choiceRow ? (
        <OsDispatchChoiceDialog
          key={osDispatch.choiceRow.id}
          row={osDispatch.choiceRow}
          pageId={page.id}
          subPageId={activeSubPageId}
          keys={osKeys}
          reason={
            choiceFromButton === osDispatch.choiceRow.id ? "button" : "status"
          }
          onClose={() => {
            setChoiceFromButton(null);
            osDispatch.closeChoice();
          }}
        />
      ) : null}
      {tableImmersive && !tableFullscreen ? (
        <TableChromeExit label="Свернуть" />
      ) : null}
      {/* Шапка стола в одну строку (макет «C — плотный»): заголовок, сегмент
          месяцев, итоги моно, «+ Заказ» и меню ⋯. Чат, статистика, полный
          экран, доступ и настройка стола переехали в ⋯ — шапка перестала быть
          стеной кнопок. `.page-header` из index.css перебит утилитами здесь,
          сам класс не трогаем: им живут чат и Грок. */}
      <div
        className={cn(
          "page-header flex-wrap gap-x-4 gap-y-2 border-transparent bg-transparent py-2.5 sm:flex-nowrap",
          chromeHidden && "hidden",
        )}
      >
        {/* «Назад» — туда, откуда пришли («Технари», «Люди», уведомление
            кладут `from` в state), иначе на шаг назад по истории, иначе в
            «Столы». На телефоне только стрелка: подпись съедала бы заголовок. */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={goBack}
          aria-label={cameFrom ? `Назад: ${cameFrom.label}` : "Назад"}
          title={cameFrom ? `Назад: ${cameFrom.label}` : "Назад"}
          className="-ml-1.5 h-9 min-w-11 shrink-0 gap-1 rounded-lg px-2 text-[12.5px] text-muted-foreground hover:text-foreground sm:h-8 sm:min-w-0"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">
            {cameFrom?.label ?? "Назад"}
          </span>
        </Button>
        <h1 className="min-w-0 shrink truncate font-serif text-[22px] font-light leading-none tracking-[-0.01em] max-sm:hidden sm:text-[26px]">
          {page.name}
        </h1>
        {!canEditData && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex shrink-0 cursor-default items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                <Lock className="h-3 w-3" /> Только просмотр
              </span>
            </TooltipTrigger>
            <TooltipContent>
              Правку выдаёт{" "}
              {responsibleMember
                ? `ответственный — ${displayNameOf(responsibleMember)}`
                : "ответственный за стол"}{" "}
              или Owner
            </TooltipContent>
          </Tooltip>
        )}
        {/* На телефоне сегмент месяцев уходит второй строкой на всю ширину —
            иначе он давится кнопкой «+ Заказ» и обрезается. */}
        {!personalSpaceOpen && (
          <div className="order-last min-w-0 basis-full overflow-x-auto sm:order-none sm:basis-auto sm:shrink-0 sm:overflow-visible">
            <SubPageTabs
              workspaceId={page.workspaceId}
              page={page}
              subPages={subPages}
              activeSubPageId={activeSubPageId}
              onSelect={handleSelectTab}
              canManage={canEditData || permissions.canManagePage(page)}
              canSetDefault={permissions.canManagePage(page)}
              userId={profile?.uid ?? ""}
              monthKey={monthKey}
              periods={periods}
              isMonthly={isMonthlyDesk(page, members)}
            />
          </div>
        )}
        <div className="flex-1" />
        {/* Итоги по видимым строкам — свой маленький компонент на сторе:
            правка в таблице перерисовывает только его, а не всю страницу. */}
        <DeskSummaryInline store={summaryStore} />
        {!personalSpaceOpen ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-pressed={statsOpen}
            aria-label="Статистика"
            title={
              page.osDesk
                ? "Статистика ОС: KPI, апсейл и ваш процент"
                : "Статистика стола: «Готово», общий доход, проценты"
            }
            onClick={() => setStatsOpen(!statsOpen)}
            className={cn(
              // Подсвечена всегда (акцент + мягкое кольцо), открытая — плотнее.
              "h-9 shrink-0 gap-1.5 rounded-lg border-primary/45 bg-primary/12 px-2.5 text-[12.5px] font-semibold text-primary shadow-[0_0_0_3px_hsl(var(--primary)/0.12)] hover:bg-primary/20 hover:text-primary max-xl:min-w-9 max-xl:justify-center max-xl:px-0 sm:h-8",
              statsOpen && "border-primary bg-primary/25",
            )}
          >
            <BarChart3 className="h-3.5 w-3.5" />
            {/* Подпись — с 1280 px (там же итоги в шапке): уже шапка не вмещала
                сегмент месяцев, «⋯» и заголовок стола. Значок подсвечен всегда. */}
            <span className="hidden xl:inline">Статистика</span>
          </Button>
        ) : null}
        {actions?.canQuickOrder ? (
          <Button
            size="sm"
            className="h-9 shrink-0 gap-1 rounded-lg bg-primary px-3 text-[12.5px] font-semibold text-primary-foreground sm:h-8"
            onClick={actions.quickOrder}
          >
            <Plus className="h-3.5 w-3.5" /> Заказ
          </Button>
        ) : actions?.canAddRow ? (
          <Button
            size="sm"
            className="h-9 shrink-0 gap-1 rounded-lg bg-primary px-3 text-[12.5px] font-semibold text-primary-foreground sm:h-8"
            onClick={actions.addRow}
          >
            <Plus className="h-3.5 w-3.5" /> Строка
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Ещё"
              className="relative shrink-0"
            >
              <MoreHorizontal className="h-4 w-4" />
              {personalSpaceOpen && (
                <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
              )}
              {pendingDeskRequests.length > 0 && canOpenAccess && (
                <span className="absolute -right-0.5 -top-0.5 rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground">
                  {pendingDeskRequests.length}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setChatOpen(true)}>
              <MessageSquare className="h-4 w-4" /> Чат страницы
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setStatsOpen(true)}>
              <BarChart3 className="h-4 w-4" /> Статистика
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setTableFullscreen(true);
                setTableImmersive(true);
              }}
            >
              <Maximize2 className="h-4 w-4" /> На весь экран
            </DropdownMenuItem>
            {isMyOsDesk && (
              <DropdownMenuItem
                onClick={() => {
                  setOsDeskGuideDismissed(false);
                  setOsGuideHidden(false);
                }}
              >
                <HelpCircle className="h-4 w-4" /> Как выдавать заказы
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {isResponsible && (
              <DropdownMenuItem onClick={handleToggleVisibility}>
                {page.hiddenByResponsible ? (
                  <>
                    <EyeOff className="h-4 w-4 text-destructive" /> Скрыто от
                    других — показать
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
                  <DropdownMenuItem
                    onClick={() =>
                      void restoreDesk(page, members, permissions.uid)
                    }
                  >
                    <ArchiveRestore className="h-4 w-4" /> Вернуть в столы
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onClick={() =>
                      void retireDesk(page, members, permissions.uid)
                    }
                  >
                    <Archive className="h-4 w-4" /> В неактуальные
                  </DropdownMenuItem>
                )}
              </>
            )}
            {/* Стол Технаря и стол Owner считаются столом технаря сами
                (`worksAsTechnician`) — галочка там только путала бы: снять её
                нельзя, а стояла бы она пустой. */}
            {permissions.role === "owner" &&
              page.responsibleUserId &&
              !responsibleWorksAsTechnician && (
                <DropdownMenuCheckboxItem
                  checked={Boolean(page.technicianDesk)}
                  onCheckedChange={(checked) =>
                    void handleToggleTechnicianDesk(checked === true)
                  }
                >
                  <HardHat className="h-4 w-4" /> Стол технаря
                </DropdownMenuCheckboxItem>
              )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {isMyOsDesk && !osGuideHidden && !chromeHidden && !personalSpaceOpen ? (
        <OsDeskGuide
          approvalColor={osStatusOptions.find(isApprovalOption)?.color}
          onDismiss={() => {
            setOsDeskGuideDismissed(true);
            setOsGuideHidden(true);
          }}
        />
      ) : null}

      {page.inactive && !chromeHidden && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-warning/30 bg-warning/[0.07] px-4 py-2 text-sm">
          <Archive className="h-4 w-4 shrink-0 text-warning" />
          <span className="min-w-0 flex-1">
            <span className="font-medium">Стол в неактуальных.</span>{" "}
            <span className="text-muted-foreground">
              Его нет в «Столах», на дашборде и в «Технарях» — данные сохранены.
            </span>
          </span>
          {canRetireThisDesk && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5"
              onClick={() => void restoreDesk(page, members, permissions.uid)}
            >
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
              Доступ к строкам снят или ещё не выдан — попросите ответственного
              за стол или Owner открыть его.
            </span>
          </span>
        </div>
      )}

      {rowsReadError && !rowsAccessPending && !rowsAccessDenied && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-destructive/30 bg-destructive/[0.07] px-4 py-2 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          <span className="min-w-0 flex-1">
            <span className="font-medium">Строки не загрузились.</span>{" "}
            <span className="text-muted-foreground">
              {rowsReadError} Повторяем попытку сами.
            </span>
          </span>
          <Button
            size="sm"
            variant="outline"
            className="min-h-9"
            onClick={retryRows}
          >
            Повторить сейчас
          </Button>
        </div>
      )}

      {rowsAccessPending && !rowsLoading && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-warning/30 bg-warning/[0.07] px-4 py-2 text-sm">
          <Lock className="h-4 w-4 shrink-0 text-warning" />
          <span className="min-w-0 flex-1">
            <span className="font-medium">
              Строки этого стола пока не видны.
            </span>{" "}
            <span className="text-muted-foreground">
              Доступ к столу ещё не дошёл до базы строк — он обновится сам,
              когда Owner или Тимлид откроет приложение. Данные не пропали: не
              вбивайте заказы заново.
            </span>
          </span>
        </div>
      )}

      {DISPATCH_ENABLED && isOwnDesk && !chromeHidden && (
        <IncomingDispatchBanner
          workspaceId={page.workspaceId}
          uid={permissions.uid}
          page={page}
        />
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
          {statsOpen ? (
            (() => {
              const body = page.osDesk ? (
                <OsDeskStats
                  page={page}
                  rows={rows}
                  keys={osKeys}
                  tabId={activeSubPageId}
                  tabLabel={activeSubPage?.name ?? page.mainTabName ?? "Основная"}
                  embedded
                />
              ) : (
                <SubPageStats columns={activeSubPage ? activeSubPage.columns : page.columns} rows={rows} embedded />
              );
              const title = page.osDesk ? "Статистика ОС" : "Статистика стола";
              const description = page.osDesk
                ? "KPI, апсейл месяца и ваш процент. Стол под окном не трогаем."
                : "«Готово», общий доход и проценты по открытой вкладке.";
              return statsOnPhone ? (
                <Sheet open onOpenChange={(o) => !o && setStatsOpen(false)}>
                  <SheetContent side="bottom" className="flex max-h-[88dvh] flex-col gap-0 p-0 pb-[env(safe-area-inset-bottom)]">
                    <SheetTitle className="px-4 pt-1">{title}</SheetTitle>
                    <SheetDescription className="px-4 pb-1 text-[12px]">{description}</SheetDescription>
                    <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
                  </SheetContent>
                </Sheet>
              ) : (
                <Dialog open onOpenChange={(o) => !o && setStatsOpen(false)}>
                  <DialogContent className="max-w-4xl gap-0 p-0">
                    <DialogTitle className="px-4 pt-4 sm:px-5">{title}</DialogTitle>
                    <DialogDescription className="px-4 pb-1 pt-1 text-[12px] sm:px-5">{description}</DialogDescription>
                    {body}
                  </DialogContent>
                </Dialog>
              );
            })()
          ) : null}

          {/* Стол ОС: запросы технарей «удалить заказ» / «поставить статус». */}
          {(isMyOsDesk || leaderSeesOsRequests) && osRequestsUid ? (
            <OsOrderRequestsPanel
              osUid={osRequestsUid}
              requests={osRequests.requests}
              statusKey={osKeys.status}
              mirrors={requestMirrors}
              sourceRows={rows}
              onChanged={refreshRequestMirrors}
            />
          ) : null}

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {rowsLoading ? (
              <div className="p-4">
                <div className="overflow-hidden rounded-[16px] border border-border/60">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 border-t border-border/50 px-4 py-3 first:border-t-0"
                    >
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
                page={tablePage ?? page}
                subPageId={activeSubPage?.id}
                manualRowOrder={
                  (activeSubPage ? activeSubPage.rowOrder : page.rowOrder) ===
                  "manual"
                }
                rows={rows}
                canEdit={canEditData}
                // Заказы заводит только ОС: у технаря в его столе нет
                // «Добавить строку» и «Быстрый заказ» (Owner не ограничиваем).
                ordersFromOsOnly={ordersFromOsOnly}
                techFills={techFills}
                cellPickerKeys={isMyOsDesk ? osTechPickerKeys : undefined}
                lockedKeys={osLockedKeys}
                cardMeta={
                  isOsDeskPage
                    ? (row) => <OsDatesInline info={osDatesOf(row)} />
                    : undefined
                }
                cellAddon={
                  isOsDeskPage
                    ? {
                        keys: osAddonKeys,
                        version: `${paymentMethods.map((m) => `${m.id}:${m.label}:${m.commissionPct}:${m.color ?? ""}:${m.inactive ? 1 : 0}`).join("|")}#${canEditData ? 1 : 0}#${osDatesVersion}`,
                        render: (row, colKey) => {
                          if (colKey === osKeys.dates)
                            return (
                              <OsDatesCell
                                info={osDatesOf(row)}
                                onSet={setOsDate?.(row)}
                              />
                            );
                          const chip = (
                            <PaymentChip
                              row={row}
                              colKey={colKey}
                              methods={paymentMethods}
                              canEdit={canEditData}
                              canConfigure={isRealOwner}
                              compact
                              onPick={(method) =>
                                void pickPayment(row, colKey, method)
                              }
                              onConfigure={() => setPaymentDialogOpen(true)}
                            />
                          );
                          if (colKey !== osKeys.upsell) return chip;
                          const upsellValue = row.cells[osKeys.upsell];
                          return (
                            <span className="flex min-w-0 items-center gap-0.5">
                              {chip}
                              <OsUpsellDate
                                slot={osSlotsOf(row).upsell}
                                hasUpsell={
                                  upsellValue !== null &&
                                  upsellValue !== undefined &&
                                  String(upsellValue).trim() !== ""
                                }
                                onSet={setOsDate?.(row)}
                              />
                            </span>
                          );
                        },
                      }
                    : undefined
                }
                cellAction={
                  isMyOsDesk
                    ? {
                        colKey: [osKeys.technician, osKeys.status],
                        get: (row, colKey) =>
                          colKey === osKeys.status
                            ? osRequestCellView(row)
                            : osCellView(row),
                        run: (row, colKey) => {
                          if (colKey === osKeys.status) {
                            const request = osRequestByRow.get(row.id);
                            if (request) setDecideRequestId(request.id);
                            return;
                          }
                          void runOsCellAction(row);
                        },
                        tickMs: OS_CELL_ACTION_TICK_MS,
                      }
                    : leaderSeesOsRequests
                      ? {
                          colKey: osKeys.status,
                          get: osRequestCellView,
                          run: (row) => {
                            const request = osRequestByRow.get(row.id);
                            if (request) setDecideRequestId(request.id);
                          },
                        }
                    : askOsEnabled && askStatusColumn
                      ? {
                          colKey: askStatusColumn.key,
                          get: askOsCellView,
                          run: (row) => setStatusRequestRowId(row.id),
                        }
                      : undefined
                }
                onOpenCellPicker={
                  isMyOsDesk ? (row) => openOsTechCell(row) : undefined
                }
                cellDisplay={
                  isOsDeskPage
                    ? {
                        keys: osDisplayKeys,
                        version: osCellDisplayVersion,
                        render: osCellDisplay,
                      }
                    : undefined
                }
                cardFooter={isMyOsDesk ? osCardFooter : undefined}
                // «Технарь» в карточке строки — в панели «Выдача» (с занятостью
                // и выдачей), а не второй голой выпадашкой в «Полях».
                rowCardHiddenKeys={isMyOsDesk ? osTechPickerKeys : undefined}
                // «Готово» — только выданному заказу.
                canMarkRowDone={isOsDeskPage ? rowIssued : undefined}
                groupHint={isOsDeskPage ? osGroupHint : undefined}
                emptyState={
                  isMyOsDesk
                    ? {
                        title: "Здесь ваши заказы",
                        description:
                          "Впишите имя клиента в первую строку — заказ встанет на «Утверждение». Потом «Выдать…» в столбце «Технарь».",
                      }
                    : undefined
                }
                renderRowPanel={(row) => {
                  // Стол ОС — панель выдачи; стол технаря — его поля по заказу,
                  // который ведёт ОС (обычные строки панели не получают).
                  if (isMyOsDesk) {
                    return (
                      <OsOrderPanel
                        row={row}
                        pageId={page.id}
                        subPageId={activeSubPageId}
                        osUid={permissions.uid}
                        osNickValue={myOsNickValue}
                        mirror={myOrders.bySource.get(row.id) ?? null}
                        onChanged={myOrders.refresh}
                        state={osTechStateOf(row)}
                        onAction={(action) => void runOsTechAction(row, action)}
                        busy={osActionBusy.has(row.id)}
                        problem={osDispatch.problems[row.id] ?? null}
                        claims={claimCount(exchange.byRow.get(row.id))}
                        keys={osKeys}
                        dates={osDatesOf(row)}
                        upsellDate={osSlotsOf(row).upsell}
                        onSetDate={setOsDate?.(row)}
                        payment={{
                          methods: paymentMethods,
                          canConfigure: isRealOwner,
                          onPick: (colKey, method) =>
                            void pickPayment(row, colKey, method),
                          onConfigure: () => setPaymentDialogOpen(true),
                          onAmount: (colKey, raw) =>
                            setOsAmount(row, colKey, raw),
                        }}
                      />
                    );
                  }
                  // Панель технаря — и у перенесённых заказов, и у остальных
                  // строк, когда заказы ведёт ОС: просьба об «Успешке» нужна
                  // именно там, где статус закрыт.
                  if (!activeWorkspaceId || (!row.osUid && !ordersFromOsOnly))
                    return null;
                  return (
                    <TechOrderPanel
                      row={row}
                      workspaceId={activeWorkspaceId}
                      pageId={page.id}
                      subPageId={activeSubPageId}
                      me={permissions.uid}
                      canWrite={page.responsibleUserId === permissions.uid}
                      pendingRequest={pendingRequestOf(row)}
                      onAskStatus={
                        canAskOs(row)
                          ? () => setStatusRequestRowId(row.id)
                          : undefined
                      }
                    />
                  );
                }}
                // Кто смотрит — для замка строк-заказов: их ведёт ОС.
                viewer={viewer}
                canEditStructure={permissions.canManagePage(page)}
                userId={profile?.uid ?? ""}
                userName={myDisplayName(profile, members)}
                focusRowId={focusRowId}
                onSummaryChange={summaryStore.set}
                onActionsChange={setActions}
              />
            )}
          </div>
        </>
      )}

      {decideRequestId && osRequestsUid ? (
        <OsRequestDecisionDialog
          request={
            osRequests.requests.find((r) => r.id === decideRequestId) ?? null
          }
          row={
            rows.find(
              (r) =>
                osRequestByRow.get(r.id)?.id === decideRequestId,
            ) ?? null
          }
          osUid={osRequestsUid}
          mirrors={requestMirrors}
          statusKey={osKeys.status}
          statusOptions={osStatusOptions}
          clientKey={osKeys.client}
          onClose={() => setDecideRequestId(null)}
          onChanged={refreshRequestMirrors}
        />
      ) : null}

      {statusRequestRowId && page && activeWorkspaceId ? (
        <OrderStatusRequestDialog
          row={rows.find((r) => r.id === statusRequestRowId) ?? null}
          workspaceId={activeWorkspaceId}
          deskPageId={page.id}
          deskTabId={activeSubPageId}
          deskName={page.name}
          columns={tablePage?.columns ?? page.columns}
          statusKey={
            rows.find((r) => r.id === statusRequestRowId)?.statusKey ||
            askStatusColumn?.key ||
            null
          }
          statusOptions={askStatusOptions}
          pending={(() => {
            const row = rows.find((r) => r.id === statusRequestRowId);
            return row ? pendingRequestOf(row) : null;
          })()}
          onClose={() => setStatusRequestRowId(null)}
        />
      ) : null}

      {settingsOpen && (
        <DeskAccessDialog
          page={page}
          onOpenChange={() => setSettingsOpen(false)}
          canToggleVisibility={isResponsible}
          pendingRequests={pendingDeskRequests}
          onResolveRequest={(request, status) =>
            resolveRequest(
              request,
              page,
              status,
              myDisplayName(profile, members),
            )
          }
        />
      )}
      {permissions.canManagePage(page) && (
        <DeskStudioSheet
          page={page}
          open={deskStudioOpen}
          onOpenChange={setDeskStudioOpen}
          uid={profile?.uid}
        />
      )}
      {permissions.canViewHistory && (
        <HistoryPanel
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          workspaceId={page.workspaceId}
          pageId={page.id}
          columns={page.columns}
        />
      )}
      <PageChatPanel
        open={chatOpen}
        onOpenChange={setChatOpen}
        workspaceId={page.workspaceId}
        pageId={page.id}
        pageName={page.name}
      />
    </div>
  );
}
