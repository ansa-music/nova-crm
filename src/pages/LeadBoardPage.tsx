import { createContext, Fragment, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import { useNavigate } from "react-router";
import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  History,
  IdCard,
  Layers,
  Loader2,
  Lock,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { AccessDenied } from "@/components/common/AccessDenied";
import { PageHeader, pageChipClass } from "@/components/common/PageHeader";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { StatusBadge } from "@/components/table/StatusBadge";
import { TechBadge } from "@/components/os/TechBadge";
import { EditableText, LeadStatusPicker, NickText, OsLabel, OsPicker, PersonPill } from "@/components/leads/LeadCells";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LeadCardSheet } from "@/components/leads/LeadCardSheet";
import { LeadFeed, type LeadHistoryContext } from "@/components/leads/LeadHistory";
import { NewLeadDialog } from "@/components/leads/NewLeadDialog";
import { PaymentChip } from "@/components/cashbox/PaymentChip";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentPeriodKey, usePeriodSettings } from "@/hooks/useCurrentPeriodKey";
import { useLeadBoard } from "@/hooks/useLeadBoard";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { usePermissions } from "@/hooks/usePermissions";
import { useUrlState } from "@/hooks/useUrlState";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  deleteLeadOrders,
  deleteLeadRecords,
  leadDeadlineOf,
  leadDeleteTargets,
  leadIsCancelled,
  leadIsClosed,
  leadStats,
  leadStatusOf,
  leadTablesFor,
  leadTechDeskHidden,
  moveLeadOs,
  osMembersOf,
  patchLeadCells,
  patchLeadExtras,
  restoreLeadRecords,
  type LeadDeleteResult,
  type LeadOrder,
  type LeadStats,
} from "@/services/leadBoardService";
import { confirmDialog, type ConfirmDialogOptions } from "@/utils/appDialog";
import { cn } from "@/utils/cn";
import { approvalStatusValue, getColumnOptions, isApprovalStatusValue } from "@/utils/columnOptions";
import { firestoreErrorText } from "@/utils/dbError";
import { myDisplayName } from "@/utils/displayName";
import { currencySymbol, formatCount, formatNumber } from "@/utils/format";
import { normalizeNumericInput } from "@/utils/numberInput";
import { formatDayMonth, formatFullDate, osDateSlots, slotShown } from "@/utils/osDates";
import { almatyMidnightMillis, formatDate } from "@/utils/date";
import { deskFromLocation, deskNavState, deskRowHref } from "@/utils/deskLinks";
import { buildPersonDeskIndex, osDeskLink, techDeskLink, type DeskLink, type PersonDeskIndex } from "@/utils/personDeskLinks";
import { periodShortLabel, recentPeriodKeys } from "@/utils/periods";
import { paymentMethodsOf, paymentPatch } from "@/utils/payment";
import { effectiveTechLoadKinds } from "@/utils/techLoad";
import { LEAD_BY_KEY } from "@/utils/reservedCellKeys";
import { pushUndoCommand, undoCommand, type UndoCommand } from "@/utils/undoStore";
import {
  LEAD_SORTS,
  LEAD_SORT_LABELS,
  LEAD_SORT_SECTIONS,
  defaultLeadSort,
  leadComparator,
  nextSortForColumn,
  rememberLeadGrouping,
  rememberLeadSort,
  rememberedLeadGrouping,
  rememberedLeadSort,
  sortColumnOf,
  type LeadSort,
  type LeadSortColumn,
} from "@/utils/leadSort";
import { personLabel } from "@/utils/peopleDesks";
import { resolveTechIdentity, techIdentityOfUid, techIdentityTitle, type TechIdentity } from "@/utils/techIdentity";
import type { PageColumn, PageRow, PaymentMethod, StatusOption, WorkspaceMember, WorkspacePage } from "@/types";

type RowExtras = NonNullable<PageRow["extras"]>;

const FILTERS = ["all", "open", "issued", "noos"] as const;
type Filter = (typeof FILTERS)[number];
const FILTER_LABELS: Record<Filter, string> = { all: "Все", open: "Не выданы", issued: "Выданы", noos: "Без ОС" };
const STATUS_COLUMN = { key: "status", type: "status" } as PageColumn;
const NO_STATUS = "__none";
const ORDER_FORMS = ["заказ", "заказа", "заказов"] as const;

function isIssued(o: LeadOrder): boolean {
  return o.kind === "os" ? Boolean(o.copy || o.techNick) : Boolean(o.techUid);
}

function matchesFilter(o: LeadOrder, f: Filter): boolean {
  if (f === "open") return o.kind === "os" && !isIssued(o);
  if (f === "issued") return isIssued(o) && (o.kind === "os" || Boolean(o.osUid));
  if (f === "noos") return o.kind === "tech" && !o.osUid;
  return true;
}

interface Group {
  /** Плоский список без группировки: заголовок группы не рисуется. */
  flat?: boolean;
  value: string;
  label: string;
  color: string | null;
  orders: LeadOrder[];
  sum: number;
  price: number;
  upsell: number;
}

/** Что строке нужно, кроме самого заказа, — считается один раз на выборку, а не на каждый клик. */
interface RowDerived {
  os: WorkspaceMember | null;
  tech: TechIdentity | null;
  techHidden: boolean;
  osColor: string | null;
  techColor: string | null;
  osLink: DeskLink | null;
  techLink: DeskLink | null;
}

/** Колбэки строки — один стабильный объект на страницу (строки под memo). */
interface RowActions {
  open: (key: string) => void;
  select: (key: string, e: ReactMouseEvent) => void;
  menu: (key: string | null) => void;
  remove: (order: LeadOrder) => void;
  removeSelected: () => void;
  cell: (order: LeadOrder, key: string, raw: string) => Promise<void>;
  pay: (order: LeadOrder, colKey: string, method: PaymentMethod | null) => void;
  moveOs: (order: LeadOrder, member: WorkspaceMember) => void;
  /** «↗ открыть стол»: переход с «← Общая таблица» (со своими фильтрами). */
  go: (href: string) => void;
}

/**
 * «Общая таблица» (Тимлид+ и Owner): все заказы периода по всем ОС и
 * технарям одной таблицей. Вид — как финансовый отчёт в Excel (просьба Nurba
 * 30.09.2026): сетка с линиями, номер строки, закреплённые шапка и «Имя»,
 * итоговая строка внизу; по умолчанию одним списком по времени внесения в
 * таблицу, сверху вниз. Столбцы — как в таблице Nurba: Имя (визитка) ·
 * Получен · Выдан · Номер · Сумма · Апсейл · Менеджер ОС · Статус · Дата
 * сдачи · Технарь; у ОС и технаря — «↗ открыть стол». Правка — прямо в
 * клетке, ОС — выбором (строка переезжает на его стол), новый клиент —
 * «+ Клиент», удаление — меню строки, правый клик или Delete по выделенным
 * (номер строки), «Вернуть» — тост или Ctrl+Z. История заказа и лента
 * изменений — из `order_events`. Всё — в Supabase, вживую.
 */
export default function LeadBoardPage() {
  const permissions = usePermissions();
  const { activeWorkspace, activeWorkspaceId } = useWorkspace();
  if (!permissions.isResolved || !activeWorkspace) {
    return (
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-5 sm:p-8">
        <Skeleton className="h-8 w-60" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }
  if (!permissions.canLeadBoard) {
    return <AccessDenied reason="«Общая таблица» открыта только Owner и роли «Тимлид+»." />;
  }
  if (activeWorkspace.rowsBackend !== "supabase" || !activeWorkspaceId) {
    return (
      <div className="mx-auto w-full max-w-3xl p-5 sm:p-8">
        <Alert tone="warning">«Общая таблица» работает, когда строки таблиц хранятся в Supabase («Настройки → Строки таблиц»).</Alert>
      </div>
    );
  }
  return <LeadBoard workspaceId={activeWorkspaceId} viewerIsOwner={permissions.actsAsOwner} />;
}

function LeadBoard({ workspaceId, viewerIsOwner }: { workspaceId: string; viewerIsOwner: boolean }) {
  const { activeWorkspace, members, pages, allPages, osDesks } = useWorkspace();
  const { profile } = useAuth();
  const mobile = useIsMobile();
  const currentKey = useCurrentPeriodKey();
  const periods = usePeriodSettings();
  const periodKeys = useMemo(() => recentPeriodKeys(currentKey, 3, periods).reverse(), [currentKey, periods]);
  const [rawPeriod, setPeriod] = useUrlState<string>("p", currentKey);
  const period = periodKeys.includes(rawPeriod) ? rawPeriod : currentKey;
  const [filter, setFilter] = useUrlState<Filter>("f", "all", { values: FILTERS });
  const [osFilter, setOsFilter] = useUrlState<string>("os", "");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [feedOpen, setFeedOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  // Порядок: в адресе (`?sort=`). Умолчание — выбор этого человека в меню
  // «Порядок», иначе «Новые снизу» (на телефоне — «Новые сверху»).
  // Клик по заголовку столбца — только в адресе, в память не идёт.
  const [sortDefault] = useState<LeadSort>(() => rememberedLeadSort(mobile));
  const [sort, setSort] = useUrlState<LeadSort>("sort", sortDefault, { values: LEAD_SORTS });
  const pickSort = useCallback(
    (next: LeadSort) => {
      rememberLeadSort(next, mobile);
      setSort(next);
    },
    [mobile, setSort]
  );
  // Группы по статусу — по умолчанию выключены (одним списком, как отчёт).
  const [groupDefault] = useState<"1" | "0">(() => (rememberedLeadGrouping() ? "1" : "0"));
  const [groupParam, setGroupParam] = useUrlState<"1" | "0">("g", groupDefault, { values: ["1", "0"] });
  const grouped = groupParam === "1";
  const toggleGrouped = () => {
    rememberLeadGrouping(!grouped);
    setGroupParam(grouped ? "0" : "1");
  };

  // Столы «только для Owner» — только у Owner (Тимлиду+ их строки закрыты базой).
  const tables = useMemo(() => leadTablesFor(period, osDesks, pages, viewerIsOwner), [period, osDesks, pages, viewerIsOwner]);
  const allDesks = useMemo(() => {
    const map = new Map<string, WorkspacePage>();
    for (const p of [...allPages, ...osDesks]) map.set(p.id, p);
    return [...map.values()];
  }, [allPages, osDesks]);
  const pagesById = useMemo(() => new Map(allDesks.map((p) => [p.id, p])), [allDesks]);
  const techHiddenOf = useCallback((o: LeadOrder) => leadTechDeskHidden(o, pagesById, viewerIsOwner), [pagesById, viewerIsOwner]);
  const board = useLeadBoard({ workspaceId, tables, pages: allDesks, enabled: true });
  const { patchLocal, refresh, hideLocal, unhideLocal } = board;

  const statusOptions = useMemo(() => getColumnOptions(STATUS_COLUMN, activeWorkspace), [activeWorkspace]);
  const techNickOptions = useMemo(() => activeWorkspace?.techNickOptions ?? [], [activeWorkspace?.techNickOptions]);
  const osMembers = useMemo(() => osMembersOf(members), [members]);
  const memberByUid = useMemo(() => new Map(members.map((m) => [m.uid, m])), [members]);
  const historyCtx: LeadHistoryContext = useMemo(
    () => ({ members, statusOptions, techNickOptions, pagesById }),
    [members, statusOptions, techNickOptions, pagesById]
  );
  const fromName = myDisplayName(profile, members);

  const techOf = useCallback(
    (o: LeadOrder): TechIdentity | null => {
      if (o.techNick) {
        const byNick = resolveTechIdentity(o.techNick, members, techNickOptions);
        if (byNick) return byNick;
      }
      return o.techUid ? techIdentityOfUid(o.techUid, null, members, techNickOptions) : null;
    },
    [members, techNickOptions]
  );

  // Цвета «Менеджера ОС» и «Технаря» — варианты их ников.
  const responsibleOptions = activeWorkspace?.responsibleOptions;
  const osColorOf = useCallback(
    (o: LeadOrder): string | null => {
      const m = o.osUid ? memberByUid.get(o.osUid) : null;
      return (m?.osNickValue && responsibleOptions?.find((x) => x.value === m.osNickValue)?.color) || null;
    },
    [memberByUid, responsibleOptions]
  );
  const techColorOf = useCallback(
    (o: LeadOrder): string | null => {
      const t = techOf(o);
      return (t?.nick && techNickOptions.find((x) => x.value === t.nick)?.color) || null;
    },
    [techOf, techNickOptions]
  );
  // «↗ открыть стол» у ОС и технаря — на строку заказа, если стол открыт.
  const canAccessDesk = usePermissions().canAccessPage;
  const deskIndex = useMemo(
    () => buildPersonDeskIndex({ members, pages: allDesks, osDesks: allDesks.filter((p) => p.osDesk), canAccess: canAccessDesk }),
    [members, allDesks, canAccessDesk]
  );
  const osLinkOf = useCallback(
    (o: LeadOrder) => leadOsLink(o, deskIndex, o.osUid ? (memberByUid.get(o.osUid) ?? null) : null),
    [deskIndex, memberByUid]
  );
  const techLinkOf = useCallback(
    (o: LeadOrder) => leadTechLink(o, deskIndex, techOf(o), techHiddenOf(o)),
    [deskIndex, techOf, techHiddenOf]
  );

  const q = query.trim().toLocaleLowerCase("ru");
  const visible = useMemo(
    () =>
      board.orders.filter((o) => {
        if (!matchesFilter(o, filter)) return false;
        if (osFilter && o.osUid !== osFilter) return false;
        if (!q) return true;
        const hay = `${o.client} ${o.phone} ${String(o.row.cells[o.keys.note] ?? "")}`.toLocaleLowerCase("ru");
        return hay.includes(q) || o.phone.replace(/\D/g, "").includes(q.replace(/\D/g, "") || "\u0000");
      }),
    [board.orders, filter, osFilter, q]
  );

  const derived = useMemo(() => {
    const map = new Map<string, RowDerived>();
    for (const o of visible) {
      map.set(o.key, {
        os: o.osUid ? (memberByUid.get(o.osUid) ?? null) : null,
        tech: techOf(o),
        techHidden: techHiddenOf(o),
        osColor: osColorOf(o),
        techColor: techColorOf(o),
        osLink: osLinkOf(o),
        techLink: techLinkOf(o),
      });
    }
    return map;
  }, [visible, memberByUid, techOf, techHiddenOf, osColorOf, techColorOf, osLinkOf, techLinkOf]);

  const comparator = useMemo(() => {
    const approval = approvalStatusValue([...statusOptions]);
    const rankOrder = [approval, ...statusOptions.map((o) => o.value).filter((v) => v !== approval)];
    return leadComparator(sort, {
      osLabel: (o) => {
        const m = o.osUid ? memberByUid.get(o.osUid) : null;
        return m ? personLabel(m) : "";
      },
      techLabel: (o) => techOf(o)?.label ?? "",
      statusRank: (o) => {
        const v = leadStatusOf(o, statusOptions);
        const i = rankOrder.indexOf(v || approval);
        return i < 0 ? rankOrder.length : i;
      },
    });
  }, [sort, statusOptions, memberByUid, techOf]);
  const groups = useMemo(() => buildGroups(visible, statusOptions, comparator, grouped), [visible, statusOptions, comparator, grouped]);
  /** Строки в порядке на экране (свёрнутые группы пропущены) — по нему номера и Shift-выделение. */
  const displayOrders = useMemo(
    () => groups.flatMap((g) => (g.flat || !collapsed.has(g.value) ? g.orders : [])),
    [groups, collapsed]
  );
  const totals = useMemo(() => sheetTotals(visible, statusOptions), [visible, statusOptions]);
  const kinds = useMemo(() => effectiveTechLoadKinds(activeWorkspace), [activeWorkspace]);
  const stats = useMemo(() => leadStats(visible, statusOptions, kinds), [visible, statusOptions, kinds]);
  const methods = useMemo(() => paymentMethodsOf(activeWorkspace), [activeWorkspace]);

  const openOrder = openKey ? (board.orders.find((o) => o.key === openKey) ?? null) : null;

  const onCells = useCallback(
    async (order: LeadOrder, cells: Record<string, string | number | null>) => {
      patchLocal(order.key, cells);
      try {
        await patchLeadCells(workspaceId, order, cells);
      } catch (e) {
        toast.error("Не сохранилось", { description: firestoreErrorText(e, "Попробуйте ещё раз") });
        refresh();
      }
    },
    [patchLocal, refresh, workspaceId]
  );
  const onCell = useCallback(
    async (order: LeadOrder, key: string, raw: string) => {
      if (!key) return;
      const money = key === order.keys.price || key === order.keys.upsell;
      const value = money && raw ? normalizeNumericInput(raw) : raw;
      await onCells(order, { [key]: value });
    },
    [onCells]
  );
  const onPay = useCallback(
    (order: LeadOrder, colKey: string, method: PaymentMethod | null) => void onCells(order, paymentPatch(colKey, method)),
    [onCells]
  );

  const onExtras = useCallback(
    async (order: LeadOrder, extras: RowExtras | null) => {
      try {
        await patchLeadExtras(workspaceId, order, extras);
      } catch (e) {
        toast.error("Визитка не сохранилась", { description: firestoreErrorText(e, "Попробуйте ещё раз") });
        throw e;
      }
    },
    [workspaceId]
  );

  const onMoveOs = useCallback(
    async (order: LeadOrder, member: WorkspaceMember) => {
      const ok = await confirmDialog({
        title: `Передать заказ «${order.client || "без имени"}» ОС ${personLabel(member)}?`,
        description: order.copy
          ? "Строка переедет на стол нового ОС, заказ у технаря останется у него, но его будет вести новый ОС."
          : "Строка переедет на стол нового ОС. Он получит уведомление.",
        confirmLabel: "Передать",
      });
      if (!ok || !profile) return;
      try {
        await moveLeadOs({ workspaceId, order, toOs: member, osDesks, fromUid: profile.uid, fromName });
        toast.success(`Заказ у ОС ${personLabel(member)}`);
        setOpenKey(null);
        refresh();
      } catch (e) {
        toast.error("Не передан", { description: firestoreErrorText(e, "Попробуйте ещё раз") });
      }
    },
    [refresh, fromName, osDesks, profile, workspaceId]
  );

  // ---- Выделение строк (номер строки, как в Excel) ----
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const selAnchorRef = useRef<string | null>(null);
  const displayKeys = useMemo(() => displayOrders.map((o) => o.key), [displayOrders]);
  const displayKeysRef = useRef<string[]>(displayKeys);
  useLayoutEffect(() => {
    displayKeysRef.current = displayKeys;
  }, [displayKeys]);
  const selectRow = useCallback((key: string, e: ReactMouseEvent) => {
    const toggle = e.ctrlKey || e.metaKey;
    setSelected((prev) => {
      const keys = displayKeysRef.current;
      const anchor = selAnchorRef.current;
      if (e.shiftKey && anchor) {
        const a = keys.indexOf(anchor);
        const b = keys.indexOf(key);
        if (a >= 0 && b >= 0) {
          const next = toggle ? new Set(prev) : new Set<string>();
          for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(keys[i]);
          return next;
        }
      }
      selAnchorRef.current = key;
      if (toggle) {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }
      // Повторное нажатие по единственной выделенной — снять (на таче без клавиш).
      if (prev.size === 1 && prev.has(key)) return new Set();
      return new Set([key]);
    });
  }, []);
  const clearSelection = useCallback(() => {
    setSelected(new Set());
    selAnchorRef.current = null;
  }, []);
  // Другой период, фильтр, ОС или поиск — выделение прежних строк не переносится.
  const selectionScope = `${period}|${filter}|${osFilter}|${q}`;
  useEffect(() => {
    clearSelection();
  }, [selectionScope, clearSelection]);
  const selectedOrders = useMemo(() => displayOrders.filter((o) => selected.has(o.key)), [displayOrders, selected]);
  /** Номер строки на экране — через контекст: при смене порядка перерисовываются только номера, не строки. */
  const rowNumbers = useMemo(() => new Map(displayKeys.map((key, i) => [key, i + 1])), [displayKeys]);
  const [menuKey, setMenuKey] = useState<string | null>(null);

  // ---- Удаление ----
  const runDelete = useCallback(
    async (list: readonly LeadOrder[]) => {
      if (list.length === 0) return;
      const ok = await confirmDialog(deleteConfirmOptions(list, memberByUid, techOf));
      if (!ok) return;
      const keysOf = (o: LeadOrder) => leadDeleteTargets(o).map((t) => `${t.pageId}/${t.tabId}/${t.rowId}`);
      const hideKeys = list.flatMap(keysOf);
      hideLocal(hideKeys);
      clearSelection();
      setOpenKey((cur) => (cur && list.some((o) => o.key === cur) ? null : cur));
      const toastId = toast.loading(list.length > 1 ? `Удаляю ${formatCount(list.length, ORDER_FORMS)}…` : "Удаляю заказ…");
      let result: LeadDeleteResult;
      try {
        result = await deleteLeadOrders(workspaceId, list);
      } catch (e) {
        unhideLocal(hideKeys);
        toast.error("Не удалилось", { id: toastId, description: firestoreErrorText(e, "Попробуйте ещё раз") });
        return;
      }
      const failed = new Set(result.failed.map((f) => f.key));
      if (failed.size) unhideLocal(list.filter((o) => failed.has(o.key)).flatMap(keysOf));
      refresh();
      if (result.deleted.length === 0) {
        toast.error("Не удалилось", { id: toastId, description: firestoreErrorText(result.failed[0]?.error, "Попробуйте ещё раз") });
        return;
      }
      const records = result.records;
      const goneKeys = list.filter((o) => !failed.has(o.key)).flatMap(keysOf);
      const count = result.deleted.length;
      const cmd: UndoCommand = {
        undo: async () => {
          await restoreLeadRecords(workspaceId, records);
          unhideLocal(goneKeys);
          refresh();
          toast.success(count > 1 ? `Вернул ${formatCount(count, ORDER_FORMS)}` : "Заказ возвращён");
        },
        redo: async () => {
          hideLocal(goneKeys);
          try {
            await deleteLeadRecords(workspaceId, records);
          } catch (e) {
            unhideLocal(goneKeys);
            throw e;
          }
          refresh();
        },
      };
      pushUndoCommand(cmd);
      const notes: string[] = [];
      if (failed.size) notes.push(`Не удалось: ${failed.size} — нет прав или нет связи.`);
      if (result.exchangeRemoved.length) notes.push(`Сняты с «Заказов»: ${result.exchangeRemoved.length}.`);
      if (result.exchangeFailed.length) notes.push(`На «Заказах» остались: ${result.exchangeFailed.length} — удалите их там.`);
      toast.success(count > 1 ? `Удалено ${formatCount(count, ORDER_FORMS)}` : "Заказ удалён", {
        id: toastId,
        description: notes.join(" ") || "Вернуть — кнопкой или Ctrl+Z.",
        duration: 10_000,
        action: { label: "Вернуть", onClick: () => void undoCommand(cmd) },
      });
    },
    [clearSelection, hideLocal, memberByUid, refresh, techOf, unhideLocal, workspaceId]
  );

  // Delete — удалить выделенные, Esc — снять выделение (не в поле ввода и не в окне).
  useEffect(() => {
    if (selectedOrders.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], [role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox']")) return;
      if (e.key === "Escape") {
        clearSelection();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        void runDelete(selectedOrders);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedOrders, runDelete, clearSelection]);

  // Колбэки строк — через ref: объект стабилен, строки под memo не перерисовываются.
  const navigate = useNavigate();
  const latest = useRef({ selectRow, onCell, onPay, onMoveOs, runDelete, selectedOrders, navigate });
  useLayoutEffect(() => {
    latest.current = { selectRow, onCell, onPay, onMoveOs, runDelete, selectedOrders, navigate };
  });
  const actions = useMemo<RowActions>(
    () => ({
      go: (href) => void latest.current.navigate(href, { state: deskNavState(deskFromLocation(window.location)) }),
      open: (key) => setOpenKey(key),
      select: (key, e) => latest.current.selectRow(key, e),
      menu: (key) => setMenuKey(key),
      remove: (order) => void latest.current.runDelete([order]),
      removeSelected: () => void latest.current.runDelete(latest.current.selectedOrders),
      cell: (order, key, raw) => latest.current.onCell(order, key, raw),
      pay: (order, colKey, method) => latest.current.onPay(order, colKey, method),
      moveOs: (order, member) => void latest.current.onMoveOs(order, member),
    }),
    []
  );

  const toggleGroup = (value: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });

  // ---- Окно таблицы: до низа экрана, шапка и итоги закреплены ----
  const pageRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  // «Новые снизу» одним списком — окно сразу у последних заказов, как Excel на
  // последней строке; кто стоит внизу, остаётся внизу, когда приходят новые.
  const toBottom = !grouped && sort === "new-bottom";
  const scrollScope = `${selectionScope}|${sort}|${grouped ? 1 : 0}`;
  const selectionActive = selectedOrders.length > 0;
  const scrolledScopeRef = useRef<string | null>(null);
  const stickBottomRef = useRef(true);
  const keepAtBottom = useCallback(() => {
    const el = sheetRef.current;
    if (el && toBottom && stickBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [toBottom]);
  useFillHeight(sheetRef, pageRef, !mobile && board.loaded && groups.length > 0, keepAtBottom);
  useLayoutEffect(() => {
    const el = sheetRef.current;
    if (!el || !board.loaded) return;
    if (scrolledScopeRef.current !== scrollScope) {
      scrolledScopeRef.current = scrollScope;
      stickBottomRef.current = toBottom;
      el.scrollTop = toBottom ? el.scrollHeight : 0;
      return;
    }
    keepAtBottom();
  }, [scrollScope, toBottom, board.loaded, displayOrders.length, selectionActive, keepAtBottom]);
  const onSheetScroll = useCallback(() => {
    const el = sheetRef.current;
    if (el) stickBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  return (
    <div ref={pageRef} className="mx-auto flex w-full min-w-0 max-w-[1560px] flex-col gap-3 p-4 sm:p-6">
      <PageHeader
        className="mb-0"
        eyebrow="Тимлид+ · все заказы периода"
        title="Общая таблица"
        description="Все заказы всех ОС и технарей вживую: правьте прямо в клетке, передавайте другому ОС, заводите новых клиентов."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="min-h-11 gap-1.5 sm:min-h-9" onClick={() => setFeedOpen(true)}>
              <History className="h-4 w-4" /> Лента изменений
            </Button>
            <Button className="min-h-11 gap-1.5 sm:min-h-9" onClick={() => setNewOpen(true)} disabled={osMembers.length === 0}>
              <Plus className="h-4 w-4" /> Клиент
            </Button>
          </div>
        }
        filters={
          <>
            {periodKeys.map((key) => (
              <button key={key} type="button" className={pageChipClass(period === key)} onClick={() => setPeriod(key)}>
                {periodShortLabel(key, periods)}
                {key === currentKey ? <span className="text-[10px] uppercase tracking-wide opacity-70">идёт</span> : null}
              </button>
            ))}
            <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />
            {FILTERS.map((f) => (
              <button key={f} type="button" className={pageChipClass(filter === f)} onClick={() => setFilter(f)}>
                {FILTER_LABELS[f]}
              </button>
            ))}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Клиент или номер" className="pl-8" aria-label="Поиск" />
        </div>
        <Select value={osFilter || "__all"} onValueChange={(v) => setOsFilter(v === "__all" ? "" : v)}>
          <SelectTrigger className="h-9 w-auto min-w-[9rem]" aria-label="ОС">
            <SelectValue placeholder="Все ОС" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Все ОС</SelectItem>
            {osMembers.map((m) => (
              <SelectItem key={m.uid} value={m.uid}>
                <OsLabel member={m} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <SortMenu sort={sort} defaultSort={defaultLeadSort(mobile)} onSort={pickSort} className={mobile ? "min-w-0 flex-1 justify-start" : undefined} />
        <button
          type="button"
          className={cn(pageChipClass(grouped), "h-9 gap-1.5")}
          aria-pressed={grouped}
          onClick={toggleGrouped}
          title={grouped ? "Показать одним списком" : "Разложить по статусам"}
        >
          <Layers className="h-3.5 w-3.5" /> {mobile ? "Группы" : "Группы по статусу"}
        </button>
        <div className="ml-auto flex items-center gap-3 font-mono text-[12.5px] tabular-nums text-muted-foreground">
          <span>{formatCount(visible.length, ORDER_FORMS)}</span>
          {totals.open > 0 ? <span className="text-warning">не выдано {totals.open}</span> : null}
          {mobile ? <span className="text-foreground">{formatNumber(totals.net)}</span> : null}
          <button type="button" aria-label="Обновить" className="rounded-md p-1 hover:bg-accent" onClick={refresh}>
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {board.loaded && visible.length > 0 ? <LeadStatsStrip stats={stats} /> : null}

      {board.error ? (
        <Alert tone="error">
          {firestoreErrorText(board.error, "Не удалось прочитать общую таблицу")}{" "}
          <button type="button" className="underline" onClick={refresh}>
            Повторить
          </button>
        </Alert>
      ) : null}

      {!board.loaded ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Читаю заказы всех столов…
        </div>
      ) : groups.length === 0 ? (
        <p className="rounded-xl border border-border px-4 py-10 text-center text-sm text-muted-foreground">
          {board.orders.length === 0 ? "За этот период заказов нет." : "Под фильтр ничего не подошло."}
        </p>
      ) : mobile ? (
        <div className="flex flex-col gap-3">
          {groups.map((g) => (
            <section key={g.value} className="flex flex-col gap-1.5">
              <GroupHeader group={g} collapsed={collapsed.has(g.value)} onToggle={() => toggleGroup(g.value)} />
              {collapsed.has(g.value)
                ? null
                : g.orders.map((o) => {
                    const d = derived.get(o.key);
                    return (
                      <LeadMobileCard
                        key={o.key}
                        order={o}
                        os={d?.os ?? null}
                        tech={d?.tech ?? null}
                        techHidden={d?.techHidden ?? false}
                        statusOptions={statusOptions}
                        onOpen={() => setOpenKey(o.key)}
                        osColor={d?.osColor ?? null}
                        techColor={d?.techColor ?? null}
                      />
                    );
                  })}
            </section>
          ))}
        </div>
      ) : (
        <div className="relative">
          <div
            ref={sheetRef}
            onScroll={onSheetScroll}
            role="table"
            aria-label="Общая таблица заказов"
            aria-rowcount={displayOrders.length + 2}
            className="relative overflow-auto rounded-lg border border-border bg-card"
          >
            <div className="min-w-[82.25rem]">
              <RowNumbers.Provider value={rowNumbers}>
                <SheetHead sort={sort} onSort={setSort} />
                {groups.map((g) => {
                  const isCollapsed = !g.flat && collapsed.has(g.value);
                  return (
                    <Fragment key={g.value}>
                      {g.flat ? null : <GroupRow group={g} collapsed={isCollapsed} onToggle={() => toggleGroup(g.value)} />}
                      {isCollapsed
                        ? null
                        : g.orders.map((o) => {
                            const isSel = selected.has(o.key);
                            return (
                              <LeadRow
                                key={o.key}
                                order={o}
                                selected={isSel}
                                selectedCount={isSel ? selectedOrders.length : 0}
                                menuOpen={menuKey === o.key}
                                d={derived.get(o.key) ?? EMPTY_DERIVED}
                                osMembers={osMembers}
                                statusOptions={statusOptions}
                                methods={methods}
                                actions={actions}
                              />
                            );
                          })}
                    </Fragment>
                  );
                })}
                {/* Под панелью выделения — место, чтобы последние строки не прятались под ней. */}
                {selectedOrders.length > 0 ? <div aria-hidden className="h-14" /> : null}
                <TotalsRow totals={totals} methods={methods} />
              </RowNumbers.Provider>
            </div>
          </div>
          {selectedOrders.length > 0 ? (
            <SelectionBar orders={selectedOrders} onDelete={() => void runDelete(selectedOrders)} onClear={clearSelection} />
          ) : null}
        </div>
      )}

      <LeadCardSheet
        order={openOrder}
        onClose={() => setOpenKey(null)}
        workspaceId={workspaceId}
        statusOptions={statusOptions}
        os={openOrder?.osUid ? (memberByUid.get(openOrder.osUid) ?? null) : null}
        osMembers={osMembers}
        tech={openOrder ? techOf(openOrder) : null}
        techDeskHidden={openOrder ? techHiddenOf(openOrder) : false}
        osLink={openOrder ? osLinkOf(openOrder) : null}
        techLink={openOrder ? techLinkOf(openOrder) : null}
        historyCtx={historyCtx}
        historyVersion={openOrder?.row.updatedAt ?? 0}
        onCell={onCell}
        onPay={onPay}
        methods={methods}
        onExtras={onExtras}
        onMoveOs={onMoveOs}
        onDelete={(o) => void runDelete([o])}
      />

      <Sheet open={feedOpen} onOpenChange={setFeedOpen}>
        <SheetContent side={mobile ? "bottom" : "right"} className="flex w-full flex-col gap-3 overflow-y-auto sm:w-[min(32rem,92vw)] sm:max-w-[32rem]">
          <SheetHeader className="text-left">
            <SheetTitle>Лента изменений</SheetTitle>
            <p className="text-[12px] text-muted-foreground">Кто, когда и что менял в заказах: статусы, технари, ОС, суммы, удаления.</p>
          </SheetHeader>
          {feedOpen ? (
            <LeadFeed
              workspaceId={workspaceId}
              ctx={historyCtx}
              orders={board.orders}
              onOpen={(o) => {
                setFeedOpen(false);
                setOpenKey(o.key);
              }}
            />
          ) : null}
        </SheetContent>
      </Sheet>

      {profile ? (
        <NewLeadDialog
          open={newOpen}
          onOpenChange={setNewOpen}
          workspaceId={workspaceId}
          osMembers={osMembers}
          osDesks={osDesks}
          statusOptions={statusOptions}
          fromUid={profile.uid}
          fromName={fromName}
          defaultOsUid={osFilter || null}
          methods={methods}
          onCreated={refresh}
        />
      ) : null}
    </div>
  );
}

const EMPTY_DERIVED: RowDerived = { os: null, tech: null, techHidden: false, osColor: null, techColor: null, osLink: null, techLink: null };

/** Стол ОС заказа: у заказа ОС — сама строка-источник, у строки технаря — его заказ на столе ОС. */
function leadOsLink(o: LeadOrder, index: PersonDeskIndex, os: WorkspaceMember | null): DeskLink | null {
  if (!o.osUid) return null;
  const label = `Открыть стол ОС ${os ? personLabel(os) : ""}`.trim();
  if (o.kind === "os") return index.openable.has(o.pageId) ? { href: deskRowHref(o.pageId, o.tabId || null, o.row.id), label } : null;
  const target = index.osByUid.get(o.osUid);
  return target ? osDeskLink(index, target, o.row) : null;
}

/** Стол технаря: копия заказа у него (или сама строка без ОС), иначе его стол. */
function leadTechLink(o: LeadOrder, index: PersonDeskIndex, tech: TechIdentity | null, techHidden: boolean): DeskLink | null {
  if (techHidden) return null;
  const label = `Открыть стол технаря ${tech?.label ?? ""}`.trim();
  if (o.kind === "tech") return index.openable.has(o.pageId) ? { href: deskRowHref(o.pageId, o.tabId || null, o.row.id), label } : null;
  if (o.copy?.deskPageId && index.openable.has(o.copy.deskPageId)) {
    return { href: deskRowHref(o.copy.deskPageId, o.copy.tabId || null, o.copy.id), label };
  }
  const uid = o.techUid ?? tech?.uid ?? null;
  const target = uid ? index.techByUid.get(uid) : undefined;
  return target ? techDeskLink(index, target, o.row) : null;
}

/** Окно подтверждения: что именно уйдёт вместе с заказом. */
function deleteConfirmOptions(
  list: readonly LeadOrder[],
  memberByUid: ReadonlyMap<string, WorkspaceMember>,
  techOf: (o: LeadOrder) => TechIdentity | null
): ConfirmDialogOptions {
  const withExchange = list.some((o) => Boolean(o.row.orderId || o.copy?.orderId));
  const exchangeNote = withExchange ? " Заказ на «Заказах» снимается насовсем — после «Вернуть» его можно выставить заново." : "";
  if (list.length === 1) {
    const o = list[0];
    const os = o.osUid ? memberByUid.get(o.osUid) : undefined;
    const tech = techOf(o);
    const osName = os ? ` ${personLabel(os)}` : "";
    const techName = tech?.label ? ` ${tech.label}` : "";
    const parts: string[] = [];
    if (o.kind === "os") {
      parts.push(`строка на столе ОС${osName}`);
      if (o.copy || o.row.mirrorRowId) parts.push(`копия у технаря${techName}`);
    } else {
      parts.push(`строка на столе технаря${techName}`);
      if (o.row.osUid && o.row.srcRowId) parts.push(`строка на столе ОС${osName}`);
    }
    if (o.row.orderId || o.copy?.orderId) parts.push("заказ на «Заказах»");
    return {
      title: `Удалить заказ «${o.client || "без имени"}»?`,
      description: `Удалится: ${parts.join(", ")}. Сразу после удаления его можно вернуть — кнопкой «Вернуть» или Ctrl+Z.${exchangeNote}`,
      confirmLabel: "Удалить",
      destructive: true,
    };
  }
  const sums = selectionSums(list);
  const money = `Сумма ${formatNumber(sums.price)}${sums.upsell ? `, апсейл ${formatNumber(sums.upsell)}` : ""}.`;
  return {
    title: `Удалить ${formatCount(list.length, ORDER_FORMS)}?`,
    description: `Строки уйдут со столов ОС, выданные копии — у технарей${withExchange ? ", заказы — с «Заказов»" : ""}. ${money} Сразу после удаления их можно вернуть — кнопкой «Вернуть» или Ctrl+Z.${exchangeNote}`,
    confirmLabel: `Удалить ${list.length}`,
    destructive: true,
  };
}

interface SheetTotals {
  count: number;
  cancelled: number;
  /** Суммы без отменённых — как «Грязная касса». */
  price: number;
  upsell: number;
  /** «Итого» строк (после комиссии) без отменённых. */
  net: number;
  open: number;
}

function sheetTotals(orders: readonly LeadOrder[], statusOptions: readonly StatusOption[]): SheetTotals {
  const t: SheetTotals = { count: orders.length, cancelled: 0, price: 0, upsell: 0, net: 0, open: 0 };
  for (const o of orders) {
    if (o.kind === "os" && !isIssued(o)) t.open += 1;
    if (leadIsCancelled(o, statusOptions)) {
      t.cancelled += 1;
      continue;
    }
    t.price += o.price ?? 0;
    t.upsell += o.upsell ?? 0;
    t.net += o.total ?? 0;
  }
  return t;
}

// Порядок — как в таблице Nurba: № · Имя · Получен · Выдан · Номер · Сумма ·
// Апсейл · Менеджер ОС · Статус · Дата сдачи · Технарь · ⋯
const GRID =
  "grid grid-cols-[3rem_minmax(10rem,1.5fr)_5.25rem_4.75rem_minmax(7.5rem,0.9fr)_8rem_8rem_minmax(8.5rem,1fr)_9rem_6.25rem_minmax(9.5rem,1.1fr)_2.5rem]";
/** Клетка: линия справа, как сетка Excel. */
const CELL = "flex h-8 min-w-0 items-center border-r border-border/70";
const HEAD_CELL = "flex h-9 min-w-0 items-center border-r border-border";
/**
 * Фон строки — переменной: закреплённые клетки («№», «Имя») рисуют его сами
 * и непрозрачно, иначе под ними просвечивала бы прокрутка.
 */
const ROW_BG = "[--row-bg:hsl(var(--card))] even:[--row-bg:color-mix(in_srgb,hsl(var(--muted))_42%,hsl(var(--card)))]";
const ROW_SELECTED = "[--row-bg:color-mix(in_srgb,hsl(var(--primary))_16%,hsl(var(--card)))]";
const ROW_HOVER = "hover:[--row-bg:color-mix(in_srgb,hsl(var(--accent))_85%,hsl(var(--card)))]";

function buildGroups(
  orders: readonly LeadOrder[],
  options: readonly StatusOption[],
  cmp: (a: LeadOrder, b: LeadOrder) => number,
  grouped: boolean
): Group[] {
  const sums = (list: readonly LeadOrder[]) => ({
    sum: list.reduce((s, o) => s + (o.total ?? 0), 0),
    price: list.reduce((s, o) => s + (o.price ?? 0), 0),
    upsell: list.reduce((s, o) => s + (o.upsell ?? 0), 0),
  });
  if (!grouped) {
    const list = [...orders].sort(cmp);
    return list.length ? [{ flat: true, value: "__all", label: "Все", color: null, orders: list, ...sums(list) }] : [];
  }
  const approval = approvalStatusValue([...options]);
  const byValue = new Map<string, LeadOrder[]>();
  for (const o of orders) {
    let value = leadStatusOf(o, options);
    if (o.kind === "os" && isApprovalStatusValue(value, options)) value = approval;
    if (!value) value = NO_STATUS;
    const list = byValue.get(value) ?? [];
    list.push(o);
    byValue.set(value, list);
  }
  const order: string[] = [approval, ...options.map((o) => o.value).filter((v) => v !== approval)];
  for (const v of byValue.keys()) if (!order.includes(v) && v !== NO_STATUS) order.push(v);
  order.push(NO_STATUS);
  const out: Group[] = [];
  for (const value of order) {
    const list = byValue.get(value);
    if (!list?.length) continue;
    list.sort(cmp);
    const option = options.find((o) => o.value === value);
    out.push({
      value,
      label: value === NO_STATUS ? "Без статуса" : (option?.label ?? value),
      color: option?.color ?? null,
      orders: list,
      ...sums(list),
    });
  }
  return out;
}

/** Заголовок группы на телефоне (карточки). */
function GroupHeader({ group, collapsed, onToggle }: { group: Group; collapsed: boolean; onToggle: () => void }) {
  if (group.flat) return null;
  const Icon = collapsed ? ChevronRight : ChevronDown;
  const color = group.color ? `hsl(${group.color})` : "hsl(var(--muted-foreground))";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      className="flex h-9 w-full items-center gap-2 border-b border-l-[3px] border-b-border px-2 text-left text-[13px] font-medium sm:rounded-none"
      style={{ borderLeftColor: color, backgroundColor: group.color ? `hsl(${group.color} / 0.10)` : undefined }}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span style={{ color }}>{group.label}</span>
      <span
        className="rounded-full px-1.5 font-mono text-[11px] tabular-nums"
        style={{ backgroundColor: group.color ? `hsl(${group.color} / 0.18)` : "hsl(var(--muted))", color }}
      >
        {group.orders.length}
      </span>
      <span className="ml-auto font-mono text-[12px] tabular-nums text-muted-foreground">{group.sum ? formatNumber(group.sum) : ""}</span>
    </button>
  );
}

/**
 * Строка группы в таблице — как промежуточный итог Excel: название и число
 * заказов в закреплённых столбцах, суммы — под «Суммой» и «Апсейлом».
 */
function GroupRow({ group, collapsed, onToggle }: { group: Group; collapsed: boolean; onToggle: () => void }) {
  const Icon = collapsed ? ChevronRight : ChevronDown;
  const color = group.color ? `hsl(${group.color})` : "hsl(var(--muted-foreground))";
  const bg = group.color
    ? `color-mix(in srgb, hsl(${group.color}) 13%, hsl(var(--card)))`
    : "color-mix(in srgb, hsl(var(--muted)) 70%, hsl(var(--card)))";
  return (
    <div role="row" className={cn(GRID, "h-8 border-b border-border text-[13px] font-semibold")} style={{ backgroundColor: bg }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="sticky left-0 z-[1] col-span-2 flex h-8 min-w-0 items-center gap-2 border-l-[3px] border-r border-r-border/70 px-2 text-left"
        style={{ borderLeftColor: color, backgroundColor: bg }}
      >
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate" style={{ color }}>
          {group.label}
        </span>
        <span className="shrink-0 font-mono text-[11.5px] font-normal tabular-nums text-muted-foreground">· {group.orders.length}</span>
      </button>
      <span className={cn(CELL, "col-span-3")} />
      <span className={cn(CELL, "justify-end px-2 font-mono text-[12.5px] tabular-nums")}>{group.price ? formatNumber(group.price) : ""}</span>
      <span className={cn(CELL, "justify-end px-2 font-mono text-[12.5px] tabular-nums")}>{group.upsell ? formatNumber(group.upsell) : ""}</span>
      <span className="col-span-5" />
    </div>
  );
}

/** Шапка таблицы: закреплена сверху, «№» и «Имя» — ещё и слева. */
function SheetHead({ sort, onSort }: { sort: LeadSort; onSort: (next: LeadSort) => void }) {
  const cur = currencySymbol();
  return (
    <div role="row" className={cn(GRID, "sticky top-0 z-20 border-b-2 border-border bg-muted text-[12px] font-semibold text-foreground/85")}>
      <span className={cn(HEAD_CELL, "sticky left-0 z-[3] justify-center bg-muted font-mono text-[11px] text-muted-foreground")} role="columnheader">
        №
      </span>
      <span className={cn(HEAD_CELL, "sticky left-[3rem] z-[3] bg-muted")} role="columnheader">
        <SortHead column="client" sort={sort} onSort={onSort} label="Имя" />
      </span>
      <span className={HEAD_CELL} role="columnheader">
        <SortHead column="date" sort={sort} onSort={onSort} label="Получен" hint="Порядок по времени внесения в таблицу" />
      </span>
      <span className={cn(HEAD_CELL, "px-2")} role="columnheader">
        Выдан
      </span>
      <span className={cn(HEAD_CELL, "px-2")} role="columnheader">
        Номер
      </span>
      <span className={HEAD_CELL} role="columnheader">
        <SortHead column="sum" sort={sort} onSort={onSort} label={`Сумма, ${cur}`} align="right" />
      </span>
      <span className={HEAD_CELL} role="columnheader">
        <SortHead column="upsell" sort={sort} onSort={onSort} label={`Апсейл, ${cur}`} align="right" />
      </span>
      <span className={HEAD_CELL} role="columnheader">
        <SortHead column="os" sort={sort} onSort={onSort} label="Менеджер ОС" />
      </span>
      <span className={HEAD_CELL} role="columnheader">
        <SortHead column="status" sort={sort} onSort={onSort} label="Статус" />
      </span>
      <span className={HEAD_CELL} role="columnheader">
        <SortHead column="deadline" sort={sort} onSort={onSort} label="Дата сдачи" />
      </span>
      <span className={HEAD_CELL} role="columnheader">
        <SortHead column="tech" sort={sort} onSort={onSort} label="Технарь" />
      </span>
      <span className={cn(HEAD_CELL, "border-r-0")} aria-hidden />
    </div>
  );
}

/** Итоговая строка: закреплена снизу, суммы без отменённых; справа — что значат точки у сумм. */
function TotalsRow({ totals, methods }: { totals: SheetTotals; methods: readonly PaymentMethod[] }) {
  const legend = methods.filter((m) => !m.inactive);
  return (
    <div role="row" className={cn(GRID, "sticky bottom-0 z-20 border-t-2 border-border bg-muted text-[12.5px] font-semibold")}>
      <span className={cn(HEAD_CELL, "sticky left-0 z-[3] col-span-2 gap-1.5 bg-muted px-2")}>
        Итого
        <span className="font-mono font-normal tabular-nums text-muted-foreground">· {formatCount(totals.count, ORDER_FORMS)}</span>
        {totals.cancelled ? (
          <span className="truncate font-normal text-muted-foreground" title="Отменённые заказы в суммы не входят">
            (без {totals.cancelled} отмен.)
          </span>
        ) : null}
      </span>
      <span className={cn(HEAD_CELL, "col-span-3")} />
      <span className={cn(HEAD_CELL, "justify-end px-2 font-mono tabular-nums")}>{formatNumber(totals.price)}</span>
      <span className={cn(HEAD_CELL, "justify-end px-2 font-mono tabular-nums")}>{formatNumber(totals.upsell)}</span>
      <span className="col-span-5 flex h-9 min-w-0 items-center gap-1.5 px-2 font-normal text-muted-foreground">
        <span className="shrink-0">чистыми после комиссии</span>
        <span className="shrink-0 font-mono font-semibold tabular-nums text-foreground">{formatNumber(totals.net)}</span>
        {legend.length ? (
          <span className="ml-auto flex min-w-0 items-center gap-2.5 truncate text-[11.5px]" title="Точка у суммы — способ оплаты">
            {legend.map((m) => (
              <span key={m.id} className="inline-flex shrink-0 items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: m.color ?? "hsl(var(--muted-foreground))" }} aria-hidden />
                {m.label}
                {m.commissionPct ? <span className="opacity-70">−{String(m.commissionPct).replace(".", ",")}%</span> : null}
              </span>
            ))}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/** Сумма и апсейл выделенных — как «Сумма» в строке состояния Excel: все выделенные, отменённые тоже. */
function selectionSums(orders: readonly LeadOrder[]): { price: number; upsell: number } {
  let price = 0;
  let upsell = 0;
  for (const o of orders) {
    price += o.price ?? 0;
    upsell += o.upsell ?? 0;
  }
  return { price, upsell };
}

/** Выделенные строки: сколько, на какую сумму, удалить. Висит над итоговой строкой таблицы. */
function SelectionBar({ orders, onDelete, onClear }: { orders: readonly LeadOrder[]; onDelete: () => void; onClear: () => void }) {
  const t = selectionSums(orders);
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[46px] z-30 flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-popover px-3 py-2 text-[13px] shadow-lg">
        <span className="font-medium">Выбрано {formatCount(orders.length, ORDER_FORMS)}</span>
        <span className="font-mono tabular-nums text-muted-foreground">
          сумма <span className="text-foreground">{formatNumber(t.price)}</span>
        </span>
        <span className="font-mono tabular-nums text-muted-foreground">
          апсейл <span className="text-foreground">{formatNumber(t.upsell)}</span>
        </span>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="destructive" className="h-8 gap-1.5" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" /> Удалить
            <kbd className="hidden rounded border border-destructive-foreground/30 px-1 font-mono text-[10px] lg:inline">Del</kbd>
          </Button>
          <Button size="sm" variant="ghost" className="h-8 gap-1" onClick={onClear} aria-label="Снять выделение">
            <X className="h-3.5 w-3.5" /> Снять
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Заголовок столбца, который сортирует: первый клик — его порядок, повторный — обратный. */
function SortHead({
  column,
  sort,
  onSort,
  label,
  align = "left",
  hint,
}: {
  column: LeadSortColumn;
  sort: LeadSort;
  onSort: (next: LeadSort) => void;
  label: string;
  align?: "left" | "right";
  hint?: string;
}) {
  const active = sortColumnOf(sort);
  const on = active.column === column;
  const Arrow = !on ? ArrowDownUp : active.dir === "desc" ? ArrowDown : ArrowUp;
  return (
    <button
      type="button"
      onClick={() => onSort(nextSortForColumn(column, sort))}
      aria-sort={on ? (active.dir === "desc" ? "descending" : "ascending") : "none"}
      title={on ? LEAD_SORT_LABELS[sort] : (hint ?? "Сортировать")}
      className={cn(
        "group flex h-full w-full min-w-0 items-center gap-1 px-2 hover:bg-accent/60 hover:text-foreground",
        align === "right" && "justify-end",
        on && "text-primary"
      )}
    >
      <span className="truncate">{label}</span>
      <Arrow className={cn("h-3 w-3 shrink-0", on ? "opacity-100" : "opacity-0 group-hover:opacity-60")} aria-hidden />
    </button>
  );
}

/** «Порядок: …» — все виды сортировки списком. */
function SortMenu({
  sort,
  defaultSort,
  onSort,
  className,
}: {
  sort: LeadSort;
  defaultSort: LeadSort;
  onSort: (next: LeadSort) => void;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={cn(pageChipClass(sort !== defaultSort), "h-9 gap-1.5", className)} aria-label="Порядок строк">
          <ArrowDownUp className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">Порядок: {LEAD_SORT_LABELS[sort]}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[14rem]">
        {LEAD_SORT_SECTIONS.map((section, i) => (
          <div key={section.title}>
            {i > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{section.title}</DropdownMenuLabel>
            {section.sorts.map((key) => (
              <DropdownMenuItem key={key} onSelect={() => onSort(key)}>
                {LEAD_SORT_LABELS[key]}
                {key === defaultSort ? <span className="text-[11px] text-muted-foreground">· по умолчанию</span> : null}
                {key === sort ? <Check className="ml-auto h-3.5 w-3.5" /> : null}
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Технарь и его статус. Статус у технаря — точкой, а словом только когда он
 * РАСХОДИТСЯ со статусом заказа (иначе он дублировал бы столбец «Статус» и
 * обрезался до «Гото…»).
 */
function TechStatusMark({ order, statusOptions, full }: { order: LeadOrder; statusOptions: readonly StatusOption[]; full?: boolean }) {
  if (order.kind !== "os" || !order.techStatus) return null;
  const option = statusOptions.find((o) => o.value === order.techStatus);
  const label = option?.label ?? order.techStatus;
  const color = option ? `hsl(${option.color})` : "hsl(var(--muted-foreground))";
  const differs = order.techStatus !== leadStatusOf(order, statusOptions);
  if (!differs) {
    return full ? null : <span className="ml-auto h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} title={`У технаря: ${label}`} aria-label={`У технаря: ${label}`} />;
  }
  return (
    <span className="ml-auto inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px]" title={`У технаря: ${label}`}>
      {full ? <span className="text-muted-foreground">у технаря:</span> : <Wrench className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="у технаря" />}
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      <span style={{ color }}>{label}</span>
    </span>
  );
}

/** Стол технаря закрыт «только для Owner» — копии не видно, «не выдан» было бы неправдой. */
const TECH_DESK_HIDDEN_LABEL = "стол технаря закрыт Owner";

function HiddenDeskMark() {
  return (
    <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground" title={TECH_DESK_HIDDEN_LABEL}>
      <Lock className="h-3 w-3" aria-label={TECH_DESK_HIDDEN_LABEL} />
    </span>
  );
}

/** «Технарь» в строке таблицы: ник цветной точкой, рядом — его статус, если он другой. */
function TechCell({ order, d, statusOptions }: { order: LeadOrder; d: RowDerived; statusOptions: readonly StatusOption[] }) {
  const { tech, techHidden, techColor } = d;
  if (!tech) {
    if (techHidden) {
      return (
        <span className="flex min-w-0 items-center gap-1 px-2 text-[12px] text-muted-foreground" title={TECH_DESK_HIDDEN_LABEL}>
          <Lock className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">{TECH_DESK_HIDDEN_LABEL}</span>
        </span>
      );
    }
    return <span className="px-2 text-[12.5px] text-muted-foreground">{order.kind === "os" ? "не выдан" : "—"}</span>;
  }
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2 px-2">
      <NickText
        label={tech.label ?? "ник не найден"}
        color={techColor}
        tone={tech.issue ? "warning" : undefined}
        title={techIdentityTitle(tech)}
      />
      {order.kind === "os" && order.techStatus ? (
        <TechStatusMark order={order} statusOptions={statusOptions} />
      ) : techHidden ? (
        <HiddenDeskMark />
      ) : order.kind === "os" && !order.copy ? (
        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground" title="Технарь выбран, заказ едет к нему">
          едет
        </span>
      ) : null}
    </span>
  );
}

type RowDateSlots = ReturnType<typeof osDateSlots> | null;

/** Даты строки ОС — один расчёт на строку (в нём часы по поясу компании). */
function rowDateSlots(order: LeadOrder): RowDateSlots {
  return order.kind === "os"
    ? osDateSlots(order.row, { upsellKey: order.keys.upsell || "upsell", mirrorCreatedAt: order.copy?.createdAt ?? null })
    : null;
}

/** «Получен»: дата, которую поставил ОС, иначе — день внесения в таблицу (бледно). */
function ReceivedCell({ order, slots }: { order: LeadOrder; slots: RowDateSlots }) {
  let shown: number | null;
  let set = true;
  if (slots) {
    shown = slotShown(slots.received);
    set = slots.received.value !== null;
  } else {
    shown = order.dateMs || null;
  }
  const title = [
    shown ? `Получен ${formatFullDate(shown)}${set ? "" : " — по времени внесения"}` : "",
    order.enteredAt ? `Внесён в таблицу ${formatDate(order.enteredAt, "dd.MM.yyyy HH:mm")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <span className={cn("truncate px-2 font-mono text-[12px] tabular-nums", !set && "text-muted-foreground")} title={title || undefined}>
      {shown ? formatDayMonth(shown) : "—"}
    </span>
  );
}

/** «Выдан»: день выдачи технарю (у строки технаря с ОС — когда копия легла к нему). */
function IssuedCell({ order, slots }: { order: LeadOrder; slots: RowDateSlots }) {
  let shown: number | null = null;
  let set = true;
  if (slots) {
    shown = slotShown(slots.issued);
    set = slots.issued.value !== null;
  } else if (order.row.osUid) {
    shown = typeof order.row.createdAt === "number" && order.row.createdAt > 0 ? order.row.createdAt : null;
  }
  const title = shown
    ? `Выдан технарю ${formatFullDate(shown)}${set ? "" : " — по времени выдачи"}`
    : order.kind === "os"
      ? order.techNick
        ? "Технарь выбран, заказ едет к нему"
        : "Технарю ещё не выдан"
      : "Заказ со стола технаря";
  return (
    <span className={cn("truncate px-2 font-mono text-[12px] tabular-nums", (!set || !shown) && "text-muted-foreground")} title={title}>
      {shown ? formatDayMonth(shown) : "—"}
    </span>
  );
}

/** «Дата сдачи» — дедлайн из визитки; прошёл, а заказ не закрыт — красным. Нажатие открывает визитку. */
function DeadlineCell({ order, statusOptions, onOpen }: { order: LeadOrder; statusOptions: readonly StatusOption[]; onOpen: () => void }) {
  const deadline = leadDeadlineOf(order);
  const overdue = deadline !== null && deadline < almatyMidnightMillis(Date.now()) && !leadIsClosed(order, statusOptions);
  return (
    <button
      type="button"
      onClick={onOpen}
      title={deadline !== null ? `Сдать до ${formatFullDate(deadline)}${overdue ? " — срок прошёл" : ""}` : "Срок сдачи — в визитке клиента"}
      className={cn(
        "flex h-8 w-full items-center px-2 font-mono text-[12px] tabular-nums hover:bg-accent/60",
        deadline === null ? "text-muted-foreground/50" : overdue ? "font-semibold text-destructive" : "text-foreground"
      )}
    >
      {deadline === null ? "—" : formatDayMonth(deadline)}
    </button>
  );
}

/**
 * «↗ открыть стол» в строке таблицы — обычная ссылка, переход через страницу.
 * Не `<Link>`/`DeskLinkButton`: те подписаны на адрес, и смена порядка или
 * фильтра (это `?sort=`/`?f=`) перерисовывала бы по две ссылки в каждой из
 * сотен строк. Ctrl/Cmd/Shift — открыть как обычную ссылку (новая вкладка).
 */
function SheetDeskLink({ link, onGo }: { link: DeskLink | null; onGo: (href: string) => void }) {
  if (!link) return null;
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    <a
      href={link.href}
      title={link.label}
      aria-label={link.label}
      data-desk-link=""
      onPointerDown={stop}
      onMouseDown={stop}
      onDoubleClick={stop}
      onClick={(e) => {
        e.stopPropagation();
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        onGo(link.href);
      }}
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-primary/10 hover:text-primary [@media(pointer:coarse)]:h-7 [@media(pointer:coarse)]:w-7"
    >
      <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
    </a>
  );
}

/**
 * «⋯» строки: карточка и удаление. Открывается и правым кликом по строке.
 * Меню Radix создаётся только у ОТКРЫТОЙ строки: сотни закрытых меню
 * заметно замедляли первый показ таблицы, а у закрытой хватает кнопки.
 */
function RowMenu({
  order,
  open,
  selectedCount,
  actions,
}: {
  order: LeadOrder;
  open: boolean;
  selectedCount: number;
  actions: RowActions;
}) {
  const trigger = (
    <button
      type="button"
      aria-label="Действия с заказом"
      aria-haspopup="menu"
      aria-expanded={open}
      title="Действия с заказом"
      onClick={open ? undefined : () => actions.menu(order.key)}
      className="flex h-8 w-full items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
    >
      <MoreHorizontal className="h-4 w-4" />
    </button>
  );
  if (!open) return trigger;
  return (
    <DropdownMenu open onOpenChange={(v) => actions.menu(v ? order.key : null)}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[14rem]">
        <DropdownMenuLabel className="truncate text-[12px] font-normal text-muted-foreground">{order.client || "Без имени"}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => actions.open(order.key)} className="gap-2">
          <IdCard className="h-3.5 w-3.5" /> Карточка и история
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {selectedCount > 1 ? (
          <DropdownMenuItem onSelect={() => actions.removeSelected()} className="gap-2 text-destructive focus:text-destructive">
            <Trash2 className="h-3.5 w-3.5" /> Удалить выбранные ({selectedCount})…
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => actions.remove(order)} className="gap-2 text-destructive focus:text-destructive">
          <Trash2 className="h-3.5 w-3.5" /> Удалить заказ…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const RowNumbers = createContext<ReadonlyMap<string, number>>(new Map());

/** «№» строки: номер из контекста, нажатие — выделение (Shift — диапазон, Ctrl — добавить). */
function RowNumberButton({ orderKey, selected, onSelect }: { orderKey: string; selected: boolean; onSelect: (key: string, e: ReactMouseEvent) => void }) {
  const num = useContext(RowNumbers).get(orderKey) ?? 0;
  return (
    <button
      type="button"
      onClick={(e) => onSelect(orderKey, e)}
      aria-pressed={selected}
      aria-label={`Строка ${num}: выделить`}
      data-row-number=""
      title="Выделить строку · Shift — диапазон, Ctrl — добавить"
      className={cn(
        "h-full w-full font-mono text-[11px] tabular-nums text-muted-foreground hover:bg-accent hover:text-foreground",
        selected && "bg-primary/25 font-semibold text-primary hover:bg-primary/30 hover:text-primary"
      )}
    >
      {num}
    </button>
  );
}

/**
 * Строка таблицы. «Зебра» — на CSS (:nth-child), номер — из контекста
 * (`RowNumberButton`): при смене порядка строки только переставляются, а
 * перерисовываются одни номера. Строка вне экрана не раскладывается и не
 * рисуется (`content-visibility: auto`, высота строки известна — 33 px): смена
 * порядка на 350 заказах — десятки миллисекунд, а не полсекунды.
 */
const LeadRow = memo(function LeadRow({
  order,
  selected,
  selectedCount,
  menuOpen,
  d,
  osMembers,
  statusOptions,
  methods,
  actions,
}: {
  order: LeadOrder;
  selected: boolean;
  /** Сколько выделено — только у выделенной строки (у остальных 0, чтобы не перерисовывать их). */
  selectedCount: number;
  menuOpen: boolean;
  d: RowDerived;
  osMembers: readonly WorkspaceMember[];
  statusOptions: readonly StatusOption[];
  methods: readonly PaymentMethod[];
  actions: RowActions;
}) {
  const k = order.keys;
  const fromLead = Boolean(order.row.cells[LEAD_BY_KEY]);
  const slots = rowDateSlots(order);
  const effective = leadStatusOf(order, statusOptions);
  const shownStatus = effective || (order.kind === "os" ? approvalStatusValue([...statusOptions]) : "");
  const payDot = (colKey: string) =>
    order.kind === "os" && colKey ? (
      <PaymentChip row={order.row} colKey={colKey} methods={methods} canEdit dot onPick={(m) => actions.pay(order, colKey, m)} />
    ) : null;
  return (
    <div
      role="row"
      aria-selected={selected}
      className={cn(
        GRID,
        "group/row border-b border-border/70 bg-[var(--row-bg)] text-[13px] [content-visibility:auto] [contain-intrinsic-size:auto_33px]",
        selected ? ROW_SELECTED : cn(ROW_BG, ROW_HOVER)
      )}
      onContextMenu={(e) => {
        // Правый клик — меню строки (как «Удалить строку» в Excel); в поле ввода — обычное меню браузера.
        if ((e.target as HTMLElement).closest("input, textarea")) return;
        e.preventDefault();
        actions.menu(order.key);
      }}
    >
      <div className={cn(CELL, "sticky left-0 z-[1] justify-center bg-[var(--row-bg)]")}>
        <RowNumberButton orderKey={order.key} selected={selected} onSelect={actions.select} />
      </div>
      <div className={cn(CELL, "sticky left-[3rem] z-[1] border-r-border bg-[var(--row-bg)]")}>
        <button
          type="button"
          onClick={() => actions.open(order.key)}
          title="Открыть карточку клиента"
          className="group/name flex h-8 w-full min-w-0 items-center gap-1.5 px-2 text-left"
        >
          <IdCard className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover/name:text-primary" aria-hidden />
          <span className="truncate underline-offset-2 group-hover/name:text-primary group-hover/name:underline">
            {order.client || <span className="text-muted-foreground">без имени</span>}
          </span>
          {fromLead ? (
            <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded bg-primary/10 px-1 text-[10px] uppercase tracking-wide text-primary" title="Завёл Тимлид+">
              <Sparkles className="h-3 w-3" /> лид
            </span>
          ) : null}
        </button>
      </div>
      <div className={CELL}>
        <ReceivedCell order={order} slots={slots} />
      </div>
      <div className={CELL}>
        <IssuedCell order={order} slots={slots} />
      </div>
      <div className={CELL}>
        <EditableText
          value={order.phone}
          ariaLabel="Номер"
          inputMode="tel"
          disabled={!k.phone}
          className="h-8 rounded-none px-2"
          onCommit={(v) => actions.cell(order, k.phone, v)}
        />
      </div>
      <div className={cn(CELL, "gap-0.5 pl-1")}>
        {payDot(k.price)}
        <EditableText
          value={order.price === null ? "" : String(order.price)}
          display={order.price === null ? "" : formatNumber(order.price)}
          ariaLabel="Сумма"
          inputMode="decimal"
          align="right"
          disabled={!k.price}
          className="h-8 rounded-none px-2"
          onCommit={(v) => actions.cell(order, k.price, v)}
        />
      </div>
      <div className={cn(CELL, "gap-0.5 pl-1")}>
        {payDot(k.upsell)}
        <EditableText
          value={order.upsell === null ? "" : String(order.upsell)}
          display={order.upsell === null ? "" : formatNumber(order.upsell)}
          ariaLabel="Апсейл"
          inputMode="decimal"
          align="right"
          disabled={order.kind !== "os"}
          className="h-8 rounded-none px-2"
          onCommit={(v) => actions.cell(order, k.upsell, v)}
        />
      </div>
      <div className={cn(CELL, "gap-0.5 pr-1")}>
        <div className="min-w-0 flex-1">
          <OsPicker
            current={d.os}
            osMembers={osMembers}
            disabled={order.kind !== "os"}
            onPick={(m) => actions.moveOs(order, m)}
            dot={{ color: d.osColor }}
            className="h-8 rounded-none px-2"
          />
        </div>
        <SheetDeskLink link={d.osLink} onGo={actions.go} />
      </div>
      <div className={cn(CELL, "items-stretch")}>
        <LeadStatusPicker
          variant="cell"
          value={shownStatus}
          options={statusOptions}
          derived={effective !== order.status}
          disabled={!k.status}
          onPick={(v) => void actions.cell(order, k.status, v)}
        />
      </div>
      <div className={CELL}>
        <DeadlineCell order={order} statusOptions={statusOptions} onOpen={() => actions.open(order.key)} />
      </div>
      <div className={cn(CELL, "gap-0.5 pr-1")}>
        <TechCell order={order} d={d} statusOptions={statusOptions} />
        <SheetDeskLink link={d.techLink} onGo={actions.go} />
      </div>
      <div className="flex h-8 min-w-0 items-center">
        <RowMenu order={order} open={menuOpen} selectedCount={selectedCount} actions={actions} />
      </div>
    </div>
  );
});

function LeadMobileCard({
  order,
  os,
  tech,
  techHidden,
  statusOptions,
  onOpen,
  osColor,
  techColor,
}: {
  order: LeadOrder;
  os: WorkspaceMember | null;
  tech: TechIdentity | null;
  techHidden: boolean;
  statusOptions: readonly StatusOption[];
  onOpen: () => void;
  osColor: string | null;
  techColor: string | null;
}) {
  const deadline = leadDeadlineOf(order);
  const overdue = deadline !== null && deadline < almatyMidnightMillis(Date.now()) && !leadIsClosed(order, statusOptions);
  return (
    <button type="button" onClick={onOpen} className="flex w-full min-w-0 flex-col gap-1.5 rounded-xl border border-border bg-card px-3 py-2.5 text-left">
      <div className="flex min-w-0 items-center gap-2">
        <IdCard className="h-4 w-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{order.client || "без имени"}</span>
        <span className="shrink-0 font-mono text-[13px] tabular-nums">{order.total === null ? "—" : formatNumber(order.total)}</span>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <MobileStatusPill order={order} statusOptions={statusOptions} />
        <TechStatusMark order={order} statusOptions={statusOptions} full />
      </div>
      <div className="flex min-w-0 items-center gap-2 text-[12px] text-muted-foreground">
        <span className="truncate">{order.phone || "без номера"}</span>
        {deadline !== null ? (
          <span className={cn("shrink-0 font-mono tabular-nums", overdue && "font-semibold text-destructive")}>до {formatDayMonth(deadline)}</span>
        ) : null}
        <span className="ml-auto shrink-0 font-mono tabular-nums">{order.dateMs ? formatDayMonth(order.dateMs) : ""}</span>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 max-w-[45%]">
          {os ? (
            <PersonPill color={osColor}>
              <OsLabel member={os} />
            </PersonPill>
          ) : (
            <OsLabel member={os} />
          )}
        </span>
        <span className="text-muted-foreground">→</span>
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {tech ? (
            <PersonPill color={techColor}>
              <TechBadge identity={tech} />
            </PersonPill>
          ) : (
            <span className="text-[12.5px] text-muted-foreground">{techHidden ? TECH_DESK_HIDDEN_LABEL : "не выдан"}</span>
          )}
          {tech && techHidden ? <HiddenDeskMark /> : null}
        </span>
      </div>
    </button>
  );
}

function MobileStatusPill({ order, statusOptions }: { order: LeadOrder; statusOptions: readonly StatusOption[] }) {
  const effective = leadStatusOf(order, statusOptions);
  const shown = effective || (order.kind === "os" ? approvalStatusValue([...statusOptions]) : "");
  if (!shown || !statusOptions.some((o) => o.value === shown)) {
    return <span className="rounded-full border border-dashed border-border px-2.5 py-[3px] text-[11px] text-muted-foreground">без статуса</span>;
  }
  return <StatusBadge value={shown} options={[...statusOptions]} className="max-w-none shrink-0" />;
}

function pct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}

/** Сводка по видимым заказам — одним блоком с сеткой, как шапка отчёта. */
function LeadStatsStrip({ stats }: { stats: LeadStats }) {
  const tiles: Array<{ label: string; value: string; sub?: string; tone?: string }> = [
    { label: "Заказов", value: String(stats.count), sub: stats.approval ? `на утверждении ${stats.approval}` : undefined },
    { label: "В работе", value: String(stats.inWork), sub: [stats.payment ? `ждём оплату ${stats.payment}` : "", stats.freeze ? `заморозка ${stats.freeze}` : ""].filter(Boolean).join(" · ") || undefined },
    { label: "Готово", value: String(stats.done), sub: stats.cancelled ? `отменено ${stats.cancelled}` : undefined, tone: "text-success" },
    { label: "Грязная касса", value: formatNumber(stats.gross), sub: "цена + апсейл до комиссии" },
    { label: "Чистая касса", value: formatNumber(stats.net), sub: `после комиссии · в «Готово» ${formatNumber(stats.doneNet)}` },
    { label: "Апсейл", value: formatNumber(stats.upsell), sub: `${formatCount(stats.upsellCount, ORDER_FORMS)}` },
    { label: "Апсейл готово", value: formatNumber(stats.upsellDone), sub: "апсейл заказов в «Готово»", tone: "text-success" },
    { label: "KPI общий", value: pct(stats.kpi), sub: "«Готово» из всех, без отменённых", tone: "text-primary" },
  ];
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4 xl:grid-cols-8">
      {tiles.map((t) => (
        <div key={t.label} className="min-w-0 bg-card px-3 py-1.5">
          <p className="text-[10.5px] font-medium uppercase leading-tight tracking-[0.08em] text-muted-foreground">{t.label}</p>
          <p className={cn("font-mono text-[1.05rem] tabular-nums leading-snug", t.tone)}>{t.value}</p>
          {t.sub ? (
            <p className="truncate text-[11px] leading-snug text-muted-foreground" title={t.sub}>
              {t.sub}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Окно таблицы по высоте экрана
// ---------------------------------------------------------------------------

function scrollParentOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if (oy === "auto" || oy === "scroll") return p;
  }
  return null;
}

/**
 * Высота окна таблицы: от её верха до низа экрана (когда страница вверху),
 * чтобы закреплённые шапка и итоги были видны сразу, без прокрутки страницы.
 * Места мало (низкий экран) — окно почти во весь экран, страница докручивается.
 * Высота ставится прямо в стиль, без состояния React: перерисовка страницы с
 * сотнями строк ради одной высоты стоила лишнего прохода раскладки.
 * `onFit` — после каждой смены высоты (держать окно у последних строк).
 */
function useFillHeight(target: RefObject<HTMLElement | null>, root: RefObject<HTMLElement | null>, enabled: boolean, onFit: () => void): void {
  const onFitRef = useRef(onFit);
  useLayoutEffect(() => {
    onFitRef.current = onFit;
  });
  useLayoutEffect(() => {
    const el = target.current;
    if (!enabled || !el) return;
    const parent = scrollParentOf(el);
    let last = -1;
    const measure = () => {
      const viewTop = parent ? parent.getBoundingClientRect().top : 0;
      const viewH = parent ? parent.clientHeight : window.innerHeight;
      const scrolled = parent ? parent.scrollTop : window.scrollY;
      const offset = el.getBoundingClientRect().top - viewTop + scrolled;
      const fit = Math.floor(viewH - offset - 16);
      const next = Math.max(320, fit >= 420 ? fit : viewH - 24);
      if (Math.abs(next - last) < 2) return;
      last = next;
      el.style.maxHeight = `${next}px`;
      onFitRef.current();
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (parent) ro.observe(parent);
    if (root.current) ro.observe(root.current);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      el.style.maxHeight = "";
    };
  }, [target, root, enabled]);
}
