import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { AccessDenied } from "@/components/common/AccessDenied";
import { DataTable } from "@/components/table/DataTable";
import { TableChromeExit } from "@/components/table/TableChromeExit";
import { SubPageTabs } from "@/components/table/SubPageTabs";
import { SubPageStats } from "@/components/table/SubPageStats";
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
  resolveOsDeskKeys,
} from "@/services/osDeskService";
import { useSendOsRowToExchange } from "@/hooks/useSendOsRowToExchange";
import { claimCount, useMyExchangeOrders } from "@/hooks/useMyExchangeOrders";
import { OsExchangePicker } from "@/components/os/OsExchangePicker";
import type { CellActionView } from "@/components/table/CellActionButton";
import {
  DEFAULT_STATUS_OPTIONS,
  ensureApprovalStatus,
  ensureDoneStatus,
  findInProgressStatusOption,
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
import { useCurrentMonthKey } from "@/hooks/useCurrentMonthKey";
import { useDeskLoadPublisher } from "@/hooks/useDeskLoadPublisher";
import { useOsFieldKeysPublisher } from "@/hooks/useOsFieldKeysPublisher";
import { useMyOrderRows } from "@/hooks/useMyOrderRows";
import { useOsDeskDispatch } from "@/hooks/useOsDeskDispatch";
import { OsOrderPanel } from "@/components/os/OsOrderPanel";
import { OsDispatchChoiceDialog } from "@/components/os/OsDispatchChoiceDialog";
import { OsOrderRequestsPanel } from "@/components/os/OsOrderRequestsPanel";
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
import { isMonthlyDesk } from "@/services/monthTabService";
import type { PageRow, PaymentMethod, SubPage, WorkspacePage } from "@/types";
import type { DeskSummary, DeskTableActions } from "@/types/deskSummary";
import { formatNumber } from "@/utils/format";
import { PaymentChip } from "@/components/cashbox/PaymentChip";
import { OsDatesCell, OsDatesInline, type OsDatesInfo } from "@/components/os/OsDatesCell";
import {
  formatDayMonth,
  formatFullMoment,
  osIssuedAt,
  osReceivedAt,
  upsellMadeAt,
} from "@/utils/osDates";
import { PaymentMethodsDialog } from "@/components/cashbox/PaymentMethodsDialog";
import { useOsTotalsKeeper } from "@/hooks/useOsTotalsKeeper";
import { osRowTotal, paymentMethodsOf, paymentPatch } from "@/utils/payment";
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
    <div className="hidden shrink-0 items-center gap-4 font-mono text-[12.5px] text-muted-foreground lg:flex">
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
  const { activeWorkspace, activeWorkspaceId, allPages, members } =
    useWorkspace();
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
  const [statsOpen, setStatsOpen] = useState(false);
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
  const monthKey = useCurrentMonthKey();
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
    permissions.isWorkspaceOwner || permissions.realRole === "owner";
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
    !(permissions.isWorkspaceOwner || permissions.realRole === "owner"),
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
  // Свои заказы на «Заказах» со стола — с живыми откликами: выбрать технаря
  // можно прямо в ячейке «Технарь» (OsExchangePicker), не уходя на «Заказы».
  const exchange = useMyExchangeOrders(
    activeWorkspaceId,
    permissions.uid,
    isMyOsDesk,
  );
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
              "Даты ставит стол сам: «получен» — когда строку заполнили, «выдан» — когда заказ ушёл технарю",
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
   * Даты заказа для столбца «Даты» и карточки строки: получен — дата строки,
   * выдан — `osIssuedAt` (у выданных раньше — когда завели копию у технаря),
   * а пока заказ на «Заказах» — «ждёт откликов» / «едет».
   */
  function osDatesOf(row: PageRow): OsDatesInfo {
    const onExchange = row.orderId ? exchange.byRow.get(row.id) : undefined;
    const mirror = myOrders.bySource.get(row.id);
    const techNick = osKeys.technician ? row.cells[osKeys.technician] : null;
    return {
      receivedAt: osReceivedAt(row),
      issuedAt: osIssuedAt(row, mirror?.createdAt ?? null),
      techName: techNick ? String(techNick) : undefined,
      exchange:
        onExchange &&
        (onExchange.status === "open" || onExchange.status === "assigned")
          ? { status: onExchange.status, since: onExchange.createdAt ?? null }
          : null,
    };
  }
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
  /** Строка стола ОС, которой выбирают технаря (полноэкранный список). */
  const [techPickRowId, setTechPickRowId] = useState<string | null>(null);
  const techPickRow = techPickRowId
    ? (rows.find((r) => r.id === techPickRowId) ?? null)
    : null;
  const [techPickBusy, setTechPickBusy] = useState(false);
  async function setRowTechnician(nick: string) {
    if (!activeWorkspaceId || !page || !techPickRow) return;
    setTechPickBusy(true);
    try {
      await sbPatchRow(
        activeWorkspaceId,
        page.id,
        activeSubPageId,
        techPickRow.id,
        { cells: { [osKeys.technician]: nick } },
      );
      setTechPickRowId(null);
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

  // «В работу» прямо в таблице ОС (просьба Nurba 23.09.2026): заказ уходит на
  // «Заказы» сразу с данными строки. Там же метка, если заказ не доехал до
  // технаря или статусы у ОС и технаря разошлись, — с починкой по нажатию.
  const sendToExchange = useSendOsRowToExchange();
  const [osActionBusy, setOsActionBusy] = useState<Set<string>>(
    () => new Set(),
  );
  const osStatusOptions = ensureApprovalStatus(
    ensureDoneStatus(activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS),
  );
  // Метка «не совпадает» показывается не сразу после правки, а когда проход
  // уже должен был довезти статус (8 с). Раньше ради неё раз в 10 с
  // перерисовывалась вся страница вместе с таблицей; теперь таблица сама
  // пересчитывает ТОЛЬКО метки (`cellAction.tickMs`, см. DataTable).
  const OS_CELL_ACTION_TICK_MS = 10_000;
  const cellStr = (row: PageRow, key: string | null | undefined) => {
    const v = key ? row.cells[key] : null;
    return v === null || v === undefined ? "" : String(v).trim();
  };
  const statusLabelOf = (value: string) =>
    osStatusOptions.find((o) => o.value === value)?.label ?? value;
  function osCellView(row: PageRow): CellActionView | null {
    const client = cellStr(row, osKeys.client);
    if (!client) return null;
    const busy = osActionBusy.has(row.id);
    const tech = cellStr(row, osKeys.technician);
    const status = cellStr(row, osKeys.status);
    const onApproval = isApprovalStatusValue(status, osStatusOptions);
    const mirror = myOrders.bySource.get(row.id) ?? null;
    const dispatched = Boolean(mirror || (row.mirrorRowId && row.mirrorPageId));
    if (tech) {
      if (!dispatched && onApproval) {
        return {
          label: "В работу",
          tone: "primary",
          icon: "send",
          busy,
          title:
            "Отдать выбранному технарю: статус станет «В работе», заказ уедет в его стол",
        };
      }
      const problem = osDispatch.problems[row.id];
      if (problem)
        return {
          label: "Не доехал",
          tone: "warning",
          icon: "alert",
          busy,
          title: `Заказ не доходит до технаря: ${problem}`,
        };
      if (mirror?.statusKey && !myOrders.loading) {
        const theirs = cellStr(mirror, mirror.statusKey);
        const settled = Date.now() - (row.updatedAt ?? 0) > 8_000;
        if (status && theirs !== status && !onApproval && settled) {
          return {
            label: "Статус не совпал",
            tone: "warning",
            icon: "alert",
            busy,
            title: `У технаря «${theirs ? statusLabelOf(theirs) : "без статуса"}», у вас «${statusLabelOf(status)}». Нажмите — отправлю ваш.`,
          };
        }
      }
      return null;
    }
    if (dispatched) return null;
    if (row.orderId) {
      const onExchange = exchange.byRow.get(row.id);
      if (onExchange?.status === "assigned") {
        return {
          label: `Выдан: ${onExchange.assignedName ?? "технарю"}`,
          tone: "info",
          icon: "send",
          title:
            "Заказ отдан с «Заказов» и едет в стол технаря — ник появится в строке сам",
        };
      }
      if (onExchange) {
        const claims = claimCount(onExchange);
        return claims > 0
          ? {
              label: `Отклики · ${claims}`,
              tone: "primary",
              icon: "hand",
              title: `Откликнулись: ${claims}. Нажмите — выбрать технаря (или «Рандом»)`,
            }
          : {
              label: "Ждём отклики",
              tone: "info",
              icon: "store",
              title:
                "Заказ на «Заказах», технари получили уведомление. Нажмите — отдать напрямую, не дожидаясь отклика",
            };
      }
      return {
        label: "На «Заказах»",
        tone: "info",
        icon: "store",
        title:
          "Заказ на «Заказах» — отдайте его, когда технари откликнутся. Нажмите, чтобы открыть",
      };
    }
    // Технаря не выбрали: выдать прямо отсюда, не заходя на «Заказы». Слева в
    // той же ячейке — «Выбрать…» (отдать конкретному технарю).
    return {
      label: "На «Заказы»",
      tone: "primary",
      icon: "send",
      busy,
      title:
        "Выдать заказ: он уйдёт на «Заказы» со всеми данными строки, технари получат уведомление, отклики появятся здесь же. Отдать конкретному — «Выбрать…» слева",
    };
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
  const isRealOwner =
    permissions.isWorkspaceOwner || permissions.realRole === "owner";

  async function runOsCellAction(row: PageRow) {
    const view = osCellView(row);
    if (!view || !activeWorkspaceId || !page) return;
    const client = cellStr(row, osKeys.client) || "Заказ";
    const onExchange = row.orderId ? exchange.byRow.get(row.id) : undefined;
    if (onExchange?.status === "assigned") {
      toast.info(`${client}: заказ едет к технарю`, {
        description: "Ник технаря появится в строке сам, как только заказ доедет.",
      });
      return;
    }
    if (onExchange && !cellStr(row, osKeys.technician)) {
      setPickOrderId(onExchange.id);
      return;
    }
    if (view.icon === "store") {
      navigate("/orders");
      return;
    }
    const problem = osDispatch.problems[row.id];
    if (view.label === "Не доехал" && problem) {
      toast.error(`${client}: заказ не доходит до технаря`, {
        description: problem,
      });
      return;
    }
    setOsActionBusy((prev) => new Set(prev).add(row.id));
    try {
      const tech = cellStr(row, osKeys.technician);
      const mirror = myOrders.bySource.get(row.id) ?? null;
      if (
        view.label === "Статус не совпал" &&
        mirror?.statusKey &&
        mirror.deskPageId
      ) {
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
      } else if (tech) {
        const inProgress = findInProgressStatusOption([
          ...osStatusOptions,
        ])?.value;
        if (!inProgress) throw new Error("В списке статусов нет «В работе»");
        await sbPatchRow(activeWorkspaceId, page.id, activeSubPageId, row.id, {
          cells: { [osKeys.status]: inProgress },
        });
        toast.success(`${client} — в работу`, {
          description: "Заказ уедет в стол технаря через секунду.",
        });
      } else {
        await sendToExchange({
          row,
          pageId: page.id,
          tabId: activeSubPageId,
          keys: osKeys,
        });
        toast.success(`${client} — на «Заказах»`, {
          description:
            "Технари получили уведомление. Отклики появятся здесь же, в ячейке «Технарь», — нажмите и выберите технаря.",
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
      {isMyOsDesk ? (
        <TechPickerSheet
          open={Boolean(techPickRow)}
          title={`Технарь для «${String(techPickRow?.cells[osKeys.client] ?? "").trim() || "заказа"}»`}
          description="Заказ уедет в стол выбранного технаря (если он не на утверждении). Смена технаря заберёт заказ у прежнего."
          selectedNick={
            techPickRow
              ? String(techPickRow.cells[osKeys.technician] ?? "")
              : null
          }
          busy={techPickBusy}
          allowClear
          onPick={(tech) => void setRowTechnician(tech.nick)}
          onClear={() => void setRowTechnician("")}
          onClose={() => setTechPickRowId(null)}
        />
      ) : null}
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
          onClose={osDispatch.closeChoice}
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
          <div className="order-last min-w-0 basis-full overflow-x-auto sm:order-none sm:basis-auto sm:overflow-visible">
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
              isMonthly={isMonthlyDesk(page, members)}
            />
          </div>
        )}
        <div className="flex-1" />
        {/* Итоги по видимым строкам — свой маленький компонент на сторе:
            правка в таблице перерисовывает только его, а не всю страницу. */}
        <DeskSummaryInline store={summaryStore} />
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
            <DropdownMenuCheckboxItem
              checked={statsOpen}
              onCheckedChange={(checked) => setStatsOpen(checked === true)}
            >
              <BarChart3 className="h-4 w-4" /> Статистика
            </DropdownMenuCheckboxItem>
            <DropdownMenuItem
              onClick={() => {
                setTableFullscreen(true);
                setTableImmersive(true);
              }}
            >
              <Maximize2 className="h-4 w-4" /> На весь экран
            </DropdownMenuItem>
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
          {statsOpen && !chromeHidden && (
            <SubPageStats
              columns={activeSubPage ? activeSubPage.columns : page.columns}
              rows={rows}
            />
          )}

          {/* Стол ОС: запросы технарей «удалить заказ» / «поставить статус». */}
          {isMyOsDesk ? (
            <OsOrderRequestsPanel
              osUid={permissions.uid}
              mirrors={myOrders.rows}
              sourceRows={rows}
              onChanged={myOrders.refresh}
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
                            return <OsDatesCell info={osDatesOf(row)} />;
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
                          const upsellAt =
                            colKey === osKeys.upsell
                              ? upsellMadeAt(row, osKeys.upsell)
                              : null;
                          if (!upsellAt) return chip;
                          return (
                            <span className="flex min-w-0 items-center gap-1">
                              {chip}
                              <span
                                className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground"
                                title={`Апсейл сделан ${formatFullMoment(upsellAt)}`}
                              >
                                {formatDayMonth(upsellAt)}
                              </span>
                            </span>
                          );
                        },
                      }
                    : undefined
                }
                cellAction={
                  isMyOsDesk
                    ? {
                        colKey: osKeys.technician,
                        get: osCellView,
                        run: (row) => void runOsCellAction(row),
                        tickMs: OS_CELL_ACTION_TICK_MS,
                      }
                    : undefined
                }
                onOpenCellPicker={
                  isMyOsDesk ? (row) => setTechPickRowId(row.id) : undefined
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
                        onChoose={() => osDispatch.openChoice(row.id)}
                        onPickTech={() => setTechPickRowId(row.id)}
                        exchangeOrder={exchange.byRow.get(row.id) ?? null}
                        onPickFromExchange={(order) => setPickOrderId(order.id)}
                        keys={osKeys}
                        dates={osDatesOf(row)}
                        payment={{
                          methods: paymentMethods,
                          canConfigure: isRealOwner,
                          onPick: (colKey, method) =>
                            void pickPayment(row, colKey, method),
                          onConfigure: () => setPaymentDialogOpen(true),
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
