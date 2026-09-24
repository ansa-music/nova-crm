import type { CellActionView } from "@/components/table/CellActionButton";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CheckCheck, Copy, CopyPlus, Filter, FilterX, Maximize2, Plus, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { LayoutGroup } from "framer-motion";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ColumnHeaderCell } from "@/components/table/ColumnHeaderCell";
import { TableRow, createCellActionPulse } from "@/components/table/TableRow";
import { GroupHeaderRow } from "@/components/table/GroupHeaderRow";
import { TableToolbar } from "@/components/table/TableToolbar";
import { QuickOrderDialog } from "@/components/table/QuickOrderDialog";
import { buildQuickOrderRow, findQuickOrderColumns, parseOptionalNumber, type QuickOrderInput } from "@/utils/quickOrder";
import {
  captureTableView,
  loadSavedTableViews,
  writeSavedTableViews,
  type SavedTableView,
} from "@/utils/savedTableViews";
import { KanbanView } from "@/components/table/KanbanView";
import { CardListView } from "@/components/table/CardListView";
import { TablePagination } from "@/components/table/TablePagination";
import { FilterPopover, type FilterValueEntry } from "@/components/table/FilterPopover";
import { ActiveFiltersBar, type ActiveFilterChip } from "@/components/table/ActiveFiltersBar";
import type { BulkOptionColumn } from "@/components/table/BulkActionBar";
import {
  computeAggregate,
  defaultAggregateFor,
  loadColumnAggregates,
  summarizeSelection,
  type AggregateKind,
} from "@/utils/columnAggregates";
import { normalizeNumericInput, parseLooseNumber } from "@/utils/numberInput";
import { confirmDialog, promptDialog } from "@/utils/appDialog";
import { DATE_PRESET_LABELS, isInDatePreset, type DatePreset } from "@/utils/dateRanges";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/sonner";
import { isRowsMigratingError } from "@/utils/dbError";
import { cellLockReason, rowDeleteLockReason, type RowViewer } from "@/utils/managedRow";
import {
  addRow as addRowServiceBase,
  deleteRow as deleteRowServiceBase,
  duplicateRow as duplicateRowServiceBase,
  reorderRows as reorderRowsBase,
  updateRowCell as updateRowCellBase,
  updateRowCellsBulk as updateRowCellsBulkBase,
  updateRowCellsWithHistory,
  updateRowHeight as updateRowHeightBase,
  updatePageColumns as updatePageColumnsBase,
  addColumn as addColumnServiceBase,
  renameColumn as renameColumnServiceBase,
  changeColumnType as changeColumnTypeServiceBase,
  duplicateColumn as duplicateColumnServiceBase,
  deleteColumn as deleteColumnServiceBase,
  clearRowHighlights,
  applyColumnLayout,
  schedulePageColumnsLayout,
  type ColumnLayoutPatch,
} from "@/services/pageService";
import {
  addSubPageRow,
  deleteSubPageRow,
  duplicateSubPageRow,
  reorderSubPageRows,
  updateSubPageRowCell,
  updateSubPageRowCellsBulk,
  updateSubPageRowHeight,
  updateSubPageColumns,
  setTabRowOrderManual,
  addSubPageColumn,
  renameSubPageColumn,
  changeSubPageColumnType,
  duplicateSubPageColumn,
  deleteSubPageColumn,
} from "@/services/subPageService";
import { AddColumnDialog } from "@/components/table/AddColumnDialog";
import { ManageOptionsDialog } from "@/components/table/ManageOptionsDialog";
import { TableSchemaEditor } from "@/components/table/TableSchemaEditor";
import { RowCommentsPanel } from "@/components/chat/RowCommentsPanel";
import { RowCardSheet } from "@/components/table/RowCardSheet";
import { hasRowExtras, type RowExtras } from "@/utils/rowExtras";
import { BulkActionBar } from "@/components/table/BulkActionBar";
import { useUnsavedGuard } from "@/hooks/useUnsavedGuard";
import { usePendingCellWrites } from "@/hooks/usePendingCellWrites";
import { useWorkspace } from "@/hooks/useWorkspace";
import { usePermissions } from "@/hooks/usePermissions";
import { useUiStore } from "@/store/uiStore";
import { updateResponsibleOptions, updateCustomFieldOptions, updateStatusOptions } from "@/services/workspaceService";
import { formatCount, formatCurrency, formatCurrencyCell, formatNumber, downloadCsv } from "@/utils";
import { formatOrderDate } from "@/utils/date";
import { isSummableColumn, sumNumericCells } from "@/utils/tableAggregates";
import { isBlankRow, isFilledCellValue } from "@/utils/blankRow";
import { clampColumnWidth } from "@/utils/tableLayout";
import {
  getColumnOptions,
  isDoneStatusLabel,
  isOptionColumn,
  splitOptionsByActivity,
  DEFAULT_STATUS_OPTIONS,
  NOT_DONE_STATUS_FILTER,
  findDoneStatusOption,
  findInProgressStatusOption,
  isWaitingStatusLabel,
} from "@/utils/columnOptions";
import type { DeskSummary, DeskTableActions } from "@/types/deskSummary";
import { isHttpUrl, parseHttpUrl } from "@/utils/httpUrl";
import { parseClipboardMatrix } from "@/utils/clipboardMatrix";
import {
  peekTableClipboard,
  readTableClipboard,
  setTableClipboard,
  type TableClipboardKind,
  type TableClipboardPayload,
} from "@/utils/tableClipboard";
import { guessPasteMapping } from "@/utils/pasteMapping";
import { SmartPasteDialog, type SmartPasteRequest, type SmartPasteResult } from "@/components/table/SmartPasteDialog";
import { celebrateDone } from "@/utils/confetti";
import { pushUndoCommand, undo as undoLastCommand } from "@/utils/undoStore";
import type {
  CellAddress,
  ColumnType,
  CustomFieldDef,
  PageColumn,
  PageRow,
  SortState,
  StatusOption,
  WorkspacePage,
  TableViewMode,
} from "@/types";

// Плотность по макету «C — плотный»: 34px в компактном режиме, это и есть
// строка стола по умолчанию. На таче высота всё равно поднимается до 52.
const DENSITY_ROW_HEIGHT: Record<"compact" | "default" | "comfortable", number> = {
  compact: 34,
  default: 40,
  comfortable: 48,
};

type CellValue = string | number | null | undefined;

// Настройки датчика перетаскивания — константа модуля. Объект прямо в
// useSensor(...) был новым на каждый рендер: dnd-kit пересобирал датчики,
// а за ними контекст DndContext, и КАЖДАЯ строка (useSortable) и шапка
// столбца перерисовывались на любой рендер таблицы мимо memo.
const POINTER_SENSOR_OPTIONS = { activationConstraint: { distance: 4 } };

/** Высота заголовка группы до замера (GroupHeaderRow: 44 на узком экране, ~30 на ПК). */
const GROUP_HEADER_ESTIMATE_PX = 30;
const GROUP_HEADER_ESTIMATE_NARROW_PX = 44;

/** Виртуализируем, когда элементов тела (строк + заголовков групп) больше этого. */
const VIRTUALIZE_AFTER = 80;

/**
 * Тело таблицы — плоский список: заголовок группы | строка. Один список и
 * при группировке, и без неё: виртуализатор режет его одинаково, а `index`
 * строки — её место в visibleRows (номер, зебра, клавиатура, заливка).
 */
type BodyItem =
  | {
      kind: "group";
      label: string;
      count: number;
      collapsed: boolean;
      color?: string;
      sumText: string | null;
      doneText: string | null;
      hint: string | null;
    }
  | { kind: "row"; row: PageRow; index: number };

function bodyItemKey(item: BodyItem): string {
  return item.kind === "group" ? `group:${item.label}` : item.row.id;
}

/** Деньги группы для её заголовка: сумма по денежному столбцу и доля «Готово». */
function groupSumsOf(
  groupRows: PageRow[],
  currencyCol: PageColumn | null,
  statusCol: PageColumn | null,
  statusOptions: StatusOption[]
): { sumText: string | null; doneText: string | null } {
  if (!currencyCol) return { sumText: null, doneText: null };
  let sum = 0;
  let done = 0;
  for (const row of groupRows) {
    const n = parseLooseNumber(String(row.cells[currencyCol.key] ?? ""));
    if (n === null) continue;
    sum += n;
    if (statusCol) {
      const rawStatus = String(row.cells[statusCol.key] ?? "");
      const label = statusOptions.find((o) => o.value === rawStatus)?.label ?? rawStatus;
      if (isDoneStatusLabel(label)) done += n;
    }
  }
  if (sum === 0 && done === 0) return { sumText: null, doneText: null };
  return { sumText: formatCurrency(sum), doneText: statusCol && done > 0 ? formatCurrency(done) : null };
}

const NO_OPTIONS: StatusOption[] = [];
const NO_CUSTOM_FIELDS: CustomFieldDef[] = [];

function isEmptySortValue(value: CellValue, type?: ColumnType): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return true;
    if (type === "number" || type === "currency") return Number.isNaN(Number(trimmed));
    if (type === "date") {
      const n = Number(trimmed);
      return Number.isNaN(n);
    }
    return false;
  }
  if (typeof value === "number") return Number.isNaN(value);
  return false;
}

function compareFilledValues(av: CellValue, bv: CellValue, type: ColumnType | undefined, dir: "asc" | "desc"): number {
  let cmp = 0;
  if (type === "number" || type === "currency") {
    cmp = Number(av) - Number(bv);
  } else if (type === "date") {
    cmp = Number(av) - Number(bv);
  } else {
    cmp = String(av).localeCompare(String(bv), "ru");
  }
  return dir === "asc" ? cmp : -cmp;
}

function isEmptyGroupLabel(label: string): boolean {
  return label.trim() === "";
}

function sortStorageKey(viewKey: string) {
  return `nova-crm:table-sort:${viewKey}`;
}

function groupStorageKey(viewKey: string) {
  return `nova-crm:table-group:${viewKey}`;
}

/**
 * Группировка по умолчанию — столбец-статус: стол по макету читается блоками
 * «В работе / Ждём оплату / Готово» с суммами в заголовках. Нет статуса —
 * без группировки.
 */
function defaultGroupByKey(columns: PageColumn[]): string | null {
  return columns.find((c) => c.type === "status" && !c.hidden)?.key ?? null;
}

/**
 * Запомненная группировка вкладки (по образцу readPersistedSortState).
 * Пустая строка в хранилище — человек ЯВНО выключил группы; нет записи —
 * умолчание по статусу. Ключ пропавшего столбца тоже сводится к умолчанию,
 * иначе все строки легли бы в одну безымянную группу.
 */
function readPersistedGroupBy(viewKey: string, columns: PageColumn[]): string | null {
  const fallback = defaultGroupByKey(columns);
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(groupStorageKey(viewKey));
    if (raw === null) return fallback;
    if (raw === "") return null;
    // Скрытый столбец группировать нельзя: его варианты не резолвятся в
    // подписи, и группы читались бы сырыми `in_progress`/`done`.
    return columns.some((c) => c.key === raw && !c.hidden) ? raw : fallback;
  } catch {
    return fallback;
  }
}

function writePersistedGroupBy(viewKey: string, key: string | null) {
  try {
    window.localStorage.setItem(groupStorageKey(viewKey), key ?? "");
  } catch {
    // Приватный режим / запрет на хранилище — группировка просто не запомнится.
  }
}

function readPersistedSortState(viewKey: string): SortState {
  if (typeof window === "undefined") return { colKey: null, direction: null };
  try {
    const raw = window.localStorage.getItem(sortStorageKey(viewKey));
    if (!raw) return { colKey: null, direction: null };
    const parsed = JSON.parse(raw) as Partial<SortState>;
    if (
      typeof parsed.colKey === "string" &&
      parsed.colKey &&
      (parsed.direction === "asc" || parsed.direction === "desc")
    ) {
      return { colKey: parsed.colKey, direction: parsed.direction };
    }
  } catch {
    // fall through to createdAt default
  }
  return { colKey: null, direction: null };
}

/** Ledger key: row creation time. Never updatedAt, never Date.now() fallback. */
function rowCreatedAtMs(row: PageRow): number {
  const value = row.createdAt as unknown;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object") {
    const ts = value as { toMillis?: () => number; seconds?: number };
    if (typeof ts.toMillis === "function") {
      const n = ts.toMillis();
      if (Number.isFinite(n)) return n;
    }
    if (typeof ts.seconds === "number" && Number.isFinite(ts.seconds)) return ts.seconds * 1000;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (typeof row.order === "number" && Number.isFinite(row.order)) return row.order;
  return 0;
}

function compareRowsByCreatedAt(a: PageRow, b: PageRow): number {
  const delta = rowCreatedAtMs(a) - rowCreatedAtMs(b);
  if (delta !== 0) return delta;
  return a.id.localeCompare(b.id);
}

function rowOrderValue(row: PageRow): number {
  return typeof row.order === "number" && Number.isFinite(row.order) ? row.order : 0;
}

/** Manual order (after someone dragged/inserted rows on this tab); ties fall back to the ledger. */
function compareRowsByOrder(a: PageRow, b: PageRow): number {
  const delta = rowOrderValue(a) - rowOrderValue(b);
  if (delta !== 0) return delta;
  return compareRowsByCreatedAt(a, b);
}

function compareColumnsBySchema(a: { order: number }, b: { order: number }, ai: number, bi: number): number {
  const ao = typeof a.order === "number" && Number.isFinite(a.order) ? a.order : ai;
  const bo = typeof b.order === "number" && Number.isFinite(b.order) ? b.order : bi;
  if (ao !== bo) return ao - bo;
  return ai - bi;
}

/** Одна ячейка многоячеечной правки (вставка, заполнение, очистка). */
interface CellEdit {
  rowId: string;
  colKey: string;
  oldValue: string;
  newValue: string;
}

/** Та же правка наоборот — для undo многоячеечной операции. */
function invertCellEdit(edit: CellEdit): CellEdit {
  return { ...edit, oldValue: edit.newValue, newValue: edit.oldValue };
}

interface DataTableProps {
  workspaceId: string;
  page: WorkspacePage;
  rows: PageRow[];
  canEdit: boolean;
  /**
   * Кто смотрит — для замка строк-заказов (их ведёт ОС, см. managedRow.ts).
   * Не передан — замка нет (стол ОС, личная зона и прочие таблицы).
   */
  viewer?: RowViewer;
  /** Панель в карточке строки — стол ОС рисует в ней «Заказ у технаря». */
  renderRowPanel?: (row: PageRow) => React.ReactNode;
  /**
   * Строки в этом столе заводит только ОС (workspace.osManagedDesks):
   * «Добавить строку» и «Быстрый заказ» технарю не показываем.
   */
  ordersFromOsOnly?: boolean;
  /**
   * Технарь заполняет этот стол сам (Owner: «технари заполняют сами» — всем
   * или этому столу): строки-заказы ОС он тоже правит (см. `OsManagedContext`).
   */
  techFills?: boolean;
  /**
   * Сводка по видимым строкам для шапки стола («Общий · Готово · В работе ·
   * Ждём»). Зовётся только когда числа изменились, не на каждый рендер.
   */
  onSummaryChange?: (summary: DeskSummary | null) => void;
  /**
   * Действия, которые шапка стола рисует сама («+ Заказ», «Строка»). Зовётся
   * при смене флагов can*, при размонтировании — с null.
   */
  onActionsChange?: (actions: DeskTableActions | null) => void;
  /**
   * Столбцы (ключи), чьи ячейки открывают внешний выбор вместо выпадашки, —
   * «Технарь» на столе ОС: полноэкранный список с поиском и занятостью.
   */
  cellPickerKeys?: readonly string[];
  onOpenCellPicker?: (row: PageRow, colKey: string) => void;
  /**
   * Кнопка поверх ячейки строки (стол ОС: «В работу» — заказ уходит на
   * «Заказы»; метка «не доехало до технаря»). `get` решает, что рисовать у
   * строки, `run` — что делать по нажатию.
   */
  cellAction?: {
    /** Столбец или несколько (стол ОС: «Технарь» и «Статус»). */
    colKey: string | string[];
    get: (row: PageRow, colKey: string) => CellActionView | null;
    run: (row: PageRow, colKey: string) => void;
    /**
     * Метка зависит от времени (стол ОС: «статус не совпал» — через 8 с
     * после правки): пересчитывать её раз в столько мс. Пересчитывает сама
     * ячейка, таблица и страница при этом не перерисовываются.
     */
    tickMs?: number;
  };
  /**
   * Добавка слева внутри ячеек `keys` (стол ОС: способ оплаты у «Цены» и
   * «Апсейла»). `version` меняется, когда меняется то, что рисует `render`
   * помимо самой строки (список способов) — иначе строки не перерисуются.
   */
  cellAddon?: {
    keys: readonly string[];
    render: (row: PageRow, colKey: string) => React.ReactNode;
    version: string;
  };
  /** Ячейки только для чтения: ключ столбца → почему (стол ОС: «Итого» считает сам). */
  lockedKeys?: Readonly<Record<string, string>>;
  /** Добавка в мета-строку вида «Карточки» (стол ОС: даты получен / выдан). */
  cardMeta?: (row: PageRow) => React.ReactNode;
  /**
   * Своя отрисовка значения в ячейках `keys` вместо обычной (стол ОС: бейдж
   * технаря и состояние выдачи в «Технаре»). `render` отдаёт `undefined` —
   * ячейка рисуется как обычно. `version` меняется, когда меняется то, что
   * рисует `render` помимо самой строки (люди, фото, ники, «Заказы»), —
   * строки сравнивают пропсы (memo) и без неё остались бы со старым видом.
   */
  cellDisplay?: {
    keys: readonly string[];
    render: (row: PageRow, colKey: string) => React.ReactNode | undefined;
    version: string;
  };
  /** Полоса под карточкой вида «Карточки» со своим действием (стол ОС: технарь и «Выдать…»). */
  cardFooter?: (row: PageRow) => React.ReactNode;
  /** Столбцы, которых нет в «Полях» карточки строки (их показывает `renderRowPanel`). */
  rowCardHiddenKeys?: readonly string[];
  /**
   * Можно ли предлагать «Отметить «Готово»» в карточке строки (стол ОС: только
   * выданному заказу — невыданный «Готово» не бывает). Нет — как раньше.
   */
  canMarkRowDone?: (row: PageRow) => boolean;
  /** Пояснение в заголовке группы (стол ОС: «Утверждение — не выданы»). */
  groupHint?: (label: string, column: PageColumn | null) => string | null;
  /** Свой текст пустого стола (стол ОС объясняет, с чего начать). */
  emptyState?: { title: string; description?: string };
  canEditStructure: boolean;
  userId: string;
  userName: string;
  /** When set, every row/column mutation targets this subpage's nested table instead of the page's own. */
  subPageId?: string;
  focusRowId?: string | null;
  /**
   * This tab keeps a hand-made row order (`rowOrder: "manual"` on the tab
   * doc, set the first time someone drags or inserts a row). Otherwise rows
   * follow the createdAt ledger — see compareRowsByOrder / nextRowOrder.
   */
  manualRowOrder?: boolean;
}

/** Phone: digits only (8 → +7 normalised); email: lowercase trimmed. */
function normalizeContact(raw: string, type: "phone" | "email" | string): string {
  const v = raw.trim();
  if (!v) return "";
  if (type === "phone") {
    let digits = v.replace(/\D/g, "");
    if (digits.length === 11 && digits.startsWith("8")) digits = "7" + digits.slice(1);
    return digits.length >= 7 ? digits : "";
  }
  return v.toLowerCase();
}

export function DataTable({ workspaceId, page, rows, canEdit, canEditStructure, userId, userName, subPageId, focusRowId, manualRowOrder = false, viewer, renderRowPanel, ordersFromOsOnly = false, techFills = false, onSummaryChange, onActionsChange, cellPickerKeys, onOpenCellPicker, cellAction, cellAddon, lockedKeys, cardMeta, cellDisplay, cardFooter, rowCardHiddenKeys, canMarkRowDone, groupHint, emptyState }: DataTableProps) {
  // Внешний выбор ячейки: колбэк стабилен (через ref), иначе каждый рендер
  // стола перерисовывал бы все строки — TableRow сравнивает пропсы.
  const cellPickerRef = useRef(onOpenCellPicker);
  cellPickerRef.current = onOpenCellPicker;
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const openCellPicker = useCallback((rowId: string, colKey: string) => {
    const row = rowsRef.current.find((r) => r.id === rowId);
    if (row) cellPickerRef.current?.(row, colKey);
  }, []);
  const cellActionRef = useRef(cellAction);
  cellActionRef.current = cellAction;
  const cellAddonRef = useRef(cellAddon);
  cellAddonRef.current = cellAddon;
  const renderCellAddon = useCallback((row: PageRow, colKey: string) => cellAddonRef.current?.render(row, colKey) ?? null, []);
  // Своя отрисовка значения — тоже через ref: колбэк один на все строки, а
  // перерисовку строк решает `cellDisplay.version`.
  const cellDisplayRef = useRef(cellDisplay);
  cellDisplayRef.current = cellDisplay;
  const renderCellDisplay = useCallback((row: PageRow, colKey: string) => cellDisplayRef.current?.render(row, colKey), []);
  const groupHintRef = useRef(groupHint);
  groupHintRef.current = groupHint;
  const runCellAction = useCallback((rowId: string, colKey: string) => {
    const row = rowsRef.current.find((r) => r.id === rowId);
    if (row) cellActionRef.current?.run(row, colKey);
  }, []);
  // Метку поверх ячейки считает сама ячейка (TableRow → LiveCellAction) по
  // СОХРАНЁННОЙ строке, как и раньше, а не по строке с ещё летящей правкой.
  const rowsById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const rowsByIdRef = useRef(rowsById);
  rowsByIdRef.current = rowsById;
  const getCellActionView = useCallback((rowId: string, colKey: string) => {
    const row = rowsByIdRef.current.get(rowId);
    return row ? (cellActionRef.current?.get(row, colKey) ?? null) : null;
  }, []);
  // Строкой, а не массивом: TableRow сравнивает пропсы по значению.
  const cellActionKeys = cellAction
    ? (Array.isArray(cellAction.colKey) ? cellAction.colKey : [cellAction.colKey]).join("\u0001")
    : null;
  const [cellActionPulse] = useState(createCellActionPulse);
  const hasCellAction = Boolean(cellAction);
  // После каждого рендера таблицы метки сверяют себя (данные для них могли
  // смениться у страницы), а по таймеру — метки, зависящие от времени.
  useEffect(() => {
    if (hasCellAction) cellActionPulse.emit();
  });
  const cellActionTickMs = cellAction?.tickMs;
  useEffect(() => {
    if (!cellActionTickMs) return;
    const timer = window.setInterval(() => cellActionPulse.emit(), cellActionTickMs);
    return () => window.clearInterval(timer);
  }, [cellActionTickMs, cellActionPulse]);
  // Режим «заказы ведёт ОС» — один объект на всю таблицу, чтобы правило
  // замка считалось в одном месте (см. utils/managedRow.ts).
  const lockCtx = useMemo(() => ({ osManaged: ordersFromOsOnly, techFills }), [ordersFromOsOnly, techFills]);
  // Тот же замок, но для самой ячейки: ссылка стабильна, иначе строки
  // перерисовывались бы на каждый рендер таблицы (memo в TableRow).
  const cellLockFor = useCallback(
    (row: PageRow, colKey: string) =>
      lockedKeys?.[colKey] ?? (viewer ? cellLockReason(row, colKey, viewer, lockCtx) : null),
    [viewer, lockCtx, lockedKeys]
  );
  // Ширина/порядок столбцов «Основной», которые ещё ждут записи в документ
  // стола (schedulePageColumnsLayout): до записи раскладка держится здесь.
  const [layoutOverlay, setLayoutOverlay] = useState<{
    pageId: string;
    token: number;
    patch: Record<string, ColumnLayoutPatch>;
  } | null>(null);
  const layoutTokenRef = useRef(0);
  // Свежие столбцы «Основной» для отложенной записи. Только главной вкладки и
  // только своего стола: во вкладке месяца `page.columns` — столбцы ВКЛАДКИ, и
  // отложенная запись положила бы их в документ стола.
  const mainColumnsRef = useRef<{ pageId: string; columns: PageColumn[] } | null>(null);
  if (!subPageId) mainColumnsRef.current = { pageId: page.id, columns: page.columns };
  const columns = useMemo(() => {
    const source =
      layoutOverlay && !subPageId && layoutOverlay.pageId === page.id
        ? applyColumnLayout(page.columns, layoutOverlay.patch)
        : page.columns;
    return source
      .map((column, index) => ({ column, index }))
      .sort((a, b) => compareColumnsBySchema(a.column, b.column, a.index, b.index))
      .map(({ column }) => column);
  }, [page.columns, page.id, subPageId, layoutOverlay]);
  // Для эффекта сброса при смене вкладки: ему нужны столбцы, но перечитывать
  // фильтры при каждой правке столбца нельзя.
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  const tableViewKey = subPageId ?? page.id;

  // Branch every row/column mutation between the page's own table and a
  // subpage's nested one, based on whether subPageId is set. Every call
  // site below keeps using the same short names as before — only these
  // definitions differ.
  const addRowService = subPageId
    ? (
        wsId: string,
        pId: string,
        cells: Record<string, string | number | null>,
        order: number,
        extras?: PageRow["extras"]
      ) => addSubPageRow(wsId, pId, subPageId, cells, order, extras)
    : addRowServiceBase;
  const deleteRowService = subPageId
    ? (wsId: string, pId: string, rowId: string) => deleteSubPageRow(wsId, pId, subPageId, rowId)
    : deleteRowServiceBase;
  const duplicateRowService = subPageId
    ? (wsId: string, pId: string, row: PageRow, order: number) => duplicateSubPageRow(wsId, pId, subPageId, row, order)
    : duplicateRowServiceBase;
  const reorderRows = subPageId
    ? (wsId: string, pId: string, orderedIds: string[], currentOrders?: ReadonlyMap<string, number>) =>
        reorderSubPageRows(wsId, pId, subPageId, orderedIds, currentOrders)
    : reorderRowsBase;
  const updateRowHeight = subPageId
    ? (wsId: string, pId: string, rowId: string, height: number) => updateSubPageRowHeight(wsId, pId, subPageId, rowId, height)
    : updateRowHeightBase;
  /**
   * Пустую строку-слот заполняют впервые — ставим `filledAt` (см.
   * PageRow.filledAt): дата заказа — момент заполнения, а не момент слота.
   */
  function firstFillAt(rowId: string, values: Array<string | number | null>): number | undefined {
    const row = rows.find((r) => r.id === rowId);
    if (!row || !isBlankRow(row)) return undefined;
    return values.some((v) => isFilledCellValue(v)) ? Date.now() : undefined;
  }
  const fillRowService = (
    wsId: string,
    pId: string,
    rowId: string,
    patch: Record<string, string | number | null>,
    extras?: PageRow["extras"] | null
  ) => {
    const filledAt = firstFillAt(rowId, Object.values(patch));
    return subPageId
      ? updateSubPageRowCellsBulk(wsId, pId, subPageId, rowId, patch, extras, undefined, filledAt)
      : updateRowCellsBulkBase(wsId, pId, rowId, patch, extras, undefined, filledAt);
  };
  const updatePageColumns = subPageId
    ? (wsId: string, pId: string, cols: typeof page.columns) => updateSubPageColumns(wsId, pId, subPageId, cols)
    : updatePageColumnsBase;
  const addColumnService = subPageId
    ? (wsId: string, pId: string, cols: typeof page.columns, input: Parameters<typeof addColumnServiceBase>[3]) =>
        addSubPageColumn(wsId, pId, subPageId, cols, input)
    : addColumnServiceBase;
  const renameColumnService = subPageId
    ? (wsId: string, pId: string, cols: typeof page.columns, colKey: string, newLabel: string) =>
        renameSubPageColumn(wsId, pId, subPageId, cols, colKey, newLabel)
    : renameColumnServiceBase;
  const changeColumnTypeService = subPageId
    ? (
        wsId: string,
        pId: string,
        cols: typeof page.columns,
        colKey: string,
        type: ColumnType,
        statusOptions?: typeof columns[number]["statusOptions"],
        customFieldId?: string
      ) => changeSubPageColumnType(wsId, pId, subPageId, cols, colKey, type, statusOptions, customFieldId)
    : changeColumnTypeServiceBase;
  const duplicateColumnService = subPageId
    ? (wsId: string, pId: string, cols: typeof page.columns, colKey: string) => duplicateSubPageColumn(wsId, pId, subPageId, cols, colKey)
    : duplicateColumnServiceBase;
  const deleteColumnService = subPageId
    ? (wsId: string, pId: string, cols: typeof page.columns, colKey: string) => deleteSubPageColumn(wsId, pId, subPageId, cols, colKey)
    : deleteColumnServiceBase;
  async function updateRowCell(ctx: Parameters<typeof updateRowCellBase>[0]) {
    const filledAt = ctx.filledAt ?? firstFillAt(ctx.rowId, [ctx.newValue]);
    if (subPageId) {
      await updateSubPageRowCell(ctx.workspaceId, ctx.pageId, subPageId, ctx.rowId, ctx.field, ctx.newValue, filledAt);
      return;
    }
    await updateRowCellBase({ ...ctx, filledAt });
  }

  const [activeCell, setActiveCell] = useState<CellAddress | null>(null);
  const [rangeAnchor, setRangeAnchor] = useState<CellAddress | null>(null);
  const [editingCell, setEditingCell] = useState<CellAddress | null>(null);
  useUnsavedGuard(Boolean(editingCell));
  const pendingWrites = usePendingCellWrites();
  const [editValue, setEditValue] = useState("");
  const [sortState, setSortState] = useState<SortState>(() => readPersistedSortState(tableViewKey));
  const [filters, setFilters] = useState<Record<string, Set<string>>>({});
  const [filterPopover, setFilterPopover] = useState<{ colKey: string; x: number; y: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  // Quick date-period filter on one date column ("Сегодня", "Эта неделя", …).
  const [dateFilter, setDateFilter] = useState<{ colKey: string; preset: DatePreset } | null>(null);
  // "Мои": only rows whose Ответственный matches the signed-in person.
  const [mineOnly, setMineOnly] = useState(false);
  // Drag-to-fill (the little square on the selection corner).
  const fillDragRef = useRef<{
    colKeys: string[];
    sourceRowIds: string[];
    rowStart: number;
    rowEnd: number;
  } | null>(null);
  const [fillPreview, setFillPreviewState] = useState<{ colKeys: string[]; rowStart: number; rowEnd: number } | null>(null);
  const fillPreviewRef = useRef<{ colKeys: string[]; rowStart: number; rowEnd: number } | null>(null);
  const setFillPreview = (next: { colKeys: string[]; rowStart: number; rowEnd: number } | null) => {
    fillPreviewRef.current = next;
    setFillPreviewState(next);
  };
  const [groupByKey, setGroupByKey] = useState<string | null>(() => readPersistedGroupBy(tableViewKey, columns));
  const [savedViews, setSavedViews] = useState<SavedTableView[]>(() => loadSavedTableViews(tableViewKey));
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [density, setDensity] = useState<"compact" | "default" | "comfortable">(() => {
    // Persisted across visits/reloads (per-browser) — was previously reset
    // to "default" every time you opened a table, even if you'd just set
    // it to "compact" a moment ago.
    if (typeof window === "undefined") return "compact";
    const saved = window.localStorage.getItem("nova-crm:table-density");
    return saved === "compact" || saved === "default" || saved === "comfortable" ? saved : "compact";
  });

  function handleDensityChange(next: "compact" | "default" | "comfortable") {
    setDensity(next);
    window.localStorage.setItem("nova-crm:table-density", next);
  }
  // Persisted per page/subpage — same localStorage-on-mount pattern as
  // pinnedKeys below, keyed by subPageId when set so each subpage tab can
  // remember its own view independently of the parent page's "Основная".
  const [viewMode, setViewMode] = useState<TableViewMode>(() => {
    if (typeof window === "undefined") return "table";
    const saved = window.localStorage.getItem(`nova-crm:view-mode:${subPageId ?? page.id}`);
    if (saved === "kanban" || saved === "cards" || saved === "table") return saved;
    // На телефоне таблица показывает два столбца из десяти, поэтому стол по
    // умолчанию открывается списком карточек. Это только первый выбор: как
    // только человек сам переключит вид, решает сохранённое значение.
    return typeof window.matchMedia === "function" && window.matchMedia("(max-width: 639px)").matches
      ? "cards"
      : "table";
  });
  function handleViewModeChange(next: TableViewMode) {
    setViewMode(next);
    window.localStorage.setItem(`nova-crm:view-mode:${subPageId ?? page.id}`, next);
  }
  const [addColumnOpen, setAddColumnOpen] = useState(false);
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [manageOptionsColKey, setManageOptionsColKey] = useState<string | null>(null);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [commentRowId, setCommentRowId] = useState<string | null>(null);
  const [pinnedKeys, setPinnedKeys] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(`nova-crm:pinned:${page.id}`);
      if (raw) return JSON.parse(raw);
    } catch {
      // fall through to default below
    }
    // First-time default: pin the first column so it stays visible while
    // scrolling horizontally through the rest — matters most on mobile,
    // where only 1-2 columns fit on screen at once.
    return columns[0] ? [columns[0].key] : [];
  });
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [quickOrderOpen, setQuickOrderOpen] = useState(false);
  const [quickOrderStatus, setQuickOrderStatus] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  // Row ids in the order of a drop that's still being written.
  const [optimisticRowOrder, setOptimisticRowOrder] = useState<string[] | null>(null);
  // Default to showing every row the page actually has — pagination exists
  // for people who WANT to chunk a big table, not as a hidden cap that
  // silently hides the last few rows (e.g. 26 rows defaulting to a 25 page
  // size). Virtualized rendering below means "Все" costs nothing extra.
  const [pageSize, setPageSize] = useState(Infinity);
  const [resizePreview, setResizePreview] = useState<
    | { type: "col"; colKey: string; width: number }
    | { type: "row"; rowId: string; height: number }
    | null
  >(null);

  // Bumped to ask the ACTIVE picker cell (status/date) to open from the
  // keyboard (Enter / Space) — see TableCell's openRequest effect.
  const [openRequest, setOpenRequest] = useState(0);
  // Bumped by Ctrl+F so the toolbar search grabs focus.
  const [focusSearchToken, setFocusSearchToken] = useState(0);
  // Выбор сводки по столбцу больше не меняется из интерфейса: строку
  // «Итого» под таблицей убрали, она дублировала «Общий»/«Готово» в нижней
  // плашке. Уже сохранённый выбор продолжаем читать — он питает подсказку
  // в шапке столбца (`hint`), а не отдельную строку.
  // Сеттер остаётся: при переключении вкладки/вида сводки перечитываются
  // из localStorage (эффект сброса ниже), иначе на новом виде показывалась
  // бы настройка предыдущего.
  const [columnAggregates, setColumnAggregates] = useState<Record<string, AggregateKind>>(() =>
    loadColumnAggregates(tableViewKey)
  );
  // Where "Добавить столбец справа" should slot the new column.
  const insertAfterKeyRef = useRef<string | null>(null);

  const { activeWorkspace } = useWorkspace();
  const { profile } = useAuth();
  const permissions = usePermissions();
  // Shared option lists (statuses, Ответственный, custom fields) — Owner only
  // here: a Тимлид manages them in Настройки but never opens a desk table.
  const canEditSharedLists = permissions.canManageStatusVariants;

  // Which Ответственный option is "me": matched by nickname / name against
  // the workspace-wide responsible list (options aren't tied to accounts).
  const myResponsibleValues = useMemo(() => {
    const names = [profile?.nickname, profile?.name].map((n) => (n ?? "").trim().toLowerCase()).filter(Boolean);
    if (names.length === 0) return [] as string[];
    const opts = activeWorkspace?.responsibleOptions ?? [];
    return opts
      .filter((o) => {
        const l = o.label.trim().toLowerCase();
        return names.some((n) => l === n || l.startsWith(n + " ") || n.startsWith(l + " "));
      })
      .map((o) => o.value);
  }, [profile?.nickname, profile?.name, activeWorkspace?.responsibleOptions]);
  const canManageVariants = canEditSharedLists;
  // Stable fallbacks: a fresh `[]` on every render invalidated displayColumns
  // each time, which re-rendered every row and re-armed the scroll-fade
  // ResizeObserver in a loop.
  const responsibleOptions = activeWorkspace?.responsibleOptions ?? NO_OPTIONS;
  const sharedStatusOptions = activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS;
  const customFields = activeWorkspace?.customFields ?? NO_CUSTOM_FIELDS;

  const displayColumns = useMemo(() => {
    return columns
      .filter((c) => !c.hidden)
      .map((c) => {
        let next = { ...c, statusOptions: getColumnOptions(c, activeWorkspace) };
        const width =
          resizePreview?.type === "col" && c.key === resizePreview.colKey ? resizePreview.width : c.width;
        next = { ...next, width: clampColumnWidth(c.type, width) };
        return next;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, resizePreview, responsibleOptions, sharedStatusOptions, customFields, activeWorkspace]);

  const quickOrderCols = useMemo(() => findQuickOrderColumns(displayColumns), [displayColumns]);
  const extrasHintKey = quickOrderCols.client?.key ?? null;
  const quickOrderOsOptions =
    quickOrderCols.os && isOptionColumn(quickOrderCols.os.type)
      ? getColumnOptions(quickOrderCols.os, activeWorkspace)
      : null;

  const stickyKeys = useMemo(
    () => pinnedKeys.filter((k) => displayColumns.some((c) => c.key === k)),
    [pinnedKeys, displayColumns]
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const [hFade, setHFade] = useState({ left: false, right: false });
  const isSelectingRef = useRef(false);
  // Set on mousedown over the ALREADY-selected text cell; the click that
  // follows (same cell, no drag) opens the editor.
  const clickToEditRef = useRef<CellAddress | null>(null);
  const editingCellRef = useRef<CellAddress | null>(null);
  const contextRowIdRef = useRef<string | null>(null);
  const lastCheckedRowIdRef = useRef<string | null>(null);
  const pendingScrollRowIdRef = useRef<string | null>(null);
  const appliedFocusRowIdRef = useRef<string | null>(null);
  // Буфер таблицы переехал на модуль (`utils/tableClipboard.ts`): в useRef он
  // умирал при переходе на другой стол, а копировать столбец между столами
  // и надо. `clipboardStamp` только дёргает перерисовку меню столбца.
  const [clipboardStamp, setClipboardStamp] = useState(0);
  const [smartPaste, setSmartPaste] = useState<SmartPasteRequest | null>(null);
  const smartPasteStartRef = useRef<{ rowIdx: number; colIdx: number } | null>(null);
  // В буфере ровно один столбец — значит, в меню столбца есть «Вставить сюда».
  // Зависимость от `clipboardStamp` тут и есть способ узнать о новой копии:
  // сам буфер живёт на модуле и о перерисовке не сообщает.
  const clipboardColumnLabel = useMemo(() => {
    const payload = peekTableClipboard();
    if (!payload || payload.matrix.length === 0) return null;
    const width = Math.max(...payload.matrix.map((line) => line.length));
    return width === 1 ? payload.columns[0]?.label ?? null : null;
  }, [clipboardStamp]);
  const resizeStateRef = useRef<
    | { type: "col"; colKey: string; startPos: number; startSize: number; lastValue: number }
    | { type: "row"; rowId: string; startPos: number; startSize: number; lastValue: number }
    | null
  >(null);

  useEffect(() => {
    editingCellRef.current = editingCell;
  }, [editingCell]);

  useEffect(() => {
    localStorage.setItem(`nova-crm:pinned:${page.id}`, JSON.stringify(pinnedKeys));
  }, [pinnedKeys, page.id]);

  useEffect(() => {
    if (!canManageVariants) {
      setManageOptionsColKey(null);
    }
  }, [canManageVariants]);

  // Reset transient selection whenever the page changes.
  useEffect(() => {
    setActiveCell(null);
    setRangeAnchor(null);
    setEditingCell(null);
    setSortState(readPersistedSortState(tableViewKey));
    setFilters({});
    setSearchQuery("");
    setStatusFilter(null);
    setGroupByKey(readPersistedGroupBy(tableViewKey, columnsRef.current));
    setCollapsedGroups(new Set());
    setSavedViews(loadSavedTableViews(tableViewKey));
    setColumnAggregates(loadColumnAggregates(tableViewKey));
    setSelectedRowIds(new Set());
    setDateFilter(null);
    setMineOnly(false);
    setPageIndex(0);
  }, [page.id, tableViewKey]);

  const [coarsePointer, setCoarsePointer] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const apply = () => setCoarsePointer(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  // Мышью — ровно плотность (34/40/48), пола в 48 больше нет: он и делал
  // «компактно» неотличимым от «обычно». Тач-ветку не трогаем.
  const rowHeight = coarsePointer ? Math.max(52, DENSITY_ROW_HEIGHT[density]) : DENSITY_ROW_HEIGHT[density];
  // На таче в гаттере только номер (без «⋯»), поэтому он уже — ширина
  // достаётся имени клиента в липком первом столбце.
  const gutterWidth = coarsePointer ? 40 : 56;

  const [gridFocused, setGridFocused] = useState(false);
  const [expandedTextCell, setExpandedTextCell] = useState<CellAddress | null>(null);

  // Human-readable text of a cell — option LABEL (not the stored value id),
  // formatted date, money — so search/filter/copy see what the person sees.
  const cellDisplayText = useCallback(
    (row: PageRow, column: (typeof columns)[number]): string => {
      const raw = row.cells[column.key];
      const str = raw === null || raw === undefined ? "" : String(raw);
      if (!str) return "";
      if (isOptionColumn(column.type)) {
        return getColumnOptions(column, activeWorkspace).find((o) => o.value === str)?.label ?? str;
      }
      if (column.type === "date") {
        const n = Number(str);
        return Number.isFinite(n) && n > 0 ? formatOrderDate(n) : str;
      }
      return str;
    },
    [activeWorkspace]
  );

  // ---- Filtering + search + sort ----
  // Everything that can hide a row; `q` is the lowercased search query.
  const rowPassesFilters = useCallback(
    (row: PageRow, q: string) => {
      if (q) {
        const matches = columns.some((c) => {
          if (c.hidden) return false;
          const raw = String(row.cells[c.key] ?? "").toLowerCase();
          if (raw.includes(q)) return true;
          const shown = cellDisplayText(row, c).toLowerCase();
          return shown !== raw && shown.includes(q);
        });
        if (!matches) return false;
      }
      for (const colKey of Object.keys(filters)) {
        const excluded = filters[colKey];
        if (excluded && excluded.size > 0) {
          const val = String(row.cells[colKey] ?? "");
          if (excluded.has(val)) return false;
        }
      }
      if (statusFilter) {
        const statusCol = columns.find((c) => c.type === "status");
        if (statusCol) {
          const raw = String(row.cells[statusCol.key] ?? "");
          const options = getColumnOptions(statusCol, activeWorkspace);
          if (statusFilter === NOT_DONE_STATUS_FILTER) {
            const opt = options.find((o) => o.value === raw);
            if (opt && isDoneStatusLabel(opt.label)) return false;
          } else if (raw !== statusFilter) {
            return false;
          }
        }
      }
      if (dateFilter && !isInDatePreset(row.cells[dateFilter.colKey], dateFilter.preset)) return false;
      if (mineOnly && myResponsibleValues.length > 0) {
        const respCol = columns.find((c) => c.type === "responsible");
        if (respCol && !myResponsibleValues.includes(String(row.cells[respCol.key] ?? ""))) return false;
      }
      return true;
    },
    [columns, filters, statusFilter, activeWorkspace, cellDisplayText, dateFilter, mineOnly, myResponsibleValues]
  );

  const processedRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let result = rows.filter((row) => rowPassesFilters(row, q));

    if (sortState.colKey && sortState.direction) {
      const col = columns.find((c) => c.key === sortState.colKey);
      const dir = sortState.direction;
      const colKey = sortState.colKey;
      result = [...result].sort((a, b) => {
        const av = a.cells[colKey];
        const bv = b.cells[colKey];
        const aEmpty = isEmptySortValue(av, col?.type);
        const bEmpty = isEmptySortValue(bv, col?.type);
        if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
        if (aEmpty && bEmpty) return compareRowsByCreatedAt(a, b);
        const cmp = compareFilledValues(av, bv, col?.type, dir);
        if (cmp !== 0) return cmp;
        return compareRowsByCreatedAt(a, b);
      });
    } else if (optimisticRowOrder) {
      // Just dropped a row: show the new order until Firestore catches up.
      const position = new Map(optimisticRowOrder.map((id, i) => [id, i]));
      result = [...result].sort(
        (a, b) => (position.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (position.get(b.id) ?? Number.MAX_SAFE_INTEGER) || compareRowsByOrder(a, b)
      );
    } else {
      result = [...result].sort(manualRowOrder ? compareRowsByOrder : compareRowsByCreatedAt);
    }
    return result;
  }, [rows, columns, searchQuery, sortState, rowPassesFilters, manualRowOrder, optimisticRowOrder]);

  // Blank rows are free slots, not orders: kept on screen to type into, left
  // out of every count, footer and the kanban board.
  const filledProcessedRows = useMemo(() => processedRows.filter((row) => !isBlankRow(row)), [processedRows]);
  const filledRowCount = useMemo(() => rows.reduce((n, row) => n + (isBlankRow(row) ? 0 : 1), 0), [rows]);

  // Per-status row counts for the toolbar chips (respecting search + column
  // filters, but NOT the status chip itself — otherwise every other chip
  // would read 0 the moment one is active).
  const statusCounts = useMemo(() => {
    const statusCol = columns.find((c) => c.type === "status");
    if (!statusCol) return undefined;
    const q = searchQuery.trim().toLowerCase();
    const options = getColumnOptions(statusCol, activeWorkspace);
    const counts: Record<string, number> = {};
    let notDone = 0;
    for (const row of rows) {
      if (isBlankRow(row)) continue;
      if (q) {
        const matches = columns.some((c) => !c.hidden && cellDisplayText(row, c).toLowerCase().includes(q));
        if (!matches) continue;
      }
      let excludedByFilter = false;
      for (const colKey of Object.keys(filters)) {
        const excluded = filters[colKey];
        if (excluded && excluded.size > 0 && excluded.has(String(row.cells[colKey] ?? ""))) {
          excludedByFilter = true;
          break;
        }
      }
      if (excludedByFilter) continue;
      const raw = String(row.cells[statusCol.key] ?? "");
      counts[raw] = (counts[raw] ?? 0) + 1;
      const opt = options.find((o) => o.value === raw);
      if (!opt || !isDoneStatusLabel(opt.label)) notDone += 1;
    }
    counts[NOT_DONE_STATUS_FILTER] = notDone;
    return counts;
  }, [rows, columns, searchQuery, filters, activeWorkspace, cellDisplayText]);

  // Filters that can HIDE rows (sort/group only reorder).
  const hasNarrowingFilters =
    Boolean(searchQuery.trim()) ||
    Boolean(statusFilter) ||
    Boolean(dateFilter) ||
    mineOnly ||
    Object.values(filters).some((set) => set.size > 0);
  // Rows follow the createdAt ledger until someone drags (or inserts) a row
  // on this tab; that renumbers every row's `order` once and flips the tab
  // to manual order, so older tables with messy `order` values never
  // reshuffle on their own. Only in the plain view — dragging inside a
  // sorted, grouped or filtered view has no well-defined target position.
  // Switching a tab to manual writes the tab doc: subpage docs follow the
  // data right (canEdit), the page doc («Основная») needs canEditStructure.
  const canReorderRows =
    canEdit &&
    !sortState.colKey &&
    !groupByKey &&
    !hasNarrowingFilters &&
    (manualRowOrder || Boolean(subPageId) || canEditStructure);

  function nextRowOrder(): number {
    let max = -1;
    for (const r of rows) if (typeof r.order === "number" && Number.isFinite(r.order)) max = Math.max(max, r.order);
    return Math.max(Math.floor(max) + 1, rows.length);
  }

  // Blank including cell writes still on their way to Firestore, and the
  // value being committed right now (`edit`).
  function isBlankRowNow(row: PageRow, edit?: { colKey: string; value: string }): boolean {
    if (row.attachments && row.attachments.length > 0) return false;
    if (hasRowExtras(row.extras)) return false;
    const keys = new Set([...Object.keys(row.cells ?? {}), ...columns.map((c) => c.key)]);
    for (const key of keys) {
      const value = edit && edit.colKey === key ? edit.value : pendingWrites.resolve(row.id, key, row.cells?.[key] ?? null);
      if (isFilledCellValue(value)) return false;
    }
    return true;
  }

  /**
   * Where new data goes first: the topmost blank row the table would show
   * once the search box is cleared — instead of one more row appended under
   * the blank ones.
   */
  function firstBlankRow(): PageRow | null {
    const blanks = rows.filter((row) => isBlankRowNow(row) && rowPassesFilters(row, ""));
    if (blanks.length === 0) return null;
    blanks.sort(!sortState.colKey && manualRowOrder ? compareRowsByOrder : compareRowsByCreatedAt);
    return blanks[0];
  }

  /** Selects the first column of that row and opens the editor there (text-like columns), scrolling it into view. */
  function startEntryInRow(rowId: string) {
    const firstCol = displayColumns[0];
    if (!firstCol) return;
    const addr = { rowId, colKey: firstCol.key };
    if (Number.isFinite(pageSize) && pageSize > 0 && !searchQuery) {
      const idx = processedRows.findIndex((r) => r.id === rowId);
      if (idx >= 0) setPageIndex(Math.floor(idx / pageSize));
    }
    pendingScrollRowIdRef.current = rowId;
    requestAnimationFrame(() => {
      setActiveCell(addr);
      setRangeAnchor(addr);
      if (!isOptionColumn(firstCol.type) && firstCol.type !== "date") {
        setEditingCell(addr);
        setEditValue("");
      }
      const idx = visibleRowsRef.current.findIndex((r) => r.id === rowId);
      if (idx >= 0) {
        pendingScrollRowIdRef.current = null;
        revealCell(rowId, firstCol.key, idx);
      }
    });
  }

  async function persistManualOrder(orderedIds: string[]) {
    // Полная перенумерация, без «пропустить уже стоящие на месте»: `order`
    // в `rows` при живом мосте может прийти из Supabase (слитая строка берёт
    // его оттуда, если та копия новее), а она бывает отставшей — и тогда
    // Firestore, источник правды, остался бы с дублями номеров. Перетаскивают
    // редко; ревью квоты 22.09.2026 решило, что экономия того не стоит.
    await reorderRows(workspaceId, page.id, orderedIds);
    if (!manualRowOrder) await setTabRowOrderManual(workspaceId, page.id, subPageId ?? null);
  }

  // Every column write (reorder, width, auto-fit) lands on a DIFFERENT doc
  // depending on where we are, and firestore.rules gates those two docs
  // differently — so the client gate has to differ too:
  //   • inside a subpage tab -> subpages/{id}, allowed for anyone canEditPage
  //     covers (the page's editableUsers included);
  //   • on the main tab      -> the pages/{pageId} doc itself, which only
  //     Owner or the desk's responsible person may update.
  // Gating these on plain `canEdit` (the DATA right) let an editor drag a
  // column or resize one on the main tab, get the write rejected server-side
  // with nothing surfaced, and watch it silently snap back.
  //
  // The mirror mistake is gating them on `canEditStructure` (= canManagePage,
  // i.e. Owner or the desk's responsible person): every structural write in
  // this component already routes through the subPageId-aware service alias
  // above, so inside a month tab the rules permit anyone canEditPage covers.
  // Since a Технарь's desk is created with hideMainTab and opens on its month
  // tab, that gate hid «плюс», rename and hide/show from an editor for whom
  // the write would have succeeded — the "can't add or edit columns" report.
  const canEditColumns = subPageId ? canEdit : canEditStructure;

  // ---- Grouping ----
  // Столбец ищем по ВСЕМ столбцам, а варианты резолвим сами: пока эффект
  // ниже не сбросил группировку по скрытому столбцу, один рендер шёл бы с
  // сырыми `in_progress`/`done` без цветов.
  const groupCol = useMemo(
    () => (groupByKey ? columns.find((c) => c.key === groupByKey) : undefined),
    [groupByKey, columns]
  );
  // Варианты столбца группировки зависят только от СВОЕГО списка (статусы,
  // ответственные, ники, кастомные поля), а не от всего документа workspace:
  // иначе любой его снимок (reloadEpoch, настройки) пересобирал группы.
  const groupOptionsSource: unknown =
    !groupCol || !isOptionColumn(groupCol.type)
      ? null
      : groupCol.type === "status"
        ? activeWorkspace?.statusOptions
        : groupCol.type === "responsible"
          ? activeWorkspace?.responsibleOptions
          : groupCol.type === "technician"
            ? activeWorkspace?.techNickOptions
            : groupCol.type === "custom"
              ? activeWorkspace?.customFields
              : groupCol.statusOptions;
  const groupOptions = useMemo(
    () => (groupCol && isOptionColumn(groupCol.type) ? getColumnOptions(groupCol, activeWorkspace) : NO_OPTIONS),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groupCol, groupOptionsSource]
  );
  const groups = useMemo(() => {
    if (!groupByKey) return null;
    const col = groupCol;
    const options = groupOptions;
    const map = new Map<string, PageRow[]>();
    processedRows.forEach((row) => {
      const raw = String(row.cells[groupByKey] ?? "");
      const label = col && isOptionColumn(col.type) ? options.find((o) => o.value === raw)?.label ?? raw : raw;
      // Was `label || "__empty__"` — that sentinel string is truthy, so
      // GroupHeaderRow's own `label || "Без значения"` fallback never
      // triggered and the raw internal placeholder leaked into the UI as a
      // literal group header. Empty string works fine as a Map key on its
      // own; no sentinel needed.
      const key = isEmptyGroupLabel(label) ? "" : label;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    });
    const entries = Array.from(map.entries());
    // Порядок групп — порядок вариантов столбца («В работе» выше «Готово»,
    // как их расставил Owner), а не порядок первого появления в строках.
    // Неизвестные подписи — после известных, пустая — последней.
    const optionIndex = new Map<string, number>();
    options.forEach((o, i) => {
      if (!optionIndex.has(o.label)) optionIndex.set(o.label, i);
    });
    const rank = (label: string) => {
      if (isEmptyGroupLabel(label)) return Number.POSITIVE_INFINITY;
      return optionIndex.get(label) ?? Number.MAX_SAFE_INTEGER;
    };
    entries.sort((a, b) => {
      const ra = rank(a[0]);
      const rb = rank(b[0]);
      if (ra === rb) return 0;
      return ra < rb ? -1 : 1;
    });
    return { col, options, entries };
  }, [groupByKey, processedRows, groupCol, groupOptions]);

  // ---- Видимые строки в порядке отрисовки ----
  // ОДИН массив для всего, что ходит по строкам индексом: клавиатура,
  // диапазон, Ctrl+C, ручка заливки, PageUp/PageDown, Tab, «выделить все на
  // странице». С группами тело рисуется по группам (свёрнутые пропущены), и
  // порядок processedRows с экраном не совпадает — стрелка «вниз» уходила в
  // строку из другой группы, а заливка красила не те строки. Без групп это
  // страница пагинации, как раньше.
  const visibleRows = useMemo(() => {
    if (groups) {
      return groups.entries.flatMap(([label, groupRows]) => (collapsedGroups.has(label) ? [] : groupRows));
    }
    if (!Number.isFinite(pageSize)) return processedRows;
    const start = pageIndex * pageSize;
    return processedRows.slice(start, start + pageSize);
  }, [processedRows, pageIndex, pageSize, groups, collapsedGroups]);

  // rowIds меняется, только когда правда сменились id или их порядок: правка
  // ячейки даёт новый visibleRows, но тот же rowIds — и выделение, диапазон,
  // SortableContext от этого не дёргаются (иначе перерисовывался весь стол).
  const rowIdsKey = useMemo(() => visibleRows.map((r) => r.id).join("\n"), [visibleRows]);
  const rowIds = useMemo(() => (rowIdsKey ? rowIdsKey.split("\n") : []), [rowIdsKey]);
  const visibleRowsRef = useRef(visibleRows);
  visibleRowsRef.current = visibleRows;
  // Row-card prev/next/"N of total" must walk the full filtered+sorted view,
  // not just the current pagination page — `rowIds` above is intentionally
  // page-scoped for the grid itself, but the card's own row lookup already
  // reads from the full `rows` prop regardless of pagination (see the
  // RowCardSheet render below), so its nav index has to match that.
  const processedRowIds = useMemo(() => processedRows.map((r) => r.id), [processedRows]);

  // Суммы групп (деньги и «Готово» в заголовке) — один раз на смену групп,
  // а не в каждом рендере таблицы для каждой группы.
  const groupSummaries = useMemo(() => {
    if (!groups) return null;
    const currencyCol = columns.find((c) => c.type === "currency" && !c.hidden) ?? null;
    const statusCol = columns.find((c) => c.type === "status") ?? null;
    const map = new Map<string, { sumText: string | null; doneText: string | null }>();
    for (const [label, groupRows] of groups.entries) {
      map.set(label, groupSumsOf(groupRows, currencyCol, statusCol, sharedStatusOptions));
    }
    return map;
  }, [groups, columns, sharedStatusOptions]);

  // ---- Тело таблицы: плоский список [заголовок группы | строка] ----
  const bodyItems = useMemo<BodyItem[]>(() => {
    if (!groups) return visibleRows.map((row, index) => ({ kind: "row" as const, row, index }));
    const items: BodyItem[] = [];
    let index = 0;
    for (const [label, groupRows] of groups.entries) {
      const collapsed = collapsedGroups.has(label);
      const sums = groupSummaries?.get(label);
      items.push({
        kind: "group",
        label,
        count: groupRows.length,
        collapsed,
        color: groups.options.find((o) => o.label === label)?.color,
        sumText: sums?.sumText ?? null,
        doneText: sums?.doneText ?? null,
        hint: groupHintRef.current?.(label, groups.col ?? null) ?? null,
      });
      if (collapsed) continue;
      // Сквозной индекс по visibleRows: номер строки и зебра обязаны
      // совпадать с rowIds, по которым ходит клавиатура и заливка.
      for (const row of groupRows) items.push({ kind: "row", row, index: index++ });
    }
    return items;
  }, [groups, visibleRows, collapsedGroups, groupSummaries]);
  // Индекс строки в visibleRows → индекс элемента тела (для прокрутки к строке).
  const bodyIndexByRow = useMemo(() => {
    const out: number[] = [];
    bodyItems.forEach((item, i) => {
      if (item.kind === "row") out[item.index] = i;
    });
    return out;
  }, [bodyItems]);

  // ---- Виртуализация: и без групп, и с группами ----
  // Раньше при группировке (а это умолчание стола) рисовались ВСЕ строки —
  // тысячи ячеек и 0,5–1,2 с первой отрисовки на телефоне.
  const shouldVirtualize = bodyItems.length > VIRTUALIZE_AFTER;
  const getBodyItemKey = useCallback(
    (index: number) => {
      const item = bodyItems[index];
      return item ? bodyItemKey(item) : index;
    },
    // rowHeight — нарочно: новая функция ключа — единственный способ
    // заставить виртуализатор пересчитать оценки высот (смена плотности).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bodyItems, rowHeight]
  );
  const rowVirtualizer = useVirtualizer({
    count: bodyItems.length,
    getScrollElement: () => containerRef.current,
    estimateSize: (index) => {
      const item = bodyItems[index];
      if (!item) return rowHeight;
      if (item.kind === "group") {
        return typeof window !== "undefined" && window.innerWidth < 640
          ? GROUP_HEADER_ESTIMATE_NARROW_PX
          : GROUP_HEADER_ESTIMATE_PX;
      }
      return item.row.height ?? rowHeight;
    },
    getItemKey: getBodyItemKey,
    overscan: 10,
    enabled: shouldVirtualize,
  });

  useEffect(() => {
    const id = pendingScrollRowIdRef.current;
    if (!id) return;
    const idx = visibleRows.findIndex((r) => r.id === id);
    if (idx < 0) return;
    pendingScrollRowIdRef.current = null;
    rowVirtualizer.scrollToIndex(bodyIndexByRow[idx] ?? idx, { align: "end" });
    requestAnimationFrame(() => {
      containerRef.current
        ?.querySelector(`tr[data-row-id="${id}"]`)
        ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    });
  }, [visibleRows, rowVirtualizer, bodyIndexByRow]);

  useEffect(() => {
    if (!focusRowId) return;
    if (appliedFocusRowIdRef.current === focusRowId) return;
    const idx = processedRows.findIndex((r) => r.id === focusRowId);
    if (idx < 0) return;
    appliedFocusRowIdRef.current = focusRowId;
    if (Number.isFinite(pageSize) && pageSize > 0) {
      setPageIndex(Math.floor(idx / pageSize));
    }
    pendingScrollRowIdRef.current = focusRowId;
    const colKey = displayColumns[0]?.key ?? "";
    if (colKey) {
      setActiveCell({ rowId: focusRowId, colKey });
      setRangeAnchor({ rowId: focusRowId, colKey });
    }
  }, [focusRowId, processedRows, pageSize, displayColumns]);

  // ---- Selection bounds ----
  const getSelectionBounds = useCallback(() => {
    if (!activeCell) return null;
    const anchor = rangeAnchor ?? activeCell;
    const rAnchor = rowIds.indexOf(anchor.rowId);
    const rFocus = rowIds.indexOf(activeCell.rowId);
    const cAnchor = displayColumns.findIndex((c) => c.key === anchor.colKey);
    const cFocus = displayColumns.findIndex((c) => c.key === activeCell.colKey);
    if (rAnchor === -1 || rFocus === -1 || cAnchor === -1 || cFocus === -1) return null;
    return {
      rowStart: Math.min(rAnchor, rFocus),
      rowEnd: Math.max(rAnchor, rFocus),
      colStart: Math.min(cAnchor, cFocus),
      colEnd: Math.max(cAnchor, cFocus),
    };
  }, [activeCell, rangeAnchor, rowIds, displayColumns]);

  const rangeCells = useMemo(() => {
    const bounds = getSelectionBounds();
    const set = new Set<string>();
    if (!bounds) return set;
    for (let r = bounds.rowStart; r <= bounds.rowEnd; r++) {
      for (let c = bounds.colStart; c <= bounds.colEnd; c++) {
        set.add(`${rowIds[r]}:${displayColumns[c].key}`);
      }
    }
    return set;
  }, [getSelectionBounds, rowIds, displayColumns]);

  // ---- Undo/redo: pushes into the GLOBAL stack (src/utils/undoStore.ts),
  // not a local one — so undoing survives navigating away from this exact
  // table (e.g. right after a page-level delete elsewhere), and Ctrl+Z
  // itself is handled by a single app-wide listener (GlobalUndoHotkeys),
  // not duplicated here.
  const pushCommand = pushUndoCommand;
  // ---- Editing ----
  const startEditing = useCallback(
    (rowId: string, colKey: string, initialValue?: string) => {
      if (!canEdit) return;
      const col = columns.find((c) => c.key === colKey);
      // Status/Responsible/custom-field columns are dropdown-only (see
      // TableCell.tsx) — they must NEVER enter text-editing mode. This used
      // to only check `col.type === "status"`, so double-clicking a
      // "Ответственный" or any custom-field cell silently set editingCell
      // anyway. TableCell still rendered the dropdown fine (isOptionColumn
      // is checked before isEditing there), so nothing looked wrong — but
      // editingCellRef stayed truthy with no visible input to blur it,
      // which SILENTLY DISABLED EVERY KEYBOARD SHORTCUT on the whole page
      // (arrows, Tab, Ctrl+C/V, Delete, Enter — the global handler's very
      // first line bails out whenever editingCellRef is set) until the
      // person happened to click some other cell. This is almost certainly
      // what made the table feel broadly "broken" rather than one glitch.
      if (!col || isOptionColumn(col.type) || col.type === "date") return;
      // Столбцы только для чтения («Итого», «Даты» стола ОС): редактор в них
      // прятал бы кнопки добавки и падал бы отказом при сохранении.
      if (lockedKeys?.[colKey]) return;
      // Re-entering edit mode on the cell that's ALREADY being edited must
      // be a no-op, not a reset. A real double-click fires two mousedowns
      // plus a trailing dblclick — each one used to call startEditing()
      // again and reset editValue back to the row's saved value, silently
      // wiping out anything typed in the few ms between them. That's the
      // "double-click and you can't type anything" bug.
      if (editingCellRef.current?.rowId === rowId && editingCellRef.current?.colKey === colKey) return;
      const row = rows.find((r) => r.id === rowId);
      if (!row) return;
      // Строку-заказ ведёт ОС: не даём даже начать ввод — `useCellCommit` при
      // отказе базы введённое НЕ откатывает, и человек решил бы, что
      // сохранилось, а потом пропало.
      const lockedCell = viewer ? cellLockReason(row, colKey, viewer, lockCtx) : null;
      if (lockedCell) {
        toast.error(lockedCell);
        return;
      }
      setEditingCell({ rowId, colKey });
      setEditValue(initialValue !== undefined ? initialValue : String(row.cells[colKey] ?? ""));
    },
    [canEdit, columns, rows, lockedKeys]
  );

  /**
   * Auto-fill the FIRST column of the table (whatever it's called —
   * "Название" or anything else, order 0) — the very first time it goes
   * from empty to non-empty, if there's a "Дата" column on this table
   * AND it's still empty, stamp it with today's date. Only ever fires
   * once per row: the moment the date column already holds something
   * (auto-filled or hand-picked), this never touches it again.
   * Returns the key of that "Дата" column, or null when nothing to stamp.
   */
  function autoDateColumnFor(rowId: string, colKey: string, oldValue: string, newValue: string): string | null {
    if (columns[0]?.key !== colKey || oldValue.trim() || !newValue.trim()) return null;
    const dateCol = columns.find((c) => c.type === "date");
    // Первый столбец сам и есть «Дата» — ставить уже нечего. Без этой
    // проверки persistCellEdit на записанной дате снова попадал сюда с той же
    // устаревшей `rows` (дата «ещё пустая») и писал дату по кругу без конца.
    if (!dateCol || dateCol.key === colKey) return null;
    const row = rows.find((r) => r.id === rowId);
    const currentDateValue = row?.cells[dateCol.key];
    const dateIsEmpty = currentDateValue === undefined || currentDateValue === null || currentDateValue === "";
    return dateIsEmpty ? dateCol.key : null;
  }

  /**
   * Замок строки-заказа: её ведёт ОС. Возвращает причину или null.
   * Без `viewer` (личная зона) замка нет.
   */
  function lockOf(rowId: string, colKey: string): string | null {
    // Столбцы только для чтения («Итого», «Даты» стола ОС): вставка, маркер
    // заполнения и очистка диапазона их тоже не пишут.
    const fixed = lockedKeys?.[colKey];
    if (fixed) return fixed;
    if (!viewer) return null;
    return cellLockReason(rows.find((r) => r.id === rowId), colKey, viewer, lockCtx);
  }

  async function persistCellEdit(rowId: string, colKey: string, oldValue: string, newValue: string) {
    const locked = lockOf(rowId, colKey);
    if (locked) {
      toast.error(locked);
      return;
    }
    const col = columns.find((c) => c.key === colKey);
    if (col?.type === "url") {
      newValue = newValue.trim();
      if (newValue && !isHttpUrl(newValue)) {
        toast.error("Нужна ссылка http(s) — Google Drive, Яндекс Диск или любая https");
        return;
      }
    }
    const version = pendingWrites.begin(rowId, colKey, newValue);
    try {
      await updateRowCell({
        workspaceId,
        pageId: page.id,
        pageName: page.name,
        rowId,
        field: colKey,
        fieldLabel: col?.label ?? colKey,
        oldValue,
        newValue,
        userId,
        userName,
      });
      pendingWrites.confirm(rowId, colKey, version);

      const autoDateKey = autoDateColumnFor(rowId, colKey, oldValue, newValue);
      if (autoDateKey) await persistCellEdit(rowId, autoDateKey, "", String(Date.now()));
    } catch (error) {
      pendingWrites.fail(rowId, colKey, version);
      if (isRowsMigratingError(error)) {
        toast.error("Идёт перенос строк таблиц", {
          description: "Правки сейчас не сохраняются — подождите пару минут и повторите.",
        });
        return;
      }
      toast.error("Не удалось сохранить значение", {
        description: "Текст остался на месте. Повторите сохранение.",
        action: {
          label: "Повторить",
          onClick: () => {
            void persistCellEdit(rowId, colKey, oldValue, newValue);
          },
        },
      });
      throw error;
    }
  }

  /**
   * Несколько ячеек одной строки — одной merge-записью строки. На основной
   * вкладке история пишется по ячейке, как в updateRowCell; во вкладке
   * истории нет и так (см. updateSubPageRowCell).
   */
  async function updateRowCells(rowId: string, cells: CellEdit[]) {
    if (cells.length === 0) return;
    const filledAt = firstFillAt(rowId, cells.map((c) => c.newValue));
    if (subPageId) {
      const patch: Record<string, string | number | null> = {};
      for (const c of cells) patch[c.colKey] = c.newValue;
      await updateSubPageRowCellsBulk(workspaceId, page.id, subPageId, rowId, patch, undefined, undefined, filledAt);
      return;
    }
    await updateRowCellsWithHistory({
      workspaceId,
      pageId: page.id,
      pageName: page.name,
      rowId,
      changes: cells.map((c) => ({
        field: c.colKey,
        fieldLabel: columns.find((col) => col.key === c.colKey)?.label ?? c.colKey,
        oldValue: c.oldValue,
        newValue: c.newValue,
      })),
      userId,
      userName,
      filledAt,
    });
  }

  /**
   * Многоячеечная правка (вставка, заполнение, очистка диапазона) — ОДНА
   * запись на строку, а не на ячейку: блок 5 столбцов × 20 строк стоил сотню
   * записей строк вместо двадцати. Всё остальное — как у persistCellEdit на
   * каждую ячейку: проверка ссылок, pendingWrites begin/confirm/fail по ячейке,
   * автодата первого столбца (здесь она едет в той же записи строки), история.
   * Undo-команду кладёт вызывающий — одну на всю операцию, и её undo/redo
   * зовут эту же функцию. Бросает, если не сохранилась хоть одна строка, —
   * иначе undoStore счёл бы отмену выполненной.
   */
  async function persistCellEdits(edits: CellEdit[]) {
    const byRow = new Map<string, CellEdit[]>();
    let badUrl = false;
    // Строки-заказы правит ОС: чужие ячейки в пачке просто не пишем и
    // говорим об этом ОДИН раз, а не по тосту на ячейку.
    let lockedReason: string | null = null;
    const allowed = edits.filter((e) => {
      const reason = lockOf(e.rowId, e.colKey);
      if (reason) lockedReason = lockedReason ?? reason;
      return !reason;
    });
    if (lockedReason) toast.error(lockedReason);
    edits = allowed;
    if (edits.length === 0) return;
    for (const e of edits) {
      let newValue = e.newValue;
      if (columns.find((c) => c.key === e.colKey)?.type === "url") {
        newValue = newValue.trim();
        if (newValue && !isHttpUrl(newValue)) {
          badUrl = true;
          continue;
        }
      }
      const list = byRow.get(e.rowId) ?? [];
      list.push({ ...e, newValue });
      byRow.set(e.rowId, list);
    }
    // Один тост на всю вставку, а не по тосту на каждую плохую ячейку.
    if (badUrl) toast.error("Нужна ссылка http(s) — Google Drive, Яндекс Диск или любая https");

    const failed: CellEdit[] = [];
    let firstError: unknown = null;
    await Promise.all(
      [...byRow].map(async ([rowId, rowEdits]) => {
        const cells = [...rowEdits];
        // Автодата — тем же правилом, что в persistCellEdit, но той же записью
        // строки, а не второй. Если «Дата» сама есть во вставке, побеждает
        // вставленное значение.
        for (const e of rowEdits) {
          const dateKey = autoDateColumnFor(rowId, e.colKey, e.oldValue, e.newValue);
          if (dateKey && !cells.some((c) => c.colKey === dateKey)) {
            cells.push({ rowId, colKey: dateKey, oldValue: "", newValue: String(Date.now()) });
          }
        }
        const versions = cells.map((c) => pendingWrites.begin(rowId, c.colKey, c.newValue));
        try {
          await updateRowCells(rowId, cells);
          cells.forEach((c, i) => pendingWrites.confirm(rowId, c.colKey, versions[i]));
        } catch (error) {
          cells.forEach((c, i) => pendingWrites.fail(rowId, c.colKey, versions[i]));
          failed.push(...rowEdits);
          if (firstError === null) firstError = error;
        }
      })
    );
    if (failed.length === 0) return;
    if (isRowsMigratingError(firstError)) {
      toast.error("Идёт перенос строк таблиц", {
        description: "Правки сейчас не сохраняются — подождите пару минут и повторите.",
      });
      return;
    }
    // Один тост на всю операцию: при кончившейся квоте по тосту на ячейку
    // засыпали бы весь экран.
    toast.error("Не удалось сохранить значение", {
      description: `Не сохранено ячеек: ${failed.length}. Текст остался на месте. Повторите сохранение.`,
      action: {
        label: "Повторить",
        onClick: () => {
          void persistCellEdits(failed).catch(() => undefined);
        },
      },
    });
    throw firstError;
  }

  async function moveActiveAfterCommit(direction: "down" | "right" | "left" | "none", rowIsBlank = false) {
    if (direction === "none" || !activeCell) return;
    const navCols = displayColumns;
    const rIdx = rowIds.indexOf(activeCell.rowId);
    const cIdx = navCols.findIndex((c) => c.key === activeCell.colKey);

    async function createRowAndGo(colKey: string) {
      if (!canEdit) return;
      const cells: Record<string, string | number | null> = {};
      columns.forEach((c) => (cells[c.key] = ""));
      const newRow = await addRowService(workspaceId, page.id, cells, nextRowOrder());
      pushCommand({
        undo: () => deleteRowService(workspaceId, page.id, newRow.id),
        redo: () => {
          addRowService(workspaceId, page.id, cells, nextRowOrder());
        },
      });
      const nextAddr = { rowId: newRow.id, colKey };
      requestAnimationFrame(() => {
        setActiveCell(nextAddr);
        setRangeAnchor(nextAddr);
        const col = navCols.find((c) => c.key === nextAddr.colKey);
        if (col && !isOptionColumn(col.type) && col.type !== "date") {
          setEditingCell(nextAddr);
          setEditValue("");
        }
        containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight });
      });
    }

    // Enter on the last row: auto-create a fresh empty row and jump straight
    // into editing the same column on it — matches Google Sheets/Airtable's
    // "just keep typing" flow instead of getting stuck on the last row.
    // …unless this last row is still blank: one empty slot at the bottom is
    // enough, pressing Enter on it must not stack up more.
    if (direction === "down" && rIdx === rowIds.length - 1) {
      if (!rowIsBlank) await createRowAndGo(activeCell.colKey);
      return;
    }

    if (direction === "right" && cIdx >= navCols.length - 1 && rIdx === rowIds.length - 1) {
      if (!rowIsBlank) await createRowAndGo(navCols[0]?.key ?? activeCell.colKey);
      return;
    }

    let nr = rIdx;
    let nc = Math.max(0, cIdx);
    if (direction === "down") nr = Math.min(rowIds.length - 1, rIdx + 1);
    if (direction === "right") {
      if (cIdx >= navCols.length - 1) {
        nr = Math.min(rowIds.length - 1, rIdx + 1);
        nc = 0;
      } else {
        nc = cIdx + 1;
      }
    }
    if (direction === "left") {
      if (cIdx <= 0) {
        if (rIdx <= 0) return;
        nr = rIdx - 1;
        nc = navCols.length - 1;
      } else {
        nc = cIdx - 1;
      }
    }
    const next = { rowId: rowIds[nr], colKey: navCols[nc].key };
    setActiveCell(next);
    setRangeAnchor(next);

    // After Enter/Tab, keep typing in the next text/number/url cell.
    // Status and date stay chip/calendar — no text editor.
    if (!canEdit) return;
    const col = columns.find((c) => c.key === next.colKey);
    if (!col || isOptionColumn(col.type) || col.type === "date" || lockedKeys?.[next.colKey]) return;
    const row = rows.find((r) => r.id === next.rowId);
    setEditingCell(next);
    setEditValue(String(row?.cells[next.colKey] ?? ""));
  }

  const handleCommitEdit = useCallback(
    (direction: "down" | "right" | "left" | "none" = "none") => {
      if (!editingCell) return;
      const { rowId, colKey } = editingCell;
      const row = rows.find((r) => r.id === rowId);
      const oldValue = String(row?.cells[colKey] ?? "");
      const col = columns.find((c) => c.key === colKey);
      let newValue = editValue;
      if (col?.type === "url") {
        newValue = editValue.trim();
        if (newValue && !isHttpUrl(newValue)) {
          toast.error("Нужна ссылка http(s) — Google Drive, Яндекс Диск или любая https");
          return;
        }
      }
      if (col?.type === "number" || col?.type === "currency") {
        // "1 500,50" / "2.000" / "12 000 ₸" → canonical "1500.5" / "2000" /
        // "12000", so sums, sorting and formatting all agree on the value.
        const trimmed = editValue.trim();
        if (trimmed && parseLooseNumber(trimmed) === null) {
          toast.warning("Это не похоже на число — сохранено как текст", {
            description: "В итогах и сортировке такая ячейка не участвует.",
          });
          newValue = trimmed;
        } else {
          newValue = normalizeNumericInput(trimmed);
        }
      } else if (col?.type !== "text") {
        newValue = editValue.trim();
      }
      setEditingCell(null);
      const rowIsBlank = row ? isBlankRowNow(row, { colKey, value: newValue }) : false;
      if (oldValue !== newValue) {
        persistCellEdit(rowId, colKey, oldValue, newValue);
        pushCommand({
          undo: () => persistCellEdit(rowId, colKey, newValue, oldValue),
          redo: () => persistCellEdit(rowId, colKey, oldValue, newValue),
        });
      }
      moveActiveAfterCommit(direction, rowIsBlank);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editingCell, editValue, rows]
  );

  function handleStatusChange(rowId: string, colKey: string, value: string) {
    const row = rows.find((r) => r.id === rowId);
    const oldValue = String(row?.cells[colKey] ?? "");
    // Выбрали то, что уже стоит, — писать нечего (раньше это была запись в
    // строку, запись в историю и пустая undo-команда). Сверяем и с базой, и с
    // ещё летящей своей записью: при быстром «А → Б → А» база ещё помнит «А»,
    // но в пути «Б», и без второй проверки последнее «А» потерялось бы.
    const shownValue = String(pendingWrites.resolve(rowId, colKey, row?.cells[colKey] ?? null) ?? "");
    if (value === oldValue && value === shownValue) return;
    persistCellEdit(rowId, colKey, oldValue, value);
    pushCommand({
      undo: () => persistCellEdit(rowId, colKey, value, oldValue),
      redo: () => persistCellEdit(rowId, colKey, oldValue, value),
    });

    // Little celebration the moment a row flips INTO "Готово" — but only on
    // that specific transition, never on every edit of an already-done row
    // (e.g. re-picking the same status, or editing an unrelated field).
    const col = columns.find((c) => c.key === colKey);
    if (col?.type === "status") {
      const options = getColumnOptions(col, activeWorkspace);
      const isDone = (v: string) => isDoneStatusLabel(options.find((o) => o.value === v)?.label ?? v);
      if (isDone(value) && !isDone(oldValue)) celebrateDone();
    }
  }

  // ---- Selection handlers ----
  function handleCellMouseDown(rowId: string, colKey: string, e: React.MouseEvent) {
    // Status/date/URL cells open a Radix Select/Popover, which render their
    // content into a document.body Portal — physically outside this <td>,
    // but React bubbles synthetic events along the COMPONENT tree, not the
    // DOM tree, so clicking an option inside that portal still reaches this
    // handler as if the click landed back on the cell. Left unchecked, that
    // steals grid focus and resets activeCell/rangeAnchor on every option
    // click, fighting Radix's own close/commit sequence — this is the
    // structural cause behind "status dropdown won't close" and generally
    // janky clicking around any in-cell popover. e.target still points at
    // the real (portaled) DOM node, so bail out here if it's not actually
    // inside this table's own DOM.
    if (e.target instanceof Node && containerRef.current && !containerRef.current.contains(e.target)) return;
    // A redundant mousedown on the cell that's ALREADY being edited (the
    // second half of a real double-click, or any stray extra click) must be
    // a no-op. `containerRef.current.focus()` below steals DOM focus away
    // from the live edit <input> — that fires the input's onBlur, which
    // COMMITS AND CLOSES the edit out from under the user before they've
    // typed anything, which is the actual mechanism behind "double-click
    // and I can't write anything" (confirmed by reproducing it directly:
    // the second mousedown alone was enough to null out editingCell via
    // the blur → onCommitEdit chain, with no dblclick handler involved).
    if (editingCellRef.current?.rowId === rowId && editingCellRef.current?.colKey === colKey) return;
    const col = columns.find((c) => c.key === colKey);
    const isUrl = col?.type === "url";
    const isSelectLike = Boolean(col && (isOptionColumn(col.type) || col.type === "date"));
    // URL / status / date need the native tap (paste, select, calendar).
    // Text cells preventDefault so the grid keeps keyboard focus for arrows.
    if (!isUrl && !isSelectLike) e.preventDefault();
    containerRef.current?.focus({ preventScroll: true });
    if (editingCellRef.current && (editingCellRef.current.rowId !== rowId || editingCellRef.current.colKey !== colKey)) {
      handleCommitEdit("none");
    }
    const addr = { rowId, colKey };
    if (e.shiftKey && activeCell) {
      setActiveCell(addr);
      return;
    }
    setRangeAnchor(addr);
    setActiveCell(addr);
    isSelectingRef.current = !isUrl && !isSelectLike && e.button === 0;
    // Right/middle click only moves the active cell (so the context menu
    // knows which value was clicked) — it must never start text editing.
    if (e.button !== 0) return;
    if (!canEdit || !col) return;
    if (isSelectLike) return;
    const row = rows.find((r) => r.id === rowId);
    const raw = String(row?.cells[colKey] ?? "");
    if (isUrl && parseHttpUrl(raw)) return;
    const already = activeCell?.rowId === rowId && activeCell?.colKey === colKey && !e.shiftKey;
    const longText = raw.length > 42 && col?.type !== "number" && col?.type !== "currency";
    if (coarsePointer && !isSelectLike && !isUrl) {
      if (already) {
        if (longText && !(expandedTextCell?.rowId === rowId && expandedTextCell?.colKey === colKey)) {
          setExpandedTextCell({ rowId, colKey });
          return;
        }
        startEditing(rowId, colKey);
        return;
      }
      return;
    }
    // Desktop: the first click only SELECTS. Editing on mousedown (as this
    // used to) turned every click into an open editor — no drag-selecting
    // a range, no arrow keys, no Ctrl+C/V or fill handle on cells. A click
    // on the cell that's already selected edits (handleCellClick, after the
    // mouse comes back up without dragging); so do double-click, Enter/F2
    // and just starting to type.
    clickToEditRef.current = already ? addr : null;
  }

  function handleCellClick(rowId: string, colKey: string) {
    const pending = clickToEditRef.current;
    clickToEditRef.current = null;
    if (!pending || pending.rowId !== rowId || pending.colKey !== colKey) return;
    // A drag that wandered off and came back still moved the selection.
    if (rangeAnchor && (rangeAnchor.rowId !== rowId || rangeAnchor.colKey !== colKey)) return;
    startEditing(rowId, colKey);
  }

  function handleCellMouseEnter(rowId: string, colKey: string) {
    if (isSelectingRef.current) setActiveCell({ rowId, colKey });
  }

  function handleRowNumberMouseDown(rowId: string, e?: React.MouseEvent) {
    if (e?.shiftKey) {
      toggleRowChecked(rowId, true);
    } else {
      lastCheckedRowIdRef.current = rowId;
      setSelectedRowIds(new Set([rowId]));
    }
    const first = displayColumns[0]?.key ?? columns[0].key;
    const last = displayColumns[displayColumns.length - 1]?.key ?? columns[columns.length - 1].key;
    setRangeAnchor({ rowId, colKey: first });
    setActiveCell({ rowId, colKey: last });
  }

  useEffect(() => {
    function onUp() {
      isSelectingRef.current = false;
    }
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, []);

  // ---- Clipboard ----
  function buildMatrixFromBounds(bounds: NonNullable<ReturnType<typeof getSelectionBounds>>) {
    const rowsById = new Map(rows.map((r) => [r.id, r]));
    const matrix: string[][] = [];
    for (let r = bounds.rowStart; r <= bounds.rowEnd; r++) {
      const rowData = rowsById.get(rowIds[r]);
      const line: string[] = [];
      for (let c = bounds.colStart; c <= bounds.colEnd; c++) {
        const col = displayColumns[c];
        if (!rowData) {
          line.push("");
          continue;
        }
        const raw = String(rowData.cells[col.key] ?? "");
        if (isOptionColumn(col.type)) {
          line.push(col.statusOptions?.find((o) => o.value === raw)?.label ?? "");
        } else {
          line.push(raw);
        }
      }
      matrix.push(line);
    }
    return matrix;
  }

  /** Единственный вход в буфер: и системный, и свой — со схемой столбцов. */
  function pushClipboard(matrix: string[][], cols: PageColumn[], kind: TableClipboardKind) {
    const text = matrix.map((line) => line.join("\t")).join("\n");
    setTableClipboard({
      text,
      matrix,
      columns: cols.map((c) => ({ label: c.label, type: c.type })),
      kind,
      source: { pageId: page.id, subPageId: subPageId ?? null, name: page.name },
    });
    setClipboardStamp((n) => n + 1);
    navigator.clipboard?.writeText(text).catch(() => {});
  }

  function handleCopy() {
    const bounds = getSelectionBounds();
    if (!bounds) return;
    const matrix = buildMatrixFromBounds(bounds);
    pushClipboard(matrix, displayColumns.slice(bounds.colStart, bounds.colEnd + 1), "range");
  }

  /** Весь столбец целиком — ровно то, что видно сейчас (фильтры и сортировка). */
  function handleCopyColumn(colKey: string) {
    const colIdx = displayColumns.findIndex((c) => c.key === colKey);
    if (colIdx < 0 || rowIds.length === 0) return;
    const col = displayColumns[colIdx];
    const matrix = buildMatrixFromBounds({ rowStart: 0, rowEnd: rowIds.length - 1, colStart: colIdx, colEnd: colIdx });
    // Хвост пустых слотов не копируем: вставленный, он стёр бы низ чужого стола.
    while (matrix.length > 0 && !(matrix[matrix.length - 1][0] ?? "").trim()) matrix.pop();
    if (matrix.length === 0) {
      toast.info("В столбце нечего копировать");
      return;
    }
    pushClipboard(matrix, [col], "column");
    toast.success(`Столбец «${col.label}» скопирован — ${matrix.length} знач.`);
  }

  /** Вставить буфер в этот столбец с первой строки — пункт меню столбца. */
  async function handlePasteColumn(colKey: string) {
    if (!canEdit) return;
    const payload = peekTableClipboard();
    if (!payload || payload.matrix.length === 0) return;
    const col = displayColumns.find((c) => c.key === colKey);
    await applyMatrixPasteAt(payload.matrix, 0, 0, { colKeys: [colKey] });
    toast.success(`Вставлено в «${col?.label ?? ""}» — ${payload.matrix.length} знач.`);
  }

  async function applyMatrixPaste(matrix: string[][]) {
    if (!canEdit || !activeCell || matrix.length === 0) return;
    const bounds = getSelectionBounds();
    const single = matrix.length === 1 && matrix[0].length === 1;
    if (single && bounds && (bounds.rowEnd > bounds.rowStart || bounds.colEnd > bounds.colStart)) {
      const val = matrix[0][0];
      const filled: string[][] = [];
      for (let r = bounds.rowStart; r <= bounds.rowEnd; r++) {
        filled.push(Array.from({ length: bounds.colEnd - bounds.colStart + 1 }, () => val));
      }
      matrix = filled;
      const startRowIdxFill = bounds.rowStart;
      const startColIdxFill = bounds.colStart;
      await applyMatrixPasteAt(matrix, startRowIdxFill, startColIdxFill);
      return;
    }
    const startRowIdx = rowIds.indexOf(activeCell.rowId);
    const startColIdx = displayColumns.findIndex((c) => c.key === activeCell.colKey);
    if (startRowIdx === -1 || startColIdx === -1) return;
    await applyMatrixPasteAt(matrix, startRowIdx, startColIdx);
  }

  /**
   * `colKeys` — раскладка «умной вставки»: столбец буфера → столбец стола
   * (null = пропустить). Без неё вставка идёт по порядку от `startColIdx`, как
   * в любой таблице. `createMissing` приходит из диалога, где про нехватку
   * строк уже спросили, — тогда второй раз не спрашиваем.
   */
  async function applyMatrixPasteAt(
    matrix: string[][],
    startRowIdx: number,
    startColIdx: number,
    opts?: { colKeys?: (string | null)[]; createMissing?: boolean }
  ) {
    const mappedColumns = opts?.colKeys ?? null;
    const columnAt = (offset: number) => {
      if (!mappedColumns) return displayColumns[startColIdx + offset];
      const key = mappedColumns[offset];
      return key ? displayColumns.find((c) => c.key === key) : undefined;
    };

    if (!mappedColumns) {
      const pastedCols = Math.max(...matrix.map((line) => line.length));
      const availableCols = displayColumns.length - startColIdx;
      if (pastedCols > availableCols) {
        toast.info(`Вставлено ${availableCols} из ${pastedCols} столбцов — правее столбцов не нашлось`);
      }
    }

    const missingRows = startRowIdx + matrix.length - rowIds.length;
    let effectiveRowIds = rowIds;
    if (missingRows > 0) {
      const create =
        opts?.createMissing ??
        (await confirmDialog({
          title: `Создать ещё ${missingRows} строк(и)?`,
          description: "Во вставленных данных больше строк, чем осталось в таблице ниже выбранной ячейки.",
          confirmLabel: "Создать и вставить",
          cancelLabel: "Вставить без новых строк",
        }));
      if (!create) {
        matrix = matrix.slice(0, rowIds.length - startRowIdx);
      } else {
        const newIds: string[] = [];
        for (let i = 0; i < missingRows; i++) {
          const cells: Record<string, string | number | null> = {};
          columns.forEach((c) => (cells[c.key] = ""));
          const newRow = await addRowService(workspaceId, page.id, cells, nextRowOrder() + i);
          newIds.push(newRow.id);
        }
        effectiveRowIds = [...rowIds, ...newIds];
      }
    }

    // Collect every changed cell first and push ONE undo command covering
    // the whole paste — pushing one command per cell (as this used to)
    // meant a single Ctrl+Z after a multi-cell paste only restored the
    // LAST cell touched, leaving the rest of the pasted block in place.
    const edits: { rowId: string; colKey: string; oldValue: string; newValue: string }[] = [];
    matrix.forEach((line, ri) => {
      const rowId = effectiveRowIds[startRowIdx + ri];
      if (!rowId) return;
      const row = rows.find((r) => r.id === rowId);
      const isNewlyCreatedRow = !row;
      line.forEach((val, ci) => {
        const col = columnAt(ci);
        if (!col) return;
        const oldValue = isNewlyCreatedRow ? "" : String(row!.cells[col.key] ?? "");
        let newValue = val;
        if (isOptionColumn(col.type)) {
          const match = col.statusOptions?.find((o) => o.label.toLowerCase() === val.trim().toLowerCase());
          newValue = match ? match.value : oldValue;
        } else if (col.type === "number" || col.type === "currency") {
          newValue = normalizeNumericInput(val);
        } else if (col.type !== "text") {
          newValue = val.trim();
        }
        if (newValue !== oldValue) edits.push({ rowId, colKey: col.key, oldValue, newValue });
      });
    });
    if (edits.length === 0) return;
    // Одна запись на строку, а не на ячейку — см. persistCellEdits. Тост об
    // ошибке она показывает сама.
    persistCellEdits(edits).catch(() => undefined);
    pushCommand({
      undo: () => persistCellEdits(edits.map(invertCellEdit)),
      redo: () => persistCellEdits(edits),
    });
  }

  async function handlePaste() {
    let text: string | null = null;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      // Буфер читать не дали — ниже это значит «верь своей копии».
      text = null;
    }
    // Пустой ответ буфера тоже значит «прочитать не смогли»: иначе после
    // запрета на запись в системный буфер Ctrl+V не делал бы ничего вообще.
    const internal = readTableClipboard(text && text.trim() ? text : null);
    if (internal) {
      await startPaste(internal.matrix, internal);
      return;
    }
    if (!text) return;
    await startPaste(parseClipboardMatrix(text), null);
  }

  /**
   * Решает, что это за вставка. Внутри той же вкладки — обычная, от активной
   * ячейки: человек видит оба столбца и ткнул куда хотел. Из Excel или из
   * другого стола — подбираем столбцы по подписям и содержимому: один столбец
   * с уверенным адресом кладём молча, остальное показываем в диалоге.
   */
  async function startPaste(matrix: string[][], internal: TableClipboardPayload | null) {
    if (!canEdit || !activeCell || matrix.length === 0) return;
    const sameTable =
      internal && internal.source.pageId === page.id && internal.source.subPageId === (subPageId ?? null);
    // «Копировать столбец» — перенос столбца целиком, он всегда ложится с первой
    // строки: иначе курсор, стоящий на седьмой, уводил бы весь столбец вниз и
    // просил дописать семь строк в конец.
    const columnCopy = internal?.kind === "column";
    if (internal && sameTable) {
      if (columnCopy) {
        const colIdx = displayColumns.findIndex((c) => c.key === activeCell.colKey);
        await applyMatrixPasteAt(matrix, 0, Math.max(0, colIdx));
        return;
      }
      await applyMatrixPaste(matrix);
      return;
    }
    const guess = guessPasteMapping({ matrix, columns: displayColumns, sourceColumns: internal?.columns ?? null });
    if (guess.matched === 0) {
      await applyMatrixPaste(matrix);
      return;
    }
    const startRowIdx = columnCopy ? 0 : Math.max(0, rowIds.indexOf(activeCell.rowId));
    const width = Math.max(...matrix.map((line) => line.length));
    if (width === 1 && guess.minScore >= 4 && guess.mapping[0]) {
      const body = guess.hasHeader ? matrix.slice(1) : matrix;
      if (body.length === 0) return;
      const col = displayColumns.find((c) => c.key === guess.mapping[0]);
      await applyMatrixPasteAt(body, startRowIdx, 0, { colKeys: guess.mapping });
      toast.success(`Вставлено в «${col?.label ?? ""}» — ${body.length} знач.`);
      return;
    }
    smartPasteStartRef.current = {
      rowIdx: startRowIdx,
      colIdx: Math.max(
        0,
        displayColumns.findIndex((c) => c.key === activeCell.colKey)
      ),
    };
    setSmartPaste({
      matrix,
      columns: displayColumns,
      guess,
      availableRows: Math.max(0, rowIds.length - startRowIdx),
      sourceLabel: internal ? internal.source.name : "буфера обмена",
    });
  }

  async function applySmartPaste(result: SmartPasteResult) {
    const request = smartPaste;
    const start = smartPasteStartRef.current;
    setSmartPaste(null);
    if (!request || !start) return;
    const body = result.hasHeader ? request.matrix.slice(1) : request.matrix;
    if (body.length === 0) return;
    if (result.positional) {
      await applyMatrixPasteAt(body, start.rowIdx, start.colIdx, { createMissing: result.createMissing });
      return;
    }
    const used = result.mapping.filter(Boolean).length;
    await applyMatrixPasteAt(body, start.rowIdx, 0, { colKeys: result.mapping, createMissing: result.createMissing });
    toast.success(`Вставлено: ${body.length} стр. в ${used} стб.`);
  }

  function clearSelectedCells() {
    if (!canEdit) return;
    const bounds = getSelectionBounds();
    if (!bounds) return;
    // Batch all cleared cells into ONE undo command (see the same fix and
    // rationale on applyMatrixPasteAt above) — one command per cell meant
    // a single Ctrl+Z after clearing a block only restored the last cell.
    const edits: CellEdit[] = [];
    for (let r = bounds.rowStart; r <= bounds.rowEnd; r++) {
      const row = rows.find((rr) => rr.id === rowIds[r]);
      if (!row) continue;
      for (let c = bounds.colStart; c <= bounds.colEnd; c++) {
        const col = displayColumns[c];
        if (!col) continue;
        const oldValue = String(row.cells[col.key] ?? "");
        if (oldValue) edits.push({ rowId: row.id, colKey: col.key, oldValue, newValue: "" });
      }
    }
    if (edits.length === 0) return;
    // Одна запись на строку, а не на ячейку — см. persistCellEdits.
    persistCellEdits(edits).catch(() => undefined);
    pushCommand({
      undo: () => persistCellEdits(edits.map(invertCellEdit)),
      redo: () => persistCellEdits(edits),
    });
  }

  // ---- Keyboard navigation ----
  function revealCell(rowId: string, colKey: string, rowIndex: number) {
    // С группами строки тоже виртуализированы: прокручиваем к элементу тела,
    // а не к номеру строки (между строками стоят заголовки групп).
    const bodyIndex = bodyIndexByRow[Math.max(0, rowIndex)] ?? rowIndex;
    rowVirtualizer.scrollToIndex(Math.max(0, bodyIndex), { align: "auto" });
    requestAnimationFrame(() => {
      const cell = containerRef.current?.querySelector(
        `tr[data-row-id="${rowId}"] td[data-col="${colKey}"]`
      );
      (cell as HTMLElement | null)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }

  function moveSelection(direction: "up" | "down" | "left" | "right", extend: boolean) {
    if (!activeCell) return;
    const rIdx = rowIds.indexOf(activeCell.rowId);
    const cIdx = displayColumns.findIndex((c) => c.key === activeCell.colKey);
    if (rIdx === -1 || cIdx === -1) return;
    let nr = rIdx;
    let nc = cIdx;
    if (direction === "up") nr = Math.max(0, rIdx - 1);
    if (direction === "down") nr = Math.min(rowIds.length - 1, rIdx + 1);
    if (direction === "left") nc = Math.max(0, cIdx - 1);
    if (direction === "right") nc = Math.min(displayColumns.length - 1, cIdx + 1);
    const next = { rowId: rowIds[nr], colKey: displayColumns[nc].key };
    setActiveCell(next);
    if (!extend) setRangeAnchor(next);
    else if (!rangeAnchor) setRangeAnchor(activeCell);
    revealCell(next.rowId, next.colKey, nr);
  }

  // ---- Drag-to-fill ----
  // Pointer down on the corner square → the selection becomes the source
  // block; dragging over rows previews the target; release writes every
  // cell in ONE undo command, repeating the source pattern (2 rows selected
  // → A,B,A,B,…) the way spreadsheets do.
  function handleFillStart(_rowId: string, _colKey: string, e: React.PointerEvent) {
    if (!canEdit) return;
    const bounds = getSelectionBounds();
    if (!bounds) return;
    const colKeys = displayColumns.slice(bounds.colStart, bounds.colEnd + 1).map((c) => c.key);
    const sourceRowIds = rowIds.slice(bounds.rowStart, bounds.rowEnd + 1);
    fillDragRef.current = { colKeys, sourceRowIds, rowStart: bounds.rowStart, rowEnd: bounds.rowEnd };
    setFillPreview(null);
    (e.target as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const drag = fillDragRef.current;
      if (!drag) return;
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      const tr = el?.closest<HTMLElement>("tr[data-row-id]");
      const rowId = tr?.dataset.rowId;
      if (!rowId) return;
      const idx = rowIds.indexOf(rowId);
      if (idx === -1) return;
      if (idx > drag.rowEnd) setFillPreview({ colKeys: drag.colKeys, rowStart: drag.rowEnd + 1, rowEnd: idx });
      else if (idx < drag.rowStart) setFillPreview({ colKeys: drag.colKeys, rowStart: idx, rowEnd: drag.rowStart - 1 });
      else setFillPreview(null);
      const container = containerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        if (ev.clientY > rect.bottom - 24) container.scrollTop += 12;
        else if (ev.clientY < rect.top + 60) container.scrollTop -= 12;
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      const drag = fillDragRef.current;
      const preview = fillPreviewRef.current;
      fillDragRef.current = null;
      setFillPreview(null);
      if (drag && preview) applyFill(drag, preview);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function applyFill(
    drag: { colKeys: string[]; sourceRowIds: string[] },
    target: { colKeys: string[]; rowStart: number; rowEnd: number }
  ) {
    const byId = new Map(rows.map((r) => [r.id, r]));
    const edits: { rowId: string; colKey: string; oldValue: string; newValue: string }[] = [];
    const n = drag.sourceRowIds.length;
    const targetIds = rowIds.slice(target.rowStart, target.rowEnd + 1);
    targetIds.forEach((destId, i) => {
      const srcRow = byId.get(drag.sourceRowIds[i % n]);
      const dest = byId.get(destId);
      if (!srcRow || !dest) return;
      for (const colKey of drag.colKeys) {
        const newValue = String(srcRow.cells[colKey] ?? "");
        const oldValue = String(dest.cells[colKey] ?? "");
        if (newValue !== oldValue) edits.push({ rowId: destId, colKey, oldValue, newValue });
      }
    });
    if (edits.length === 0) return;
    // Одна запись на строку, а не на ячейку — см. persistCellEdits. Тост об
    // ошибке она показывает сама.
    persistCellEdits(edits).catch(() => undefined);
    pushCommand({
      undo: () => persistCellEdits(edits.map(invertCellEdit)),
      redo: () => persistCellEdits(edits),
    });
    // Extend the selection over the filled block so a second drag continues it.
    const last = targetIds[targetIds.length - 1];
    const first = drag.sourceRowIds[0];
    const lastCol = drag.colKeys[drag.colKeys.length - 1];
    const firstCol = drag.colKeys[0];
    if (target.rowEnd > rowIds.indexOf(drag.sourceRowIds[n - 1])) {
      setRangeAnchor({ rowId: first, colKey: firstCol });
      setActiveCell({ rowId: last, colKey: lastCol });
    } else {
      setRangeAnchor({ rowId: drag.sourceRowIds[n - 1], colKey: lastCol });
      setActiveCell({ rowId: targetIds[0], colKey: firstCol });
    }
    toast.success(`Заполнено ячеек: ${edits.length}`, { action: { label: "Отменить", onClick: () => undoLastCommand() } });
  }

  function selectAllCells() {
    if (rowIds.length === 0 || displayColumns.length === 0) return;
    setRangeAnchor({ rowId: rowIds[0], colKey: displayColumns[0].key });
    setActiveCell({ rowId: rowIds[rowIds.length - 1], colKey: displayColumns[displayColumns.length - 1].key });
  }

  /** Ctrl+Arrow: jump to the table edge in that direction (Shift extends). */
  function jumpToEdge(direction: "up" | "down" | "left" | "right", extend: boolean) {
    if (!activeCell) return;
    const rIdx = rowIds.indexOf(activeCell.rowId);
    const cIdx = displayColumns.findIndex((c) => c.key === activeCell.colKey);
    if (rIdx === -1 || cIdx === -1) return;
    const nr = direction === "up" ? 0 : direction === "down" ? rowIds.length - 1 : rIdx;
    const nc = direction === "left" ? 0 : direction === "right" ? displayColumns.length - 1 : cIdx;
    const next = { rowId: rowIds[nr], colKey: displayColumns[nc].key };
    setActiveCell(next);
    if (!extend) setRangeAnchor(next);
    else if (!rangeAnchor) setRangeAnchor(activeCell);
    revealCell(next.rowId, next.colKey, nr);
  }

  /** PageUp/PageDown: move by one viewport of rows. */
  function movePage(direction: "up" | "down", extend: boolean) {
    if (!activeCell) return;
    const rIdx = rowIds.indexOf(activeCell.rowId);
    if (rIdx === -1) return;
    const viewport = containerRef.current?.clientHeight ?? 600;
    const step = Math.max(1, Math.floor(viewport / rowHeight) - 1);
    const nr = direction === "up" ? Math.max(0, rIdx - step) : Math.min(rowIds.length - 1, rIdx + step);
    const next = { rowId: rowIds[nr], colKey: activeCell.colKey };
    setActiveCell(next);
    if (!extend) setRangeAnchor(next);
    else if (!rangeAnchor) setRangeAnchor(activeCell);
    revealCell(next.rowId, next.colKey, nr);
  }

  // Tab at the very last column wraps to the first column of the NEXT row
  // (spreadsheet convention) — and if that's also the last row, creates a
  // fresh empty one first, mirroring Enter's same auto-create-row behavior
  // in moveActiveAfterCommit above. Without this, Tab-ing through a wide
  // table just got stuck at the last cell of the last row.
  async function handleTabForward() {
    if (!activeCell) return;
    const rIdx = rowIds.indexOf(activeCell.rowId);
    const cIdx = displayColumns.findIndex((c) => c.key === activeCell.colKey);
    if (cIdx !== displayColumns.length - 1) {
      moveSelection("right", false);
      return;
    }
    if (rIdx !== rowIds.length - 1) {
      const next = { rowId: rowIds[rIdx + 1], colKey: displayColumns[0].key };
      setActiveCell(next);
      setRangeAnchor(next);
      revealCell(next.rowId, next.colKey, rIdx + 1);
      return;
    }
    if (!canEdit) return;
    const lastRow = rows.find((r) => r.id === activeCell.rowId);
    if (lastRow && isBlankRowNow(lastRow)) return;
    const cells: Record<string, string | number | null> = {};
    columns.forEach((c) => (cells[c.key] = ""));
    const newRow = await addRowService(workspaceId, page.id, cells, nextRowOrder());
    pushCommand({
      undo: () => deleteRowService(workspaceId, page.id, newRow.id),
      redo: () => {
        addRowService(workspaceId, page.id, cells, nextRowOrder());
      },
    });
    const nextAddr = { rowId: newRow.id, colKey: displayColumns[0]?.key ?? columns[0].key };
    requestAnimationFrame(() => {
      setActiveCell(nextAddr);
      setRangeAnchor(nextAddr);
      containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight });
    });
  }

  // The handler closes over lots of per-render state (activeCell, columns,
  // filters, etc). Rather than re-attaching a window listener on every
  // render, we keep the DOM listener mounted once and always dispatch
  // through a ref pointing at the latest closure.

  function fillDown() {
    if (!canEdit || !activeCell) return;
    const bounds = getSelectionBounds();
    if (bounds && bounds.rowEnd > bounds.rowStart) {
      // Batch into ONE undo command — see applyMatrixPasteAt/clearSelectedCells
      // above for why one command per cell breaks Ctrl+Z on a multi-cell op.
      const edits: { rowId: string; colKey: string; oldValue: string; newValue: string }[] = [];
      for (let c = bounds.colStart; c <= bounds.colEnd; c++) {
        const col = displayColumns[c];
        if (!col) continue;
        const srcRow = rows.find((r) => r.id === rowIds[bounds.rowStart]);
        const src = String(srcRow?.cells[col.key] ?? "");
        for (let r = bounds.rowStart + 1; r <= bounds.rowEnd; r++) {
          const destId = rowIds[r];
          const dest = rows.find((rr) => rr.id === destId);
          const old = String(dest?.cells[col.key] ?? "");
          if (old !== src) edits.push({ rowId: destId, colKey: col.key, oldValue: old, newValue: src });
        }
      }
      if (edits.length === 0) return;
      // Одна запись на строку, а не на ячейку — см. persistCellEdits. Тост об
      // ошибке она показывает сама.
      persistCellEdits(edits).catch(() => undefined);
      pushCommand({
        undo: () => persistCellEdits(edits.map(invertCellEdit)),
        redo: () => persistCellEdits(edits),
      });
      return;
    }
    const rIdx = rowIds.indexOf(activeCell.rowId);
    if (rIdx <= 0) return;
    const above = rows.find((r) => r.id === rowIds[rIdx - 1]);
    const cur = rows.find((r) => r.id === activeCell.rowId);
    const src = String(above?.cells[activeCell.colKey] ?? "");
    const old = String(cur?.cells[activeCell.colKey] ?? "");
    if (src === old) return;
    persistCellEdit(activeCell.rowId, activeCell.colKey, old, src);
    pushCommand({
      undo: () => persistCellEdit(activeCell.rowId, activeCell.colKey, src, old),
      redo: () => persistCellEdit(activeCell.rowId, activeCell.colKey, old, src),
    });
  }

  async function insertRowRelative(anchorId: string, where: "above" | "below") {
    if (!canEdit) return;
    // Position follows what's on screen in the ledger view, and needs a
    // manual order to stick. The ledger alone would have put the new row at
    // the bottom whatever "above"/"below" said.
    const ordered = [...rows].sort(manualRowOrder ? compareRowsByOrder : compareRowsByCreatedAt);
    const idx = ordered.findIndex((r) => r.id === anchorId);
    if (idx < 0 || (!manualRowOrder && !subPageId && !canEditStructure)) {
      await handleAddRow();
      return;
    }
    let neighbours = ordered;
    const hasDuplicateOrders = new Set(ordered.map(rowOrderValue)).size !== ordered.length;
    if (!manualRowOrder || hasDuplicateOrders) {
      const ids = ordered.map((r) => r.id);
      await persistManualOrder(ids);
      neighbours = ordered.map((r, i) => ({ ...r, order: i }));
    }
    const prev = where === "above" ? neighbours[idx - 1] : neighbours[idx];
    const next = where === "above" ? neighbours[idx] : neighbours[idx + 1];
    let order: number;
    if (prev && next) order = (prev.order + next.order) / 2;
    else if (next) order = next.order - 1;
    else if (prev) order = prev.order + 1;
    else order = 0;
    const cells: Record<string, string | number | null> = {};
    columns.forEach((c) => (cells[c.key] = ""));
    const newRow = await addRowService(workspaceId, page.id, cells, order);
    pendingScrollRowIdRef.current = newRow.id;
    pushCommand({
      undo: () => deleteRowService(workspaceId, page.id, newRow.id),
      redo: async () => { await addRowService(workspaceId, page.id, cells, order); },
    });
    const newAddr = { rowId: newRow.id, colKey: columns[0]?.key ?? "" };
    setActiveCell(newAddr);
    setRangeAnchor(newAddr);
  }

  function handleCopyRow(rowId?: string | null) {
    const id = rowId ?? contextRowIdRef.current ?? activeCell?.rowId;
    if (!id) return;
    const idx = rowIds.indexOf(id);
    if (idx < 0) return;
    const matrix = buildMatrixFromBounds({
      rowStart: idx,
      rowEnd: idx,
      colStart: 0,
      colEnd: Math.max(0, displayColumns.length - 1),
    });
    pushClipboard(matrix, displayColumns, "row");
    toast.success("Строка скопирована");
  }

  function selectColumn(colKey: string, extend: boolean) {
    if (rowIds.length === 0) return;
    const first = rowIds[0];
    const last = rowIds[rowIds.length - 1];
    if (extend && rangeAnchor) {
      setActiveCell({ rowId: last, colKey });
      return;
    }
    setRangeAnchor({ rowId: first, colKey });
    setActiveCell({ rowId: last, colKey });
  }

  const handleKeyDownRef = useRef<(e: KeyboardEvent) => void>(() => {});
  handleKeyDownRef.current = function handleKeyDown(e: KeyboardEvent) {
      // Synthetic keydowns (e.g. the one TableCell dispatches to open a
      // Radix Select from the keyboard) are not the person typing.
      if (!e.isTrusted) return;
      const isCtrl = e.ctrlKey || e.metaKey;

      // Ctrl+Z/Ctrl+Y are handled by a single, app-wide listener now
      // (GlobalUndoHotkeys, mounted in AppLayout) — not here. That listener
      // also uses e.code instead of e.key so it isn't silently broken by
      // Cyrillic/non-Latin keyboard layouts (see its own comment).

      const arrowCode =
        e.code === "ArrowUp" ? "up" : e.code === "ArrowDown" ? "down" : e.code === "ArrowLeft" ? "left" : e.code === "ArrowRight" ? "right" : null;
      if ((e.isComposing || e.key === "Process") && !editingCellRef.current) {
        if (arrowCode) e.preventDefault();
        return;
      }
      if (e.isComposing || e.key === "Process") return;
      // The row card owns the keyboard while it's open (←/→ navigate rows,
      // Esc closes) — grid shortcuts must not fire underneath it.
      if (expandedRowId) return;
      if (e.key === "Escape" && !editingCellRef.current) {
        const pop = document.querySelector("[data-radix-popper-content-wrapper], [role=listbox], [data-radix-select-content]");
        if (pop) return;
        if (filterPopover) {
          e.preventDefault();
          setFilterPopover(null);
          return;
        }
        if (activeCell) {
          e.preventDefault();
          setActiveCell(null);
          setRangeAnchor(null);
          return;
        }
        if (selectedRowIds.size > 0) {
          e.preventDefault();
          setSelectedRowIds(new Set());
        }
        return;
      }
      if (editingCellRef.current) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable=true]")) return;
      if (containerRef.current && !containerRef.current.contains(document.activeElement)) {
        if (document.activeElement !== document.body && document.activeElement !== containerRef.current) return;
      }
      // Ctrl+F: focus the table search instead of the browser's find bar.
      if (isCtrl && !e.shiftKey && !e.altKey && e.code === "KeyF" && viewMode === "table") {
        e.preventDefault();
        setFocusSearchToken((n) => n + 1);
        return;
      }
      if (!activeCell) return;

      if (isCtrl && !e.shiftKey && !e.altKey && e.code === "KeyA") {
        e.preventDefault();
        selectAllCells();
        return;
      }
      if (isCtrl && e.altKey && e.code === "KeyC") {
        e.preventDefault();
        handleCopyRow(activeCell.rowId);
        return;
      }
      if (isCtrl && e.code === "KeyC") {
        e.preventDefault();
        handleCopy();
        return;
      }
      if (isCtrl && e.code === "KeyV") {
        e.preventDefault();
        handlePaste();
        return;
      }
      if (isCtrl && e.shiftKey && e.code === "KeyD") {
        e.preventDefault();
        void handleDuplicateRowById(activeCell.rowId);
        return;
      }
      if (isCtrl && !e.shiftKey && e.code === "KeyD") {
        e.preventDefault();
        void fillDown();
        return;
      }
      if (isCtrl && (e.code === "Enter" || e.key === "Enter")) {
        e.preventDefault();
        // Same as the row menu: Ctrl+Enter below, Ctrl+Shift+Enter above.
        void insertRowRelative(activeCell.rowId, e.shiftKey ? "above" : "below");
        return;
      }
      if (isCtrl && e.code === "Space") {
        e.preventDefault();
        selectColumn(activeCell.colKey, e.shiftKey);
        return;
      }
      if (!isCtrl && e.shiftKey && e.code === "Space") {
        e.preventDefault();
        handleRowNumberMouseDown(activeCell.rowId);
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        clearSelectedCells();
        return;
      }
      if (e.key === "Enter" || e.key === "F2") {
        e.preventDefault();
        const col = columns.find((c) => c.key === activeCell.colKey);
        if (col && (isOptionColumn(col.type) || col.type === "date")) {
          if (canEdit) setOpenRequest((n) => n + 1);
          return;
        }
        startEditing(activeCell.rowId, activeCell.colKey);
        return;
      }
      if (e.code === "Space" && !isCtrl && !e.shiftKey && !e.altKey) {
        // Airtable-style: Space expands the row into its card; on a picker
        // cell it opens the picker instead.
        e.preventDefault();
        const col = columns.find((c) => c.key === activeCell.colKey);
        if (col && canEdit && (isOptionColumn(col.type) || col.type === "date")) {
          setOpenRequest((n) => n + 1);
          return;
        }
        setExpandedRowId(activeCell.rowId);
        return;
      }
      if (e.key === "PageUp" || e.key === "PageDown") {
        e.preventDefault();
        movePage(e.key === "PageUp" ? "up" : "down", e.shiftKey);
        return;
      }
      if (arrowCode || e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const dir = arrowCode ?? (e.key === "ArrowUp" ? "up" : e.key === "ArrowDown" ? "down" : e.key === "ArrowLeft" ? "left" : "right");
        if (isCtrl) jumpToEdge(dir, e.shiftKey);
        else moveSelection(dir, e.shiftKey);
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        const first = displayColumns[0]?.key;
        if (first) {
          const rowId = isCtrl ? rowIds[0] : activeCell.rowId;
          const next = { rowId, colKey: first };
          setActiveCell(next);
          if (!e.shiftKey) setRangeAnchor(next);
          revealCell(next.rowId, next.colKey, rowIds.indexOf(rowId));
        }
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        const last = displayColumns[displayColumns.length - 1]?.key;
        if (last) {
          const rowId = isCtrl ? rowIds[rowIds.length - 1] : activeCell.rowId;
          const next = { rowId, colKey: last };
          setActiveCell(next);
          if (!e.shiftKey) setRangeAnchor(next);
          revealCell(next.rowId, next.colKey, rowIds.indexOf(rowId));
        }
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        if (e.shiftKey) moveSelection("left", false);
        else handleTabForward();
        return;
      }
      if (!isCtrl && !e.altKey && e.key.length === 1) {
        const col = columns.find((c) => c.key === activeCell.colKey);
        if (col && isOptionColumn(col.type)) {
          // Quick-pick: typing a letter on a status/responsible/custom cell
          // jumps straight to the first option whose label starts with it —
          // no need to open the dropdown just to pick something short.
          // Неактуальные сюда не попадают: это ровно «быстрый доступ», из
          // которого ушедший ОС и должен был исчезнуть.
          const options = splitOptionsByActivity(getColumnOptions(col, activeWorkspace)).active;
          const match = options.find((o) => o.label.toLowerCase().startsWith(e.key.toLowerCase()));
          if (match) handleStatusChange(activeCell.rowId, col.key, match.value);
          return;
        }
        if (col) startEditing(activeCell.rowId, activeCell.colKey, e.key);
      }
  };

  useEffect(() => {
    function dispatch(e: KeyboardEvent) {
      handleKeyDownRef.current(e);
    }
    window.addEventListener("keydown", dispatch, true);
    return () => window.removeEventListener("keydown", dispatch, true);
  }, []);

  /**
   * Ширина и порядок столбцов. На «Основной» это запись в ДОКУМЕНТ СТОЛА, а
   * коллекцию pages слушают все (~28 человек): каждая такая запись — чтение у
   * каждого. Поэтому пишем только то, что правда изменилось, и с паузой
   * (schedulePageColumnsLayout склеивает серию подгонов в одну запись), а до
   * записи раскладка держится на экране здесь (layoutOverlay). Во вкладке —
   * как раньше, сразу: документ вкладки слушают только те, кто её открыл.
   */
  function saveColumnLayout(patch: Record<string, ColumnLayoutPatch>): Promise<void> {
    const changed: Record<string, ColumnLayoutPatch> = {};
    for (const col of columns) {
      const p = patch[col.key];
      if (!p) continue;
      const diff: ColumnLayoutPatch = {};
      if (p.width !== undefined && p.width !== col.width) diff.width = p.width;
      if (p.order !== undefined && p.order !== col.order) diff.order = p.order;
      if (diff.width !== undefined || diff.order !== undefined) changed[col.key] = diff;
    }
    if (Object.keys(changed).length === 0) return Promise.resolve();
    if (subPageId) return updatePageColumns(workspaceId, page.id, applyColumnLayout(columns, changed));
    const pageId = page.id;
    const scheduledFrom = page.columns;
    const token = ++layoutTokenRef.current;
    setLayoutOverlay((prev) => ({
      pageId,
      token,
      patch: { ...(prev && prev.pageId === pageId ? prev.patch : {}), ...changed },
    }));
    const freshColumns = () => {
      const main = mainColumnsRef.current;
      return main && main.pageId === pageId ? main.columns : scheduledFrom;
    };
    return schedulePageColumnsLayout(workspaceId, pageId, changed, freshColumns)
      .catch((error) => {
        toast.error("Не удалось сохранить ширину или порядок столбцов", {
          description: error instanceof Error ? error.message : undefined,
        });
      })
      .finally(() => {
        // Снимаем раскладку, только если после неё ничего не добавили: иначе
        // более поздняя правка на миг откатилась бы до своей записи.
        setLayoutOverlay((prev) => (prev && prev.token === token ? null : prev));
      });
  }

  // ---- Resize ----
  // Dragging only updates local state (resizePreview) for instant visual
  // feedback — Firestore is written exactly once, on mouseup. Writing on
  // every mousemove would flood Firestore with dozens of writes per second
  // and make the drag feel laggy for every collaborator watching the page.
  function handleColumnResizeStart(colKey: string, e: React.PointerEvent) {
    const col = columns.find((c) => c.key === colKey)!;
    const startSize = clampColumnWidth(col.type, col.width);
    resizeStateRef.current = { type: "col", colKey, startPos: e.clientX, startSize, lastValue: startSize };
    setResizePreview({ type: "col", colKey, width: startSize });
    window.addEventListener("pointermove", handleResizeMove);
    window.addEventListener("pointerup", handleResizeEnd);
  }

  function handleRowResizeStart(rowId: string, e: React.MouseEvent) {
    const row = rows.find((r) => r.id === rowId);
    const startHeight = row?.height ?? rowHeight;
    resizeStateRef.current = { type: "row", rowId, startPos: e.clientY, startSize: startHeight, lastValue: startHeight };
    setResizePreview({ type: "row", rowId, height: startHeight });
    window.addEventListener("pointermove", handleResizeMove);
    window.addEventListener("pointerup", handleResizeEnd);
  }

  function handleResizeMove(e: PointerEvent) {
    const state = resizeStateRef.current;
    if (!state) return;
    if (state.type === "col") {
      const col = columns.find((c) => c.key === state.colKey);
      const delta = e.clientX - state.startPos;
      const newWidth = clampColumnWidth(col?.type ?? "text", state.startSize + delta);
      state.lastValue = newWidth;
      setResizePreview({ type: "col", colKey: state.colKey, width: newWidth });
    } else {
      const delta = e.clientY - state.startPos;
      const newHeight = Math.max(coarsePointer ? 44 : 28, Math.round(state.startSize + delta));
      state.lastValue = newHeight;
      setResizePreview({ type: "row", rowId: state.rowId, height: newHeight });
    }
  }

  function handleResizeEnd() {
    const state = resizeStateRef.current;
    resizeStateRef.current = null;
    setResizePreview(null);
    window.removeEventListener("pointermove", handleResizeMove);
    window.removeEventListener("pointerup", handleResizeEnd);
    if (!state) return;
    if (state.type === "col") {
      // Клик по ручке без движения — ширина та же, и переписывать весь
      // список столбцов стола незачем. Сравниваем с СОХРАНЁННОЙ шириной, а не
      // со стартовой: у столбца без ширины (или вне пределов) стартовая уже
      // поправлена clampColumnWidth, и такая запись остаётся, как была.
      if (columns.find((c) => c.key === state.colKey)?.width === state.lastValue) return;
      void saveColumnLayout({ [state.colKey]: { width: state.lastValue } });
    } else {
      // То же для высоты строки: без движения — без записи.
      if (rows.find((r) => r.id === state.rowId)?.height === state.lastValue) return;
      updateRowHeight(workspaceId, page.id, state.rowId, state.lastValue);
    }
  }

  function handleAutoSizeColumn(colKey: string) {
    const col = columns.find((c) => c.key === colKey);
    if (!col) return;
    let maxPx = col.label.length * 9 + 64;
    for (const row of rows) {
      const raw = String(row.cells[colKey] ?? "");
      const text = isOptionColumn(col.type)
        ? (getColumnOptions(col, activeWorkspace).find((o) => o.value === raw)?.label ?? raw)
        : raw;
      maxPx = Math.max(maxPx, Math.min(420, 28 + text.length * 7.4));
    }
    const width = clampColumnWidth(col.type, maxPx);
    void saveColumnLayout({ [colKey]: { width } });
  }

  function handleAutoSizeAll() {
    const patch: Record<string, ColumnLayoutPatch> = {};
    for (const col of columns) {
      if (col.hidden) continue;
      let maxPx = col.label.length * 9 + 64;
      for (const row of rows) {
        const text = cellDisplayText(row, col);
        maxPx = Math.max(maxPx, Math.min(420, 28 + text.length * 7.4));
      }
      patch[col.key] = { width: clampColumnWidth(col.type, maxPx) };
    }
    void saveColumnLayout(patch);
    toast.success("Ширина столбцов подогнана");
  }

  function markRowDone(rowId: string) {
    const statusCol = displayColumns.find((c) => c.type === "status");
    if (!statusCol || !canEdit) return;
    const done = findDoneStatusOption(statusCol.statusOptions ?? []);
    if (!done) return;
    handleStatusChange(rowId, statusCol.key, done.value);
  }

  // ---- Sort / filter / pin ----
  function persistSavedViews(next: SavedTableView[]) {
    setSavedViews(next);
    writeSavedTableViews(tableViewKey, next);
  }

  async function handleSaveTableView() {
    const name = await promptDialog({
      title: "Сохранить вид",
      description: "Запомнит текущие фильтры, группировку и сортировку этого стола.",
      label: "Название вида",
      placeholder: "Например, Только в работе",
      maxLength: 40,
      confirmLabel: "Сохранить",
    });
    if (name == null) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const snapshot = captureTableView(trimmed, {
      statusFilter,
      groupByKey,
      sortState,
      filters: Object.fromEntries(Object.entries(filters).map(([k, v]) => [k, Array.from(v)])),
    });
    persistSavedViews([...savedViews.filter((v) => v.name !== snapshot.name), snapshot]);
    toast.success(`Вид «${snapshot.name}» сохранён`);
  }

  function handleApplyTableView(view: SavedTableView) {
    setStatusFilter(view.statusFilter);
    setGroupByKey(view.groupByKey);
    setCollapsedGroups(new Set());
    writePersistedGroupBy(tableViewKey, view.groupByKey);
    setSortState(view.sortState);
    localStorage.setItem(sortStorageKey(tableViewKey), JSON.stringify(view.sortState));
    setFilters(
      Object.fromEntries(Object.entries(view.filters ?? {}).map(([k, vals]) => [k, new Set(vals)]))
    );
    setPageIndex(0);
  }

  function handleDeleteTableView(view: SavedTableView) {
    persistSavedViews(savedViews.filter((v) => v.id !== view.id));
  }

  function handleSort(colKey: string) {
    const col = columns.find((c) => c.key === colKey);
    const hasSortableValue = processedRows.some((row) => !isEmptySortValue(row.cells[colKey], col?.type));
    if (!hasSortableValue) return;
    setSortState((prev) => {
      const next: SortState =
        prev.colKey !== colKey
          ? { colKey, direction: "asc" }
          : prev.direction === "asc"
            ? { colKey, direction: "desc" }
            : { colKey: null, direction: null };
      localStorage.setItem(sortStorageKey(tableViewKey), JSON.stringify(next));
      return next;
    });
  }

  function handleSortDirection(colKey: string, direction: "asc" | "desc" | null) {
    const next: SortState = direction ? { colKey, direction } : { colKey: null, direction: null };
    setSortState(next);
    localStorage.setItem(sortStorageKey(tableViewKey), JSON.stringify(next));
  }

  function clearColumnFilter(colKey: string) {
    setFilters((prev) => {
      const next = { ...prev };
      delete next[colKey];
      return next;
    });
    setPageIndex(0);
  }

  // Группировка по статусу — умолчание стола, а не фильтр: иначе «Сбросить»
  // висел бы всегда. Активной считается только группировка НЕ по умолчанию
  // (другой столбец или выключенные группы).
  const defaultGroupKey = useMemo(() => defaultGroupByKey(columns), [columns]);
  const isCustomGrouping = groupByKey !== defaultGroupKey;

  // Столбец группировки скрыли или удалили — возвращаемся к умолчанию, а не
  // группируем по невидимому. Память вкладки не трогаем: вернут столбец —
  // вернётся и запомненный выбор (readPersistedGroupBy его проверит сам).
  useEffect(() => {
    if (!groupByKey) return;
    const col = columns.find((c) => c.key === groupByKey);
    if (col && !col.hidden) return;
    setGroupByKey(defaultGroupKey);
    setCollapsedGroups(new Set());
  }, [groupByKey, columns, defaultGroupKey]);

  function changeGroupBy(key: string | null) {
    setGroupByKey(key);
    setCollapsedGroups(new Set());
    writePersistedGroupBy(tableViewKey, key);
  }

  const hasActiveFilters =
    Boolean(searchQuery.trim()) ||
    Boolean(statusFilter) ||
    Boolean(dateFilter) ||
    mineOnly ||
    isCustomGrouping ||
    Boolean(sortState.colKey) ||
    Object.values(filters).some((set) => set.size > 0);

  function resetAllFilters() {
    setSearchQuery("");
    setStatusFilter(null);
    setDateFilter(null);
    setMineOnly(false);
    // К умолчанию (статус), а не к «без групп» — и забываем запомненный выбор.
    setGroupByKey(defaultGroupKey);
    setCollapsedGroups(new Set());
    try {
      localStorage.removeItem(groupStorageKey(tableViewKey));
    } catch {
      // без хранилища — просто сброс в памяти
    }
    setFilters({});
    setSortState({ colKey: null, direction: null });
    localStorage.removeItem(sortStorageKey(tableViewKey));
    setPageIndex(0);
    setFilterPopover(null);
  }

  // Filter by value keyed on the STORED cell value (ids for option columns),
  // but shown/compared by display label — see filterValueEntries below.
  function filterOnlyCellValue(rowId: string, colKey: string, mode: "only" | "exclude") {
    const col = displayColumns.find((c) => c.key === colKey);
    const row = rows.find((r) => r.id === rowId);
    if (!col || !row) return;
    const target = String(row.cells[colKey] ?? "");
    const allValues = new Set(rows.map((r) => String(r.cells[colKey] ?? "")));
    setFilters((prev) => {
      const next = { ...prev };
      if (mode === "only") {
        const excluded = new Set<string>();
        allValues.forEach((v) => {
          if (v !== target) excluded.add(v);
        });
        next[colKey] = excluded;
      } else {
        const set = new Set(next[colKey] ?? []);
        set.add(target);
        next[colKey] = set;
      }
      return next;
    });
    setPageIndex(0);
  }

  function handleFilterClick(colKey: string, e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // FilterPopover renders as a fixed-position, fixed-width (224px) panel —
    // anchoring it to the button's raw left/bottom with no clamping sent it
    // straight off the right/bottom edge for any column near there (which is
    // most of them, on a wide table). Clamp into the viewport with a margin.
    const POPOVER_WIDTH = 256;
    const POPOVER_MAX_HEIGHT = 380;
    const margin = 8;
    const x = Math.min(Math.max(margin, rect.left), window.innerWidth - POPOVER_WIDTH - margin);
    const y =
      rect.bottom + 4 + POPOVER_MAX_HEIGHT > window.innerHeight
        ? Math.max(margin, rect.top - POPOVER_MAX_HEIGHT - 4)
        : rect.bottom + 4;
    setFilterPopover({ colKey, x, y });
  }

  function togglePin(colKey: string) {
    setPinnedKeys((prev) => (prev.includes(colKey) ? prev.filter((k) => k !== colKey) : [...prev, colKey]));
  }

  // ---- DnD (columns + rows) ----
  const sensors = useSensors(useSensor(PointerSensor, POINTER_SENSOR_OPTIONS));

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const colIds = columns.map((c) => c.id);
    if (colIds.includes(String(active.id))) {
      if (!canEditColumns) return;
      const oldIndex = columns.findIndex((c) => c.id === active.id);
      const newIndex = columns.findIndex((c) => c.id === over.id);
      const patch: Record<string, ColumnLayoutPatch> = {};
      arrayMove(columns, oldIndex, newIndex).forEach((c, i) => {
        patch[c.key] = { order: i };
      });
      await saveColumnLayout(patch);
      return;
    }

    // canReorderRows guarantees the plain view: processedRows is every row,
    // in exactly the order on screen.
    const visibleIds = processedRows.map((r) => r.id);
    if (canReorderRows && visibleIds.includes(String(active.id)) && visibleIds.includes(String(over.id))) {
      const reordered = arrayMove(visibleIds, visibleIds.indexOf(String(active.id)), visibleIds.indexOf(String(over.id)));
      const before = visibleIds;
      setOptimisticRowOrder(reordered);
      try {
        await persistManualOrder(reordered);
        // Отмена и повтор — тоже полной перенумерацией: между ними мог
        // случиться другой порядок, и частичная запись восстановила бы его
        // лишь наполовину.
        pushCommand({
          undo: () => reorderRows(workspaceId, page.id, before),
          redo: () => reorderRows(workspaceId, page.id, reordered),
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Не удалось переставить строку");
      } finally {
        setOptimisticRowOrder(null);
      }
    }
  }

  // ---- Row-level actions ----
  async function handleAddRow() {
    // A blank row already waiting? Type there instead of adding one more.
    const blank = firstBlankRow();
    setSearchQuery("");
    if (blank) {
      startEntryInRow(blank.id);
      return;
    }
    setPageIndex(0);
    const cells: Record<string, string | number | null> = {};
    columns.forEach((c) => (cells[c.key] = ""));
    const newRow = await addRowService(workspaceId, page.id, cells, nextRowOrder());
    let liveId = newRow.id;
    pushCommand({
      undo: () => deleteRowService(workspaceId, page.id, liveId),
      redo: async () => {
        const restored = await addRowService(workspaceId, page.id, cells, nextRowOrder());
        liveId = restored.id;
      },
    });
    pendingScrollRowIdRef.current = newRow.id;
    requestAnimationFrame(() => {
      setActiveCell({ rowId: newRow.id, colKey: columns[0].key });
      setRangeAnchor({ rowId: newRow.id, colKey: columns[0].key });
      if (!isOptionColumn(columns[0].type)) {
        setEditingCell({ rowId: newRow.id, colKey: columns[0].key });
        setEditValue("");
      }
      containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: "smooth" });
    });
  }

  /** Ссылка из столбца-ссылки — чтобы визитка показывала её, даже если строку завели руками. */
  function linkCell(row: PageRow, key?: string): string | null {
    if (!key) return null;
    const raw = String(row.cells[key] ?? "").trim();
    return raw || null;
  }

  // Строки, приехавшие заказом с «Заказов». Подсветку снимает только сам
  // технарь — чипом в тулбаре, поэтому новый заказ нельзя не заметить.
  const highlightedRowIds = useMemo(() => rows.filter((r) => r.highlight).map((r) => r.id), [rows]);

  async function handleClearHighlights() {
    if (highlightedRowIds.length === 0) return;
    try {
      await clearRowHighlights(workspaceId, page.id, subPageId ?? null, highlightedRowIds);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось снять подсветку");
    }
  }

  // ---- Действия для шапки стола (DeskTableActions) ----
  // Обработчики живут в ref: наружу уходят стабильные обёртки, и шапка
  // получает новый объект только когда меняются флаги can*.
  const deskActionsRef = useRef({ addRow: () => {}, quickOrder: () => {} });
  deskActionsRef.current = {
    addRow: () => void handleAddRow(),
    quickOrder: () => {
      setQuickOrderStatus(null);
      setQuickOrderOpen(true);
    },
  };
  const onActionsChangeRef = useRef(onActionsChange);
  onActionsChangeRef.current = onActionsChange;
  const hasActionsListener = Boolean(onActionsChange);
  const canAddRowAction = canEdit && !ordersFromOsOnly;
  const canQuickOrderAction = canEdit && !ordersFromOsOnly;
  // На весь экран / иммерсивно шапка стола скрыта вместе с её «+ Заказ» —
  // тогда кнопку рисует тулбар, иначе быстрый заказ было бы неоткуда открыть.
  const chromeHidden = useUiStore((s) => s.tableFullscreen || s.tableImmersive);
  useEffect(() => {
    if (!hasActionsListener) return;
    onActionsChangeRef.current?.({
      addRow: () => deskActionsRef.current.addRow(),
      quickOrder: () => deskActionsRef.current.quickOrder(),
      canAddRow: canAddRowAction,
      canQuickOrder: canQuickOrderAction,
    });
  }, [hasActionsListener, canAddRowAction, canQuickOrderAction]);
  useEffect(
    () => () => {
      onActionsChangeRef.current?.(null);
    },
    []
  );

  async function handleQuickOrder(input: QuickOrderInput) {
    const { cells, extras } = buildQuickOrderRow(columns, displayColumns, input);
    if (quickOrderStatus) {
      const statusCol = displayColumns.find((c) => c.type === "status");
      if (statusCol) cells[statusCol.key] = quickOrderStatus;
    }
    const blank = firstBlankRow();
    if (blank) {
      // Same as a new order, just into the first blank row.
      const patch: Record<string, string | number | null> = {};
      for (const [key, value] of Object.entries(cells)) if (isFilledCellValue(value)) patch[key] = value;
      const cleared = Object.fromEntries(Object.keys(patch).map((key) => [key, ""]));
      await fillRowService(workspaceId, page.id, blank.id, patch, extras ?? null);
      pushCommand({
        undo: () => fillRowService(workspaceId, page.id, blank.id, cleared, null),
        redo: () => fillRowService(workspaceId, page.id, blank.id, patch, extras ?? null),
      });
      pendingScrollRowIdRef.current = blank.id;
      toast.success("Заказ в столе", { description: "Записан в первую пустую строку" });
      return;
    }
    const newRow = await addRowService(workspaceId, page.id, cells, nextRowOrder(), extras);
    let liveId = newRow.id;
    const extrasCopy = extras;
    pushCommand({
      undo: () => deleteRowService(workspaceId, page.id, liveId),
      redo: async () => {
        const restored = await addRowService(workspaceId, page.id, cells, nextRowOrder(), extrasCopy);
        liveId = restored.id;
      },
    });
    pendingScrollRowIdRef.current = newRow.id;
    toast.success("Заказ в столе");
  }

  function handleContextMenuOpen(rowId: string) {
    contextRowIdRef.current = rowId;
  }

  function numberCell(row: PageRow, colKey: string | undefined) {
    if (!colKey) return null;
    const raw = row.cells[colKey];
    return raw === null || raw === undefined || raw === "" ? null : parseOptionalNumber(String(raw));
  }

  /** Визитка строки для карточки: extras, а без них — столбцы «Перс»/«Мин»/ссылка. */
  function clientCardInitial(row: PageRow): RowExtras {
    return {
      persons: row.extras?.persons ?? numberCell(row, quickOrderCols.persons?.key),
      minutes: row.extras?.minutes ?? numberCell(row, quickOrderCols.minutes?.key),
      note: row.extras?.note ?? null,
      link: row.extras?.link ?? linkCell(row, quickOrderCols.link?.key),
      deadline: row.extras?.deadline ?? null,
    };
  }

  /**
   * Saves «Визитка клиента». Desks that also keep «Перс»/«Минуты» as columns
   * get the same numbers there, in the same write, with one undo step.
   * Пишется само из секции карточки, поэтому без тоста об успехе — иначе
   * каждая пауза в печати всплывала бы «Визитка сохранена».
   */
  async function saveClientCard(rowId: string, next: RowExtras | null) {
    const row = rows.find((r) => r.id === rowId);
    if (!row || !canEdit) return;
    const before: RowExtras | null = hasRowExtras(row.extras)
      ? {
          persons: row.extras?.persons ?? null,
          minutes: row.extras?.minutes ?? null,
          note: row.extras?.note ?? null,
          link: row.extras?.link ?? null,
          deadline: row.extras?.deadline ?? null,
        }
      : null;
    // Whole map with explicit nulls: a merge write would otherwise keep a
    // field the person just cleared.
    const written: RowExtras | null = next
      // Явные null по КАЖДОМУ полю визитки, включая ссылку: merge иначе
      // вернул бы только что стёртое значение обратно.
      ? {
          persons: next.persons ?? null,
          minutes: next.minutes ?? null,
          note: next.note ?? null,
          link: next.link ?? null,
          deadline: next.deadline ?? null,
        }
      : null;
    const patch: Record<string, string | number | null> = {};
    const oldPatch: Record<string, string | number | null> = {};
    for (const [col, value] of [
      [quickOrderCols.persons, next?.persons ?? null],
      [quickOrderCols.minutes, next?.minutes ?? null],
    ] as const) {
      if (!col) continue;
      const old = row.cells[col.key] ?? "";
      if (String(old) === String(value ?? "")) continue;
      patch[col.key] = value ?? "";
      oldPatch[col.key] = old;
    }
    try {
      await fillRowService(workspaceId, page.id, rowId, patch, written);
      pushCommand({
        undo: () => fillRowService(workspaceId, page.id, rowId, oldPatch, before),
        redo: () => fillRowService(workspaceId, page.id, rowId, patch, written),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить визитку");
      throw error;
    }
  }

  async function handleDuplicateRowById(rowId: string | null | undefined) {
    if (!rowId || !canEdit) return;
    const row = rows.find((r) => r.id === rowId);
    if (!row) return;
    const copy = await duplicateRowService(workspaceId, page.id, row, nextRowOrder());
    if (!copy) return;
    let liveId = copy.id;
    pushCommand({
      undo: () => deleteRowService(workspaceId, page.id, liveId),
      redo: async () => {
        const restored = await duplicateRowService(workspaceId, page.id, row, nextRowOrder());
        if (restored) liveId = restored.id;
      },
    });
    toast.success("Строка скопирована");
  }

  async function handleDuplicateRow() {
    await handleDuplicateRowById(contextRowIdRef.current);
  }

  async function handleDeleteRowById(rowId: string | null | undefined) {
    if (!rowId) return;
    contextRowIdRef.current = rowId;
    await handleDeleteRow();
  }

  function handleCopyDiskUrl(rowId?: string | null) {
    const id = rowId ?? contextRowIdRef.current;
    const row = rows.find((r) => r.id === id);
    const diskCol = displayColumns.find((c) => c.type === "url");
    const parsed = diskCol && row ? parseHttpUrl(String(row.cells[diskCol.key] ?? "")) : null;
    if (!parsed) {
      toast.info("В строке нет ссылки на Диск");
      return;
    }
    navigator.clipboard?.writeText(parsed.href).then(
      () => toast.success("Ссылка на Диск скопирована"),
      () => toast.error("Не удалось скопировать ссылку")
    );
  }

  async function handleDeleteRow() {
    const rowId = contextRowIdRef.current;
    if (!rowId) return;
    const row = rows.find((r) => r.id === rowId);
    if (!row) return;
    const lockedRow = viewer ? rowDeleteLockReason(row, viewer, lockCtx) : null;
    if (lockedRow) {
      toast.error(lockedRow);
      return;
    }
    // Recreating a deleted row always gets a brand-new id from Firestore —
    // this holder tracks whichever id is currently "live" so repeated
    // undo/redo toggles keep targeting the right doc instead of a stale one.
    let liveId = rowId;
    await deleteRowService(workspaceId, page.id, liveId);
    pushCommand({
      undo: async () => {
        const restored = await addRowService(workspaceId, page.id, row.cells, row.order);
        liveId = restored.id;
      },
      redo: () => deleteRowService(workspaceId, page.id, liveId),
    });
    toast("Строка удалена", { action: { label: "Отменить", onClick: () => undoLastCommand() } });
  }

  function toggleRowChecked(rowId: string, shiftKey = false) {
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastCheckedRowIdRef.current) {
        const a = rowIds.indexOf(lastCheckedRowIdRef.current);
        const b = rowIds.indexOf(rowId);
        if (a !== -1 && b !== -1) {
          const lo = Math.min(a, b);
          const hi = Math.max(a, b);
          for (let i = lo; i <= hi; i++) next.add(rowIds[i]);
          lastCheckedRowIdRef.current = rowId;
          return next;
        }
      }
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      lastCheckedRowIdRef.current = rowId;
      return next;
    });
  }

  function toggleSelectAllVisible() {
    const ids = visibleRows.map((r) => r.id);
    setSelectedRowIds((prev) => {
      const allOn = ids.length > 0 && ids.every((id) => prev.has(id));
      return allOn ? new Set() : new Set(ids);
    });
  }

  function handleBulkStatus(value: string) {
    const statusCol = displayColumns.find((c) => c.type === "status");
    if (!statusCol || !canEdit) return;
    const changes: { rowId: string; oldValue: string }[] = [];
    selectedRowIds.forEach((id) => {
      const row = rows.find((r) => r.id === id);
      if (!row) return;
      const oldValue = String(row.cells[statusCol.key] ?? "");
      if (oldValue === value) return;
      changes.push({ rowId: id, oldValue });
      persistCellEdit(id, statusCol.key, oldValue, value);
    });
    if (changes.length === 0) return;
    const opt = statusCol.statusOptions?.find((o) => o.value === value);
    if (opt && isDoneStatusLabel(opt.label)) celebrateDone();
    pushCommand({
      undo: async () => {
        await Promise.all(changes.map((c) => persistCellEdit(c.rowId, statusCol.key, value, c.oldValue)));
      },
      redo: async () => {
        await Promise.all(changes.map((c) => persistCellEdit(c.rowId, statusCol.key, c.oldValue, value)));
      },
    });
  }

  /** Generic bulk write for any option column (Ответственный / custom field). */
  function handleBulkOptionValue(colKey: string, value: string) {
    const col = displayColumns.find((c) => c.key === colKey);
    if (!col || !canEdit) return;
    const changes: { rowId: string; oldValue: string }[] = [];
    selectedRowIds.forEach((id) => {
      const row = rows.find((r) => r.id === id);
      if (!row) return;
      const oldValue = String(row.cells[colKey] ?? "");
      if (oldValue === value) return;
      changes.push({ rowId: id, oldValue });
      persistCellEdit(id, colKey, oldValue, value);
    });
    if (changes.length === 0) return;
    pushCommand({
      undo: async () => {
        await Promise.all(changes.map((c) => persistCellEdit(c.rowId, colKey, value, c.oldValue)));
      },
      redo: async () => {
        await Promise.all(changes.map((c) => persistCellEdit(c.rowId, colKey, c.oldValue, value)));
      },
    });
    toast.success(`Обновлено строк: ${changes.length}`);
  }

  function handleBulkMarkDone() {
    const statusCol = displayColumns.find((c) => c.type === "status");
    if (!statusCol) return;
    const done = findDoneStatusOption(statusCol.statusOptions ?? []);
    if (done) handleBulkStatus(done.value);
  }

  function selectedRowsInViewOrder(): PageRow[] {
    const byId = new Map(rows.map((r) => [r.id, r]));
    return rowIds.map((id) => byId.get(id)).filter((r): r is PageRow => Boolean(r && selectedRowIds.has(r.id)));
  }

  function handleCopySelectedRows() {
    const selected = selectedRowsInViewOrder();
    if (selected.length === 0) return;
    const matrix = selected.map((row) => displayColumns.map((c) => cellDisplayText(row, c)));
    pushClipboard(matrix, displayColumns, "row");
    toast.success(`Скопировано строк: ${selected.length}`);
  }

  async function handleDuplicateSelected() {
    if (!canEdit) return;
    const selected = selectedRowsInViewOrder();
    if (selected.length === 0) return;
    const copies: PageRow[] = [];
    for (let i = 0; i < selected.length; i++) {
      const copy = await duplicateRowService(workspaceId, page.id, selected[i], nextRowOrder() + i);
      if (copy) copies.push(copy);
    }
    const liveIds = copies.map((c) => c.id);
    pushCommand({
      undo: async () => {
        await Promise.all(liveIds.map((id) => deleteRowService(workspaceId, page.id, id)));
      },
      redo: async () => {
        const restored = await Promise.all(selected.map((r, i) => duplicateRowService(workspaceId, page.id, r, nextRowOrder() + i)));
        restored.forEach((r, i) => {
          if (r) liveIds[i] = r.id;
        });
      },
    });
    setSelectedRowIds(new Set());
    toast.success(`Продублировано строк: ${copies.length}`);
  }

  function handleExportSelectedCsv() {
    const selected = selectedRowsInViewOrder();
    if (selected.length === 0) return;
    const header = displayColumns.map((c) => c.label);
    const lines = selected.map((row) =>
      displayColumns.map((c) => {
        if (c.type === "currency") {
          const raw = String(row.cells[c.key] ?? "");
          return raw ? formatCurrencyCell(raw) : "";
        }
        return cellDisplayText(row, c);
      })
    );
    downloadCsv(`${page.name} — выбранные.csv`, header, lines);
  }

  function selectAllFilteredRows() {
    setSelectedRowIds(new Set(processedRows.map((r) => r.id)));
  }

  function handleCopyTable() {
    const header = displayColumns.map((c) => c.label);
    const lines = processedRows.map((row) => displayColumns.map((c) => cellDisplayText(row, c)));
    const text = [header, ...lines].map((l) => l.join("\t")).join("\n");
    navigator.clipboard?.writeText(text).then(
      () => toast.success(`Таблица скопирована (${processedRows.length} стр.) — вставьте в Excel или Google Sheets`),
      () => toast.error("Не удалось скопировать")
    );
  }

  async function handleDeleteSelected() {
    const n = selectedRowIds.size;
    if (n === 0) return;
    if (viewer) {
      const locked = [...selectedRowIds]
        .map((id) => rowDeleteLockReason(rows.find((r) => r.id === id), viewer, lockCtx))
        .find(Boolean);
      if (locked) {
        toast.error(locked);
        return;
      }
    }
    const ok = await confirmDialog({
      title: `Удалить ${n} ${n === 1 ? "строку" : n < 5 ? "строки" : "строк"}?`,
      description: "Сразу после удаления действие можно отменить через Ctrl+Z.",
      destructive: true,
    });
    if (!ok) return;
    const deletedRows = rows.filter((r) => selectedRowIds.has(r.id));
    // liveIds[i] tracks whichever id currently exists for deletedRows[i] —
    // recreating a row on undo always gets a fresh Firestore-generated id,
    // so a naive redo() referencing the original id would target a doc that
    // no longer exists after the first undo/redo cycle.
    const liveIds = deletedRows.map((r) => r.id);
    await Promise.all(liveIds.map((id) => deleteRowService(workspaceId, page.id, id)));
    setSelectedRowIds(new Set());
    toast("Строки удалены", { action: { label: "Отменить", onClick: () => undoLastCommand() } });
    pushCommand({
      undo: async () => {
        const restored = await Promise.all(
          deletedRows.map((r) => addRowService(workspaceId, page.id, r.cells, r.order))
        );
        restored.forEach((r, i) => (liveIds[i] = r.id));
      },
      redo: async () => {
        await Promise.all(liveIds.map((id) => deleteRowService(workspaceId, page.id, id)));
      },
    });
  }

  function handleExportCsv() {
    const header = displayColumns.map((c) => c.label);
    const lines = processedRows.map((row) =>
      displayColumns.map((c) => {
        const raw = String(row.cells[c.key] ?? "");
        if (c.type === "currency" && raw) return formatCurrencyCell(raw);
        return cellDisplayText(row, c);
      })
    );
    downloadCsv(`${page.name}.csv`, header, lines);
  }

  async function handleRenameColumn(colKey: string) {
    const current = columns.find((c) => c.key === colKey);
    if (!current) return;
    const newLabel = await promptDialog({ title: "Переименовать столбец", label: "Название", defaultValue: current.label, maxLength: 60 });
    if (!newLabel || !newLabel.trim() || newLabel.trim() === current.label) return;
    await renameColumnService(workspaceId, page.id, columns, colKey, newLabel.trim());
    toast.success("Столбец переименован");
  }

  async function handleRenameColumnInline(colKey: string, label: string) {
    if (!canEditColumns) return;
    const current = columns.find((c) => c.key === colKey);
    const next = label.trim();
    if (!current || !next || next === current.label) return;
    try {
      await renameColumnService(workspaceId, page.id, columns, colKey, next);
      toast.success("Столбец переименован");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось переименовать");
    }
  }

  function handleInsertColumnAfter(colKey: string) {
    if (!canEditColumns) return;
    insertAfterKeyRef.current = colKey;
    setAddColumnOpen(true);
  }

  async function handleColumnCreated(created: (typeof columns)[number]) {
    if (!canEditColumns) return;
    const afterKey = insertAfterKeyRef.current;
    insertAfterKeyRef.current = null;
    if (!afterKey) return;
    const rest = columns.filter((c) => c.key !== created.key);
    const idx = rest.findIndex((c) => c.key === afterKey);
    if (idx < 0) return;
    const next = [...rest];
    next.splice(idx + 1, 0, created);
    await updatePageColumns(workspaceId, page.id, next.map((c, i) => ({ ...c, order: i })));
  }

  function handleShowAllColumns() {
    if (!canEditColumns) return;
    if (!columns.some((c) => c.hidden)) return;
    void updatePageColumns(workspaceId, page.id, columns.map((c) => (c.hidden ? { ...c, hidden: false } : c)));
  }

  async function handleChangeColumnType(colKey: string, type: ColumnType, customFieldId?: string) {
    if (!canEditColumns) return;
    const current = columns.find((c) => c.key === colKey);
    if (!current || (current.type === type && current.customFieldId === customFieldId)) return;
    // Status never seeds a per-column list — it always reads the shared
    // workspace.statusOptions (see getColumnOptions), so there's nothing to
    // seed here for any option type anymore.
    await changeColumnTypeService(workspaceId, page.id, columns, colKey, type, undefined, customFieldId);
    toast.success("Тип столбца изменён");
  }

  const kanbanStatusColumn = displayColumns.find((c) => c.type === "status") ?? null;

  const manageOptionsColumn = columns.find((c) => c.key === manageOptionsColKey) ?? null;

  async function handleSaveColumnOptions(options: StatusOption[]) {
    if (!manageOptionsColumn) return;
    if (manageOptionsColumn.type === "status") {
      // Workspace-wide, same as Ответственный below — never per-column, so
      // editing statuses on ANY desk updates the one shared list everyone sees.
      if (!canEditSharedLists) throw new Error("Варианты статуса меняет только Owner или Тимлид");
      await updateStatusOptions(workspaceId, options);
    } else if (manageOptionsColumn.type === "responsible") {
      if (!canEditSharedLists) throw new Error("Список ответственных меняет только Owner или Тимлид");
      await updateResponsibleOptions(workspaceId, options);
    } else if (manageOptionsColumn.type === "technician") {
      // Ники технарей ведутся на «Команде» (там же привязка к людям), и
      // редактора вариантов у них нет. Без этой ветки диалог молча
      // показывал «Варианты обновлены», не записав ничего.
      throw new Error("Ники технарей ведутся на «Команде» — здесь их не меняют");
    } else if (manageOptionsColumn.type === "custom" && manageOptionsColumn.customFieldId) {
      if (!canEditSharedLists) throw new Error("Кастомные поля меняет только Owner или Тимлид");
      await updateCustomFieldOptions(workspaceId, customFields, manageOptionsColumn.customFieldId, options);
    }
    toast.success("Варианты обновлены");
  }

  async function handleManageStatuses() {
    if (!canEditSharedLists) return;
    let statusCol = columns.find((c) => c.type === "status");
    if (!statusCol) {
      const keys = new Set(columns.map((c) => c.key));
      let key = "status";
      let i = 1;
      while (keys.has(key)) {
        key = `status_${i}`;
        i += 1;
      }
      // No seeded statusOptions — this desk's "Статус" column reads the
      // shared workspace list, same as every other desk's.
      statusCol = await addColumnService(workspaceId, page.id, columns, {
        key,
        label: "Статус",
        type: "status",
      });
      toast.success("Столбец «Статус» добавлен");
    }
    setManageOptionsColKey(statusCol.key);
  }

  async function handleToggleHiddenColumn(colKey: string) {
    if (!canEditColumns) return;
    const next = columns.map((c) => (c.key === colKey ? { ...c, hidden: !c.hidden } : c));
    await updatePageColumns(workspaceId, page.id, next);
  }

  async function handleMoveColumn(colKey: string, direction: -1 | 1) {
    if (!canEditColumns) return;
    const ordered = [...columns].sort((a, b) => a.order - b.order);
    const index = ordered.findIndex((c) => c.key === colKey);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) return;
    const swapped = [...ordered];
    const tmp = swapped[index];
    swapped[index] = swapped[nextIndex];
    swapped[nextIndex] = tmp;
    const patch: Record<string, ColumnLayoutPatch> = {};
    swapped.forEach((c, i) => {
      patch[c.key] = { order: i };
    });
    await saveColumnLayout(patch);
  }

  async function handleDuplicateColumn(colKey: string) {
    if (!canEditColumns) return;
    const copy = await duplicateColumnService(workspaceId, page.id, columns, colKey);
    toast.success(`Столбец «${copy.label}» создан`);
  }

  async function handleDeleteColumn(colKey: string) {
    if (!canEditColumns) return;
    const current = columns.find((c) => c.key === colKey);
    if (!current) return;
    const ok = await confirmDialog({
      title: `Удалить столбец «${current.label}»?`,
      description: "Столбец исчезнет из таблицы. Значения в ячейках не стираются — вернуть столбец можно через Ctrl+Z сразу после удаления.",
      destructive: true,
    });
    if (!ok) return;
    const originalIndex = columns.findIndex((c) => c.key === colKey);
    await deleteColumnService(workspaceId, page.id, columns, colKey);
    // A filter/quick-filter left pointing at a now-deleted column keeps
    // silently affecting processedRows (row.cells[colKey] values aren't
    // erased by column deletion) with no chip left to explain or remove
    // it — the chip-rendering loop below already skips a missing column,
    // so without this the table can end up quietly showing fewer rows
    // than expected with only the generic "Сбросить фильтры" button as a
    // clue. Drop any filter state referencing the deleted column.
    setFilters((prev) => {
      if (!(colKey in prev)) return prev;
      const next = { ...prev };
      delete next[colKey];
      return next;
    });
    setDateFilter((prev) => (prev?.colKey === colKey ? null : prev));
    toast("Столбец удалён", { action: { label: "Отменить", onClick: () => undoLastCommand() } });
    pushCommand({
      undo: async () => {
        // Re-insert at its original position (columns here no longer
        // includes it) and reassign order 0..n-1, same as the rest of the
        // column-mutation services do.
        const restored = [...columns.filter((c) => c.key !== colKey)];
        restored.splice(originalIndex, 0, current);
        await updatePageColumns(
          workspaceId,
          page.id,
          restored.map((c, i) => ({ ...c, order: i }))
        );
      },
      redo: () => deleteColumnService(workspaceId, page.id, columns, colKey),
    });
  }

  const footerStatusColumn = columns.find((c) => c.type === "status") ?? null;

  const footerAggregates = useMemo(() => {
    const out: Record<string, ReturnType<typeof computeAggregate>> = {};
    for (const column of displayColumns) {
      const kind = columnAggregates[column.key] ?? defaultAggregateFor(column.type);
      out[column.key] = computeAggregate(column, filledProcessedRows, kind, {
        statusColumn: footerStatusColumn,
        statusOptions: sharedStatusOptions,
        isDoneLabel: isDoneStatusLabel,
      });
    }
    return out;
  }, [displayColumns, filledProcessedRows, columnAggregates, footerStatusColumn, sharedStatusOptions]);

  // Sticky footer totals: FILTERED/searched rows only. Currency and number
  // columns sum; dates are notes and are never summed or marked overdue.
  const columnTotals = useMemo(() => {
    const statusCol = columns.find((c) => c.type === "status");
    const sums: Record<string, { sum: number; done?: number }> = {};
    for (const col of columns) {
      if (!isSummableColumn(col.type)) continue;
      const sum = sumNumericCells(processedRows, col.key);
      let done: number | undefined;
      if (col.type === "currency" && statusCol) {
        done = 0;
        for (const row of processedRows) {
          const rawStatus = String(row.cells[statusCol.key] ?? "");
          const label = sharedStatusOptions.find((o) => o.value === rawStatus)?.label ?? rawStatus;
          // isDoneStatusLabel, not a raw includes("готов") — the bare
          // substring also matches «Не готово», so this footer counted
          // not-done money as done while footerAggregates right above (which
          // already passes isDoneLabel) and the dashboard did not. Two
          // totals on the same screen disagreed about the same rows.
          if (isDoneStatusLabel(label)) {
            done += sumNumericCells([row], col.key);
          }
        }
      }
      sums[col.key] = { sum, done };
    }
    return sums;
  }, [columns, processedRows, sharedStatusOptions]);

  /**
   * Нижняя полоса итогов. Денежных столбцов может быть НЕСКОЛЬКО — у стола
   * ОС их два (цена и апсейл), и суммировать только первый значит спрятать
   * половину денег. Один столбец подписан «Общий», как было; два и больше —
   * каждый своим названием. «Готово» показываем только при столбце-статусе:
   * без него это всегда ноль, и на столе ОС он читался как «ничего не
   * сделано».
   */
  const grandTotals = useMemo(() => {
    const currencyCols = columns.filter((c) => c.type === "currency");
    if (currencyCols.length === 0) return null;
    return {
      parts: currencyCols.map((c) => ({
        key: c.key,
        label: c.label,
        sum: columnTotals[c.key]?.sum ?? 0,
        done: columnTotals[c.key]?.done ?? 0,
      })),
      hasStatus: Boolean(footerStatusColumn),
    };
  }, [columns, columnTotals, footerStatusColumn]);

  const selectionStats = useMemo(() => {
    const bounds = getSelectionBounds();
    if (!bounds) return null;
    if (bounds.rowEnd === bounds.rowStart && bounds.colEnd === bounds.colStart) return null;
    const selRows = visibleRows.slice(bounds.rowStart, bounds.rowEnd + 1);
    const selCols = displayColumns.slice(bounds.colStart, bounds.colEnd + 1);
    return summarizeSelection(selRows, selCols);
  }, [getSelectionBounds, visibleRows, displayColumns]);

  // ---- Сводка для шапки стола (DeskSummary) ----
  // По видимым строкам (после фильтров и поиска) и по ВСЕМ денежным столбцам,
  // как нижняя полоса. «В работе» — по варианту статуса, «Готово»/«Ждём» — по
  // названию: списки статусов у каждого workspace свои.
  const summaryNumbers = useMemo(() => {
    const allCurrencyCols = columns.filter((c) => c.type === "currency");
    // Денежный столбец только для чтения (`lockedKeys`) — ВЫВЕДЕННАЯ сумма:
    // «Итого» стола ОС = цена + апсейл за вычетом комиссии. Сложи его с ними —
    // и «Общий»/«Ждём» удваивались (один заказ на 45 000 давал «Ждём 90 000»).
    const ownCurrencyCols = allCurrencyCols.filter((c) => !lockedKeys?.[c.key]);
    const currencyCols = ownCurrencyCols.length > 0 ? ownCurrencyCols : allCurrencyCols;
    const statusCol = footerStatusColumn;
    const options = statusCol ? getColumnOptions(statusCol, activeWorkspace) : NO_OPTIONS;
    const inProgressValue = statusCol ? findInProgressStatusOption(options)?.value ?? null : null;
    let total = 0;
    let done = 0;
    let inProgress = 0;
    let waiting = 0;
    for (const row of processedRows) {
      let rowSum = 0;
      for (const c of currencyCols) rowSum += sumNumericCells([row], c.key);
      if (rowSum === 0) continue;
      total += rowSum;
      if (!statusCol) continue;
      const raw = String(row.cells[statusCol.key] ?? "");
      const label = options.find((o) => o.value === raw)?.label ?? raw;
      if (isDoneStatusLabel(label)) done += rowSum;
      else if (inProgressValue !== null && raw === inProgressValue) inProgress += rowSum;
      else if (isWaitingStatusLabel(label)) waiting += rowSum;
    }
    return {
      rowCount: filledProcessedRows.length,
      groupCount: groups ? groups.entries.length : 0,
      total,
      done,
      inProgress,
      waiting,
      hasCurrency: currencyCols.length > 0,
      hasStatus: Boolean(statusCol),
    };
  }, [columns, footerStatusColumn, activeWorkspace, processedRows, filledProcessedRows.length, groups, lockedKeys]);
  // Объект собирается заново только когда изменилось хоть одно число —
  // иначе шапка стола перерисовывалась бы на каждый рендер таблицы.
  const deskSummary = useMemo<DeskSummary>(
    () => ({ ...summaryNumbers }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      summaryNumbers.rowCount,
      summaryNumbers.groupCount,
      summaryNumbers.total,
      summaryNumbers.done,
      summaryNumbers.inProgress,
      summaryNumbers.waiting,
      summaryNumbers.hasCurrency,
      summaryNumbers.hasStatus,
    ]
  );
  const onSummaryChangeRef = useRef(onSummaryChange);
  onSummaryChangeRef.current = onSummaryChange;
  useEffect(() => {
    onSummaryChangeRef.current?.(deskSummary);
  }, [deskSummary]);
  // Ушли со стола — шапка не должна показывать итоги прошлой таблицы, пока
  // грузится следующая (для actions такой сброс есть, для сводки не было).
  useEffect(
    () => () => {
      onSummaryChangeRef.current?.(null);
    },
    []
  );

  // Row card navigation follows the current view order.
  const expandedRowIndex = expandedRowId ? processedRowIds.indexOf(expandedRowId) : -1;
  function openRowAt(index: number) {
    const id = processedRowIds[index];
    if (!id) return;
    setExpandedRowId(id);
    const colKey = activeCell?.colKey ?? displayColumns[0]?.key;
    if (colKey) {
      setActiveCell({ rowId: id, colKey });
      setRangeAnchor({ rowId: id, colKey });
    }
  }

  const bulkOtherOptionColumns: BulkOptionColumn[] = displayColumns
    .filter((c) => isOptionColumn(c.type) && c.type !== "status")
    .map((c) => ({ column: c, options: c.statusOptions ?? [] }));

  // Chips for everything that narrows or reorders the view.
  const activeFilterChips: ActiveFilterChip[] = [];
  if (searchQuery.trim()) {
    activeFilterChips.push({
      id: "search",
      kind: "search",
      label: `«${searchQuery.trim()}»`,
      onRemove: () => setSearchQuery(""),
      onClick: () => setFocusSearchToken((n) => n + 1),
    });
  }
  if (statusFilter) {
    const opt = kanbanStatusColumnForChips()?.statusOptions?.find((o) => o.value === statusFilter);
    activeFilterChips.push({
      id: "status",
      kind: "status",
      label: statusFilter === NOT_DONE_STATUS_FILTER ? "Не готово" : (opt?.label ?? statusFilter),
      color: opt?.color,
      onRemove: () => setStatusFilter(null),
    });
  }
  if (dateFilter) {
    const col = columns.find((c) => c.key === dateFilter.colKey);
    activeFilterChips.push({
      id: "date",
      kind: "date",
      label: `${col?.label ?? "Дата"}: ${DATE_PRESET_LABELS[dateFilter.preset]}`,
      onRemove: () => setDateFilter(null),
    });
  }
  if (mineOnly) {
    activeFilterChips.push({ id: "mine", kind: "mine", label: "Только мои", onRemove: () => setMineOnly(false) });
  }
  for (const [colKey, excluded] of Object.entries(filters)) {
    if (!excluded || excluded.size === 0) continue;
    const col = columns.find((c) => c.key === colKey);
    if (!col) continue;
    const labels = Array.from(excluded).map((v) => {
      if (isOptionColumn(col.type)) return getColumnOptions(col, activeWorkspace).find((o) => o.value === v)?.label ?? v;
      return v || "(пусто)";
    });
    activeFilterChips.push({
      id: `col:${colKey}`,
      kind: "column",
      label: `${col.label}: скрыто ${excluded.size}`,
      detail: `Скрыто: ${labels.join(", ")}`,
      onRemove: () => clearColumnFilter(colKey),
    });
  }
  if (isCustomGrouping) {
    const col = groupByKey ? columns.find((c) => c.key === groupByKey) : undefined;
    activeFilterChips.push({
      id: "group",
      kind: "group",
      label: groupByKey ? `Группы: ${col?.label ?? groupByKey}` : "Без группировки",
      onRemove: () => changeGroupBy(defaultGroupKey),
    });
  }
  if (sortState.colKey && sortState.direction) {
    const col = columns.find((c) => c.key === sortState.colKey);
    activeFilterChips.push({
      id: "sort",
      kind: "sort",
      label: `${col?.label ?? sortState.colKey} ${sortState.direction === "asc" ? "↑" : "↓"}`,
      detail: sortState.direction,
      onRemove: () => handleSortDirection(sortState.colKey!, null),
      onClick: () => handleSortDirection(sortState.colKey!, sortState.direction === "asc" ? "desc" : "asc"),
    });
  }

  function kanbanStatusColumnForChips() {
    return displayColumns.find((c) => c.type === "status") ?? null;
  }

  const virtualItems = shouldVirtualize ? rowVirtualizer.getVirtualItems() : [];
  const totalSize = shouldVirtualize ? rowVirtualizer.getTotalSize() : 0;
  const paddingTop = shouldVirtualize && virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    shouldVirtualize && virtualItems.length > 0 ? totalSize - virtualItems[virtualItems.length - 1].end : 0;

  // Status colour per row for the gutter rail.
  const railStatusCol = columns.find((c) => c.type === "status" && !c.hidden) ?? null;
  const railColorByValue = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of sharedStatusOptions) map.set(o.value, o.color);
    return map;
  }, [sharedStatusOptions]);
  function rowAccentColor(row: PageRow): string | undefined {
    if (!railStatusCol) return undefined;
    const raw = String(row.cells[railStatusCol.key] ?? "");
    return raw ? railColorByValue.get(raw) : undefined;
  }

  // Duplicate phones/emails across the whole desk (not just the filtered
  // view): a repeated contact in a CRM usually means a double-entered order.
  const duplicateContactKeys = useMemo(() => {
    const contactCols = displayColumns.filter((c) => c.type === "phone" || c.type === "email");
    const result = new Map<string, string[]>();
    for (const col of contactCols) {
      const seen = new Map<string, number>();
      for (const row of rows) {
        const norm = normalizeContact(String(row.cells[col.key] ?? ""), col.type);
        if (!norm) continue;
        seen.set(norm, (seen.get(norm) ?? 0) + 1);
      }
      for (const row of rows) {
        const norm = normalizeContact(String(row.cells[col.key] ?? ""), col.type);
        if (norm && (seen.get(norm) ?? 0) > 1) {
          const list = result.get(row.id) ?? [];
          list.push(col.key);
          result.set(row.id, list);
        }
      }
    }
    return result;
  }, [rows, displayColumns]);

  function handleFindDuplicates(rowId: string, colKey: string) {
    const col = displayColumns.find((c) => c.key === colKey);
    const row = rows.find((r) => r.id === rowId);
    if (!col || !row) return;
    const target = normalizeContact(String(row.cells[colKey] ?? ""), col.type);
    if (!target) return;
    const excluded = new Set<string>();
    for (const r of rows) {
      const raw = String(r.cells[colKey] ?? "");
      if (normalizeContact(raw, col.type) !== target) excluded.add(raw);
    }
    setFilters((prev) => ({ ...prev, [colKey]: excluded }));
    setPageIndex(0);
  }

  // The fill handle sits on the bottom-right cell of the selection.
  const selBoundsForHandle = getSelectionBounds();
  const fillHandleRowId = selBoundsForHandle && !editingCell && viewMode === "table" ? rowIds[selBoundsForHandle.rowEnd] : null;
  const fillHandleColKey = selBoundsForHandle ? displayColumns[selBoundsForHandle.colEnd]?.key ?? null : null;

  // Строка выделена целиком (клик по номеру, Shift+Space) — по границам
  // выделения один раз на рендер, а не indexOf по rowIds для каждой строки.
  const fullRowSelection =
    selBoundsForHandle && selBoundsForHandle.colStart === 0 && selBoundsForHandle.colEnd === displayColumns.length - 1
      ? selBoundsForHandle
      : null;
  const diskColumn = displayColumns.find((c) => c.type === "url") ?? null;

  // Обработчики строк — СТАБИЛЬНЫЕ обёртки над свежими функциями этого
  // рендера. TableRow сравнивает пропсы (memo) и колбэки не сравнивает: без
  // обёрток строка, которую не перерисовали, держала бы замыкание со старыми
  // rows/activeCell. Раньше это маскировалось тем, что каждая правка
  // перерисовывала ВСЕ строки; теперь перерисовывается одна.
  const rowHandlerImpl = {
    toggleChecked: toggleRowChecked,
    cellMouseDown: handleCellMouseDown,
    cellClick: handleCellClick,
    cellMouseEnter: handleCellMouseEnter,
    startEdit: (rowId: string, colKey: string) => startEditing(rowId, colKey),
    commitEdit: handleCommitEdit,
    statusChange: handleStatusChange,
    rowNumberMouseDown: (rowId: string, e: React.MouseEvent) => handleRowNumberMouseDown(rowId, e),
    rowResizeStart: handleRowResizeStart,
    duplicateRow: (id: string) => void handleDuplicateRowById(id),
    deleteRow: (id: string) => void handleDeleteRowById(id),
    copyDiskUrl: (id: string) => handleCopyDiskUrl(id),
    markDone: markRowDone,
    insertAbove: (id: string) => void insertRowRelative(id, "above"),
    insertBelow: (id: string) => void insertRowRelative(id, "below"),
    copyRow: (id: string) => handleCopyRow(id),
    fillStart: handleFillStart,
    findDuplicates: handleFindDuplicates,
  };
  const rowHandlersRef = useRef(rowHandlerImpl);
  rowHandlersRef.current = rowHandlerImpl;
  const rowHandlers = useMemo(() => {
    const h = () => rowHandlersRef.current;
    return {
      onToggleChecked: (rowId: string, shiftKey?: boolean) => h().toggleChecked(rowId, shiftKey),
      onCellMouseDown: (rowId: string, colKey: string, e: React.MouseEvent) => h().cellMouseDown(rowId, colKey, e),
      onCellClick: (rowId: string, colKey: string) => h().cellClick(rowId, colKey),
      onCellMouseEnter: (rowId: string, colKey: string) => h().cellMouseEnter(rowId, colKey),
      onCellStartEdit: (rowId: string, colKey: string) => h().startEdit(rowId, colKey),
      onCommitEdit: (direction?: "down" | "right" | "left" | "none") => h().commitEdit(direction),
      onCancelEdit: () => setEditingCell(null),
      onStatusChange: (rowId: string, colKey: string, value: string) => h().statusChange(rowId, colKey, value),
      onRowNumberMouseDown: (rowId: string, e: React.MouseEvent) => h().rowNumberMouseDown(rowId, e),
      onRowResizeStart: (rowId: string, e: React.MouseEvent) => h().rowResizeStart(rowId, e),
      onDuplicateRow: (id: string) => h().duplicateRow(id),
      onDeleteRow: (id: string) => h().deleteRow(id),
      onCopyDiskUrl: (id: string) => h().copyDiskUrl(id),
      onUndoLast: () => void undoLastCommand(),
      onMarkDone: (id: string) => h().markDone(id),
      onInsertRowAbove: (id: string) => h().insertAbove(id),
      onInsertRowBelow: (id: string) => h().insertBelow(id),
      onCopyRow: (id: string) => h().copyRow(id),
      onFillStart: (rowId: string, colKey: string, e: React.PointerEvent) => h().fillStart(rowId, colKey, e),
      onFindDuplicates: (rowId: string, colKey: string) => h().findDuplicates(rowId, colKey),
    };
  }, []);

  function renderRow(row: PageRow, index: number) {
    const effectiveRowHeight =
      resizePreview?.type === "row" && resizePreview.rowId === row.id
        ? resizePreview.height
        : row.height ?? rowHeight;
    // Поверх ячеек строки, а не вместо: служебные ключи, которых нет среди
    // столбцов (способ оплаты `__pay`, дата апсейла `__at`, «выдан»
    // `osIssuedAt`), иначе пропадали, пока хоть одна ячейка строки сохранялась.
    const displayRow = columns.some((c) => pendingWrites.state(row.id, c.key) !== "idle")
      ? {
          ...row,
          cells: {
            ...row.cells,
            ...Object.fromEntries(
              columns.map((c) => [c.key, pendingWrites.resolve(row.id, c.key, row.cells[c.key] ?? null)])
            ),
          },
        }
      : row;
    return (
      <TableRow
        key={row.id}
        row={displayRow}
        rowNumber={index + 1}
        columns={displayColumns}
        rowHeight={effectiveRowHeight}
        activeCell={activeCell}
        rangeCells={rangeCells}
        editingCell={editingCell}
        editValue={editingCell?.rowId === row.id ? editValue : ""}
        canEdit={canEdit}
        cellLock={cellLockFor}
        pickerKeys={cellPickerKeys}
        onOpenCellPicker={onOpenCellPicker ? openCellPicker : undefined}
        cellAddonKeys={cellAddon?.keys}
        cellAddonVersion={cellAddon?.version}
        renderCellAddon={cellAddon ? renderCellAddon : undefined}
        cellDisplayKeys={cellDisplay?.keys}
        cellDisplayVersion={cellDisplay?.version}
        renderCellDisplay={cellDisplay ? renderCellDisplay : undefined}
        cellActionKeys={cellActionKeys}
        getCellAction={cellAction ? getCellActionView : undefined}
        cellActionPulse={cellAction ? cellActionPulse : undefined}
        onCellAction={cellAction ? runCellAction : undefined}
        canReorder={canReorderRows}
        isRowFullySelected={fullRowSelection ? index >= fullRowSelection.rowStart && index <= fullRowSelection.rowEnd : false}
        isChecked={selectedRowIds.has(row.id)}
        pinnedKeys={stickyKeys}
        gutterWidth={gutterWidth}
        onToggleChecked={rowHandlers.onToggleChecked}
        onCellMouseDown={rowHandlers.onCellMouseDown}
        onCellClick={rowHandlers.onCellClick}
        onCellMouseEnter={rowHandlers.onCellMouseEnter}
        onCellStartEdit={rowHandlers.onCellStartEdit}
        onEditValueChange={setEditValue}
        onCommitEdit={rowHandlers.onCommitEdit}
        onCancelEdit={rowHandlers.onCancelEdit}
        onStatusChange={rowHandlers.onStatusChange}
        onRowNumberMouseDown={rowHandlers.onRowNumberMouseDown}
        onRowResizeStart={rowHandlers.onRowResizeStart}
        onContextMenuOpen={handleContextMenuOpen}
        onExpandRow={setExpandedRowId}
        onDuplicateRow={rowHandlers.onDuplicateRow}
        onDeleteRow={rowHandlers.onDeleteRow}
        onCopyDiskUrl={rowHandlers.onCopyDiskUrl}
        diskUrl={diskColumn ? (parseHttpUrl(String(row.cells[diskColumn.key] ?? ""))?.href ?? null) : null}
        onUndoLast={rowHandlers.onUndoLast}
        isExpanded={expandedRowId === row.id}
        coarsePointer={coarsePointer}
        extrasHintKey={extrasHintKey}
        onOpenClientCard={setExpandedRowId}
        anyChecked={selectedRowIds.size > 0}
        zebra={index % 2 === 1}
        onMarkDone={rowHandlers.onMarkDone}
        onInsertRowAbove={rowHandlers.onInsertRowAbove}
        onInsertRowBelow={rowHandlers.onInsertRowBelow}
        onCopyRow={rowHandlers.onCopyRow}
        expandedColKey={expandedTextCell?.rowId === row.id ? expandedTextCell.colKey : null}
        searchQuery={searchQuery}
        openRequest={openRequest}
        accentColor={rowAccentColor(row)}
        fillHandleColKey={fillHandleRowId === row.id ? fillHandleColKey : null}
        onFillStart={canEdit ? rowHandlers.onFillStart : undefined}
        fillColKeys={fillPreview && index >= fillPreview.rowStart && index <= fillPreview.rowEnd ? fillPreview.colKeys : null}
        duplicateColKeys={duplicateContactKeys.get(row.id) ?? null}
        onFindDuplicates={rowHandlers.onFindDuplicates}
        blank={isBlankRow(displayRow)}
      />
    );
  }

  // Тот же массив id столбцов между рендерами — иначе SortableContext шапки
  // перерисовывал все заголовки столбцов на каждую правку ячейки.
  const columnIds = useMemo(() => displayColumns.map((c) => c.id), [displayColumns]);
  const toggleGroupCollapsed = useCallback((label: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }, []);
  const groupColSpan = displayColumns.length + (canEditStructure ? 1 : 0);
  // Строки в SortableContext — только когда строку правда можно тащить
  // (ручной порядок без групп, фильтров и сортировки, мышью). Иначе контекст
  // лишь перерисовывал бы все строки на каждую смену списка id.
  const rowsSortable = canReorderRows && !coarsePointer;
  const bodyIndexes = shouldVirtualize ? virtualItems.map((v) => v.index) : bodyItems.map((_, i) => i);
  const bodyRows = bodyIndexes.map((i) => {
    const item = bodyItems[i];
    if (!item) return null;
    if (item.kind === "row") return renderRow(item.row, item.index);
    return (
      <GroupHeaderRow
        key={bodyItemKey(item)}
        label={item.label}
        count={item.count}
        colSpan={groupColSpan}
        collapsed={item.collapsed}
        color={item.color}
        sumText={item.sumText}
        doneText={item.doneText}
        hint={item.hint}
        onToggle={toggleGroupCollapsed}
        measureRef={shouldVirtualize ? rowVirtualizer.measureElement : undefined}
        dataIndex={shouldVirtualize ? i : undefined}
      />
    );
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el || viewMode !== "table") return;
    const update = () => {
      const left = el.scrollLeft > 8;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 8;
      // Ширина окна прокрутки для липких заголовков групп (.table-group-toggle):
      // сумма группы должна стоять у видимого правого края, а не у края таблицы.
      el.style.setProperty("--table-view-w", `${el.clientWidth}px`);
      // Only a real change may set state. A fresh object on every
      // ResizeObserver callback re-rendered the table, which resized it,
      // which fired the observer again — "Maximum update depth exceeded"
      // hundreds of times, freezing clicks, selection and drags.
      setHFade((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [displayColumns, visibleRows.length, viewMode]);

  const pinnedOrder = displayColumns.filter((c) => stickyKeys.includes(c.key));

  const isSaving = pendingWrites.hasSavingCell;

  return (
    <LayoutGroup>
    <div className={`relative flex h-full min-h-0 flex-col bg-background${grandTotals ? " has-table-totals" : ""}`}>
      {/* A thin top progress bar while any cell write is in flight — same
          idea as YouTube/GitHub, so "is it saving?" is visible at a glance
          instead of only in the small per-cell dot. */}
      <div className="relative h-0.5 shrink-0 overflow-hidden bg-transparent">
        {isSaving && (
          <div className="absolute inset-y-0 left-0 w-1/3 animate-[saving-bar_1.1s_ease-in-out_infinite] rounded-full bg-primary" />
        )}
      </div>
      <TableToolbar
        columns={columns}
        searchQuery={searchQuery}
        onSearchChange={(v) => {
          setSearchQuery(v);
          setPageIndex(0);
        }}
        focusSearchToken={focusSearchToken}
        groupByKey={groupByKey}
        onGroupByChange={changeGroupBy}
        onCollapseAllGroups={() => setCollapsedGroups(new Set(groups?.entries.map(([label]) => label) ?? []))}
        onExpandAllGroups={() => setCollapsedGroups(new Set())}
        density={density}
        onDensityChange={handleDensityChange}
        onAddRow={handleAddRow}
        canAddRows={!ordersFromOsOnly}
        onQuickOrder={canQuickOrderAction ? () => deskActionsRef.current.quickOrder() : undefined}
        quickOrderButton={chromeHidden}
        highlightCount={highlightedRowIds.length}
        onClearHighlights={canEdit && highlightedRowIds.length > 0 ? handleClearHighlights : undefined}
        onExportCsv={handleExportCsv}
        onCopyTable={handleCopyTable}
        canEdit={canEdit}
        canEditStructure={canEditColumns}
        onAddColumn={() => {
          insertAfterKeyRef.current = null;
          setAddColumnOpen(true);
        }}
        onOpenSchema={() => setSchemaOpen(true)}
        onManageStatuses={() => void handleManageStatuses()}
        canManageStatuses={canManageVariants}
        onShowColumn={(key) => void handleToggleHiddenColumn(key)}
        onShowAllColumns={handleShowAllColumns}
        onAutoSizeAll={canEditColumns ? handleAutoSizeAll : undefined}
        hasStatusColumn={Boolean(kanbanStatusColumn)}
        statusOptions={kanbanStatusColumn?.statusOptions}
        statusFilter={statusFilter}
        onStatusFilterChange={(v) => {
          setStatusFilter(v);
          setPageIndex(0);
        }}
        statusCounts={statusCounts}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        savedViews={savedViews}
        onSaveView={() => void handleSaveTableView()}
        onApplyView={handleApplyTableView}
        onDeleteView={handleDeleteTableView}
        hasActiveFilters={hasActiveFilters}
        onResetFilters={resetAllFilters}
        pageSize={pageSize}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPageIndex(0);
        }}
        visibleCount={filledProcessedRows.length}
        totalCount={filledRowCount}
        dateFilter={dateFilter}
        onDateFilterChange={(next) => {
          setDateFilter(next);
          setPageIndex(0);
        }}
        canFilterMine={myResponsibleValues.length > 0 && displayColumns.some((c) => c.type === "responsible")}
        mineOnly={mineOnly}
        onMineOnlyChange={(next) => {
          setMineOnly(next);
          setPageIndex(0);
        }}
      />
      {viewMode === "table" && (
        <ActiveFiltersBar
          chips={activeFilterChips}
          visibleCount={filledProcessedRows.length}
          totalCount={filledRowCount}
          onClearAll={resetAllFilters}
        />
      )}

      {viewMode === "cards" ? (
        <CardListView
          columns={displayColumns}
          rows={filledProcessedRows}
          canEdit={canEdit}
          onOpenRow={setExpandedRowId}
          renderMeta={cardMeta}
          renderFooter={cardFooter}
          emptyText={emptyState ? [emptyState.title, emptyState.description].filter(Boolean).join(". ") : undefined}
          onAddOrder={
            canEdit && !ordersFromOsOnly
              ? () => {
                  setQuickOrderStatus(null);
                  setQuickOrderOpen(true);
                }
              : undefined
          }
        />
      ) : viewMode === "kanban" && kanbanStatusColumn ? (
        <KanbanView
          columns={displayColumns}
          rows={filledProcessedRows}
          statusColumn={kanbanStatusColumn}
          canEdit={canEdit}
          onStatusChange={handleStatusChange}
          onOpenRow={setExpandedRowId}
          onAddOrder={
            canEdit && !ordersFromOsOnly
              ? (statusValue) => {
                  setQuickOrderStatus(statusValue);
                  setQuickOrderOpen(true);
                }
              : undefined
          }
        />
      ) : (
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="relative min-h-0 flex-1">
        <div
          ref={containerRef}
          tabIndex={0}
          onFocus={() => setGridFocused(true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setGridFocused(false);
          }}
          onPaste={(e) => {
            if (editingCellRef.current) return;
            const text = e.clipboardData.getData("text/plain");
            if (!text || (!text.includes("\t") && !text.includes("\n"))) return;
            e.preventDefault();
            const internal = readTableClipboard(text);
            void startPaste(internal ? internal.matrix : parseClipboardMatrix(text), internal);
          }}
          className="table-grid-scroll absolute inset-0 overflow-auto overscroll-contain bg-background pb-[env(safe-area-inset-bottom,0px)] outline-none scrollbar-thin"
        >
          <table className="table-instrument w-max min-w-full border-separate border-spacing-0" style={{ tableLayout: "fixed" }}>
            <thead className="sticky top-0 z-30 bg-background">
              <tr>
                <th
                  className="table-sticky-col sticky left-0 top-0 z-40 border-b border-r border-border/50 bg-background"
                  style={{ width: gutterWidth, minWidth: gutterWidth }}
                >
                  <div className="flex h-11 items-center justify-center sm:h-8">
                    <Checkbox
                      checked={visibleRows.length > 0 && visibleRows.every((r) => selectedRowIds.has(r.id))}
                      onClick={(e) => {
                        e.preventDefault();
                        toggleSelectAllVisible();
                      }}
                      aria-label="Выбрать все строки"
                    />
                  </div>
                </th>
                <SortableContext items={columnIds} strategy={horizontalListSortingStrategy}>
                  {displayColumns.map((column) => (
                    <ColumnHeaderCell
                      key={column.id}
                      column={column}
                      sortState={sortState}
                      onSort={handleSort}
                      onSortDirection={handleSortDirection}
                      onFilterClick={handleFilterClick}
                      hasActiveFilter={(filters[column.key]?.size ?? 0) > 0}
                      onClearFilter={clearColumnFilter}
                      onResizeStart={canEditColumns ? handleColumnResizeStart : undefined}
                      onAutoSize={canEditColumns ? handleAutoSizeColumn : undefined}
                      isGrouped={groupByKey === column.key}
                      onGroupBy={changeGroupBy}
                      onRenameCommit={canEditColumns ? handleRenameColumnInline : undefined}
                      onInsertColumnAfter={canEditColumns ? handleInsertColumnAfter : undefined}
                      hint={footerAggregates[column.key]?.title}
                      isPinned={pinnedKeys.includes(column.key)}
                      onTogglePin={togglePin}
                      stickyLeft={
                        stickyKeys.includes(column.key)
                          ? gutterWidth +
                            pinnedOrder.slice(0, pinnedOrder.findIndex((c) => c.key === column.key)).reduce((sum, c) => sum + c.width, 0)
                          : undefined
                      }
                      isLastSticky={pinnedOrder.length > 0 && column.key === pinnedOrder[pinnedOrder.length - 1].key}
                      canReorder={canEditColumns && !coarsePointer && !editingCell}
                      compactChrome={coarsePointer}
                      canEditStructure={canEditColumns}
                      canManageOptions={canManageVariants}
                      onToggleHidden={canEditColumns ? handleToggleHiddenColumn : undefined}
                      onRename={handleRenameColumn}
                      onChangeType={handleChangeColumnType}
                      onManageOptions={canManageVariants ? setManageOptionsColKey : undefined}
                      onDuplicate={handleDuplicateColumn}
                      onDelete={handleDeleteColumn}
                      onSelectColumn={selectColumn}
                      onCopyColumn={handleCopyColumn}
                      onPasteColumn={canEdit && clipboardColumnLabel ? (key) => void handlePasteColumn(key) : undefined}
                      pasteColumnLabel={clipboardColumnLabel}
                      isColumnSelected={
                        Boolean(
                          getSelectionBounds() &&
                            rowIds.length > 0 &&
                            getSelectionBounds()!.rowStart === 0 &&
                            getSelectionBounds()!.rowEnd === rowIds.length - 1 &&
                            getSelectionBounds()!.colStart === displayColumns.findIndex((c) => c.key === column.key) &&
                            getSelectionBounds()!.colEnd === displayColumns.findIndex((c) => c.key === column.key)
                        )
                      }
                    />
                  ))}
                </SortableContext>
                {canEditColumns && (
                  <th className="border-b border-border/50 bg-background p-0" style={{ width: 44, minWidth: 44 }}>
                    <button
                      type="button"
                      onClick={() => setAddColumnOpen(true)}
                      title="Добавить столбец"
                      className="flex h-11 w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:h-8 sm:w-8"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </th>
                )}
              </tr>
            </thead>
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <tbody>
                  {paddingTop > 0 && (
                    <tr>
                      <td colSpan={displayColumns.length + 1 + (canEditStructure ? 1 : 0)} style={{ height: paddingTop }} />
                    </tr>
                  )}
                  {rowsSortable ? (
                    <SortableContext items={rowIds} strategy={verticalListSortingStrategy}>
                      {bodyRows}
                    </SortableContext>
                  ) : (
                    bodyRows
                  )}
                  {paddingBottom > 0 && (
                    <tr>
                      <td colSpan={displayColumns.length + 1 + (canEditStructure ? 1 : 0)} style={{ height: paddingBottom }} />
                    </tr>
                  )}
                  {processedRows.length === 0 && (
                    <tr>
                      <td colSpan={displayColumns.length + 1 + (canEditStructure ? 1 : 0)}>
                        <div className="sticky left-0 w-full max-w-[min(100vw,44rem)]">
                        {rows.length === 0 ? (
                          <EmptyState
                            className="py-12"
                            title={emptyState?.title ?? "Пока пусто"}
                            description={
                              emptyState
                                ? emptyState.description
                                : canEdit
                                  ? "Добавьте первую строку — или вставьте данные из Excel через Ctrl+V."
                                  : undefined
                            }
                            action={
                              canEdit ? (
                                <Button size="sm" className="gap-1.5" onClick={handleAddRow}>
                                  <Plus className="h-3.5 w-3.5" /> Добавить строку
                                </Button>
                              ) : undefined
                            }
                          />
                        ) : (
                          <EmptyState
                            className="py-12"
                            title="Ничего не найдено"
                            description={`В столе ${rows.length} стр., но под текущие фильтры не подходит ни одна.`}
                            action={
                              <Button variant="outline" size="sm" className="gap-1.5" onClick={resetAllFilters}>
                                <FilterX className="h-3.5 w-3.5" /> Сбросить фильтры
                              </Button>
                            }
                          />
                        )}
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-64">
                {selectedRowIds.size > 1 && (
                  <>
                    <ContextMenuItem onClick={handleCopySelectedRows}>
                      <Copy className="h-3.5 w-3.5" /> Копировать выбранные ({selectedRowIds.size})
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => void handleDuplicateSelected()} disabled={!canEdit}>
                      <CopyPlus className="h-3.5 w-3.5" /> Дублировать выбранные
                    </ContextMenuItem>
                    {kanbanStatusColumn && (
                      <ContextMenuItem onClick={handleBulkMarkDone} disabled={!canEdit}>
                        <CheckCheck className="h-3.5 w-3.5" /> Выбранные → «Готово»
                      </ContextMenuItem>
                    )}
                    <ContextMenuItem onClick={() => void handleDeleteSelected()} disabled={!canEdit} className="text-destructive focus:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" /> Удалить выбранные ({selectedRowIds.size})
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                  </>
                )}
                <ContextMenuItem onClick={() => setExpandedRowId(contextRowIdRef.current ?? activeCell?.rowId ?? null)}>
                  <Maximize2 className="h-3.5 w-3.5" /> Открыть карточку <ContextMenuShortcut>Space</ContextMenuShortcut>
                </ContextMenuItem>
                {kanbanStatusColumn && canEdit && (
                  <ContextMenuItem
                    onClick={() => {
                      const id = contextRowIdRef.current ?? activeCell?.rowId;
                      if (id) markRowDone(id);
                    }}
                  >
                    <CheckCheck className="h-3.5 w-3.5" /> Отметить «Готово»
                  </ContextMenuItem>
                )}
                <ContextMenuSeparator />
                <ContextMenuItem onClick={handleCopy}>
                  Копировать <ContextMenuShortcut>Ctrl+C</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem onClick={handlePaste} disabled={!canEdit}>
                  Вставить <ContextMenuShortcut>Ctrl+V</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem onClick={() => handleCopyRow()}>
                  Копировать строку <ContextMenuShortcut>Ctrl+Alt+C</ContextMenuShortcut>
                </ContextMenuItem>
                {activeCell && (
                  <>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => filterOnlyCellValue(activeCell.rowId, activeCell.colKey, "only")}>
                      <Filter className="h-3.5 w-3.5" /> Показать только с таким значением
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => filterOnlyCellValue(activeCell.rowId, activeCell.colKey, "exclude")}>
                      <FilterX className="h-3.5 w-3.5" /> Скрыть строки с таким значением
                    </ContextMenuItem>
                  </>
                )}
                <ContextMenuSeparator />
                <ContextMenuItem onClick={handleDuplicateRow} disabled={!canEdit}>
                  Дублировать строку <ContextMenuShortcut>Ctrl+Shift+D</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem
                  onClick={() => void insertRowRelative(contextRowIdRef.current ?? activeCell?.rowId ?? "", "above")}
                  disabled={!canEdit}
                >
                  Вставить строку сверху <ContextMenuShortcut>Ctrl+Shift+Enter</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem
                  onClick={() => void insertRowRelative(contextRowIdRef.current ?? activeCell?.rowId ?? "", "below")}
                  disabled={!canEdit}
                >
                  Вставить строку снизу <ContextMenuShortcut>Ctrl+Enter</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem onClick={() => handleCopyDiskUrl()}>
                  Копировать ссылку Диск
                </ContextMenuItem>
                {!subPageId && (
                  <ContextMenuItem onClick={() => setCommentRowId(contextRowIdRef.current)}>
                    Комментарий
                  </ContextMenuItem>
                )}
                <ContextMenuItem onClick={handleDeleteRow} disabled={!canEdit} className="text-destructive focus:text-destructive">
                  Удалить строку
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          </table>

          {filterPopover && (() => {
            const col = displayColumns.find((c) => c.key === filterPopover.colKey);
            const counts = new Map<string, number>();
            for (const r of rows) {
              const raw = String(r.cells[filterPopover.colKey] ?? "");
              counts.set(raw, (counts.get(raw) ?? 0) + 1);
            }
            const entries: FilterValueEntry[] = Array.from(counts.entries()).map(([raw, count]) => {
              const opt = col && isOptionColumn(col.type) ? col.statusOptions?.find((o) => o.value === raw) : undefined;
              const label = col ? (opt?.label ?? (col.type === "date" && raw ? formatOrderDate(Number(raw)) : raw)) : raw;
              return { value: raw, label, count, color: opt?.color };
            });
            if (col && isOptionColumn(col.type)) {
              const order = new Map((col.statusOptions ?? []).map((o, i) => [o.value, i]));
              entries.sort((a, b) => (order.get(a.value) ?? 999) - (order.get(b.value) ?? 999));
            } else if (col && (col.type === "number" || col.type === "currency" || col.type === "date")) {
              entries.sort((a, b) => (parseLooseNumber(a.value) ?? 0) - (parseLooseNumber(b.value) ?? 0));
            } else {
              entries.sort((a, b) => a.label.localeCompare(b.label, "ru"));
            }
            const allRaw = entries.map((e) => e.value);
            const key = filterPopover.colKey;
            return (
              <FilterPopover
                x={filterPopover.x}
                y={filterPopover.y}
                columnLabel={col?.label ?? ""}
                values={entries}
                excluded={filters[key] ?? new Set()}
                onToggleValue={(value) => {
                  setFilters((prev) => {
                    const next = { ...prev };
                    const set = new Set(next[key] ?? []);
                    if (set.has(value)) set.delete(value);
                    else set.add(value);
                    next[key] = set;
                    return next;
                  });
                  setPageIndex(0);
                }}
                onSelectAll={() => {
                  setFilters((prev) => ({ ...prev, [key]: new Set() }));
                  setPageIndex(0);
                }}
                onSelectNone={() => {
                  setFilters((prev) => ({ ...prev, [key]: new Set(allRaw) }));
                  setPageIndex(0);
                }}
                onInvert={() => {
                  setFilters((prev) => {
                    const current = prev[key] ?? new Set<string>();
                    return { ...prev, [key]: new Set(allRaw.filter((v) => !current.has(v))) };
                  });
                  setPageIndex(0);
                }}
                onOnlyValue={(value) => {
                  setFilters((prev) => ({ ...prev, [key]: new Set(allRaw.filter((v) => v !== value)) }));
                  setPageIndex(0);
                }}
                onClose={() => setFilterPopover(null)}
              />
            );
          })()}
        </div>
        {hFade.left && (
          <div className="pointer-events-none absolute inset-y-0 left-0 z-40 w-7 bg-gradient-to-r from-background to-transparent" aria-hidden />
        )}
        {hFade.right && (
          <div className="pointer-events-none absolute inset-y-0 right-0 z-40 w-7 bg-gradient-to-l from-background to-transparent" aria-hidden />
        )}
        </div>
      </DndContext>
      )}

      {canEdit && !ordersFromOsOnly && viewMode === "table" && processedRows.length > 0 && (
        <button
          type="button"
          onClick={() => void handleAddRow()}
          className="flex h-11 shrink-0 items-center gap-2 border-t border-border/50 bg-background px-3 text-left text-sm text-muted-foreground hover:bg-muted/70 hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" /> Добавить строку
        </button>
      )}

      {!groups && viewMode === "table" && (
        <TablePagination
          page={pageIndex}
          pageSize={pageSize}
          total={processedRows.length}
          onPageChange={setPageIndex}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPageIndex(0);
          }}
        />
      )}

      {/* Нижняя полоса по макету: слева моно «16 строк · 3 группы», точечный
          лидер, справа «Общий 1 859 450 KZT». «Готово» переехало в шапку
          стола (DeskSummary) — здесь оно остаётся только до lg, где шапка
          итоги прячет; плюс суммы и «Выделено». */}
      {(grandTotals || (selectionStats && selectionStats.count > 0)) && (
        <div className="table-totals-bar z-20">
          <div className="flex min-w-0 items-baseline gap-x-3">
            <span className="shrink-0 whitespace-nowrap" title="Строк показано с учётом фильтров">
              {formatCount(filledProcessedRows.length, ["строка", "строки", "строк"])}
              {groups ? ` · ${formatCount(groups.entries.length, ["группа", "группы", "групп"])}` : ""}
            </span>
            <span className="mx-3 min-w-4 flex-1 self-center border-b border-dotted border-muted-foreground/30" aria-hidden />
            <div className="flex min-w-0 flex-wrap items-baseline justify-end gap-x-5 gap-y-1">
              {grandTotals?.parts.map((part) => (
                <p key={part.key} className="flex min-w-0 items-baseline gap-2 whitespace-nowrap">
                  <span className="truncate">{grandTotals.parts.length === 1 ? "Общий" : part.label}</span>
                  <span className="table-totals-sum text-foreground">{formatNumber(part.sum)} KZT</span>
                </p>
              ))}
              {/* С xl шапка стола показывает «Готово · В работе · Ждём» сама
                  (hidden xl:flex; до 25.09.2026 было lg — место в шапке ушло под
                  кнопку «Статистика»), а уже этих чисел там нет — дублируем
                  их здесь компактно, из той же сводки. */}
              {grandTotals && deskSummary.hasStatus && (
                <span className="flex items-baseline gap-x-4 whitespace-nowrap xl:hidden">
                  <span className="flex items-baseline gap-1.5">
                    Готово <span className="table-totals-sum text-success">{formatNumber(deskSummary.done)}</span>
                  </span>
                  {deskSummary.inProgress > 0 && (
                    <span className="flex items-baseline gap-1.5">
                      В работе <span className="table-totals-sum text-primary">{formatNumber(deskSummary.inProgress)}</span>
                    </span>
                  )}
                  {deskSummary.waiting > 0 && (
                    <span className="flex items-baseline gap-1.5">
                      Ждём <span className="table-totals-sum text-warning">{formatNumber(deskSummary.waiting)}</span>
                    </span>
                  )}
                </span>
              )}
              {/* Сумма выделенного: единственное число на экране, которое
                  отвечает на «сколько вот в этих ячейках». */}
              {selectionStats && selectionStats.count > 0 && (
                <p
                  className="flex min-w-0 items-baseline gap-2 whitespace-nowrap"
                  title={`Выделено ${selectionStats.cells} яч. · среднее ${formatNumber(Math.round(selectionStats.avg * 100) / 100)}`}
                >
                  <span className="text-primary">Выделено</span>
                  <span className="table-totals-sum text-primary">{formatNumber(selectionStats.sum)}</span>
                  <span>· {selectionStats.count} знач.</span>
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      <AddColumnDialog
        open={addColumnOpen}
        onOpenChange={setAddColumnOpen}
        workspaceId={workspaceId}
        pageId={page.id}
        existingColumns={columns}
        createColumn={addColumnService}
        onCreated={(col) => void handleColumnCreated(col)}
      />

      <Sheet open={schemaOpen} onOpenChange={setSchemaOpen}>
        <SheetContent side="right" className="flex h-full w-full max-w-md flex-col overflow-y-auto p-0">
          <SheetHeader className="border-b border-border px-5 py-4 pr-12">
            <SheetTitle>Столбцы и статусы</SheetTitle>
            <p className="text-sm text-muted-foreground">Настройка таблицы на этом столе.</p>
          </SheetHeader>
          <div className="px-5 py-5">
            <TableSchemaEditor
              columns={columns}
              statusOptions={
                (columns.find((c) => c.type === "status")
                  ? getColumnOptions(columns.find((c) => c.type === "status")!, activeWorkspace)
                  : DEFAULT_STATUS_OPTIONS)
              }
              canEdit={canEditStructure}
              onAddColumn={() => {
                setSchemaOpen(false);
                setAddColumnOpen(true);
              }}
              onRenameColumn={(key) => void handleRenameColumn(key)}
              onToggleHidden={(key) => void handleToggleHiddenColumn(key)}
              onMoveColumn={(key, dir) => void handleMoveColumn(key, dir)}
              onDeleteColumn={(key) => void handleDeleteColumn(key)}
              onManageStatuses={() => {
                setSchemaOpen(false);
                void handleManageStatuses();
              }}
              canManageStatuses={canManageVariants}
            />
          </div>
        </SheetContent>
      </Sheet>

      <ManageOptionsDialog
        open={Boolean(manageOptionsColumn) && canManageVariants}
        onOpenChange={(o) => !o && setManageOptionsColKey(null)}
        title={manageOptionsColumn ? `Варианты: «${manageOptionsColumn.label}»` : "Варианты"}
        description={
          manageOptionsColumn?.type === "responsible"
            ? "Общий список для всех столбцов «Ответственный» на сайте — изменения увидят все."
            : manageOptionsColumn?.type === "technician"
              ? "Ники технарей ведутся на «Команде» — отсюда их не поменять."
            : manageOptionsColumn?.type === "custom"
              ? `Общий список для всех столбцов «${customFields.find((f) => f.id === manageOptionsColumn.customFieldId)?.name ?? manageOptionsColumn.label}» на сайте — изменения увидят все.`
              : "Список статусов этого стола. «Готово» учитывается на дашборде."
        }
        options={
          manageOptionsColumn
            ? getColumnOptions(manageOptionsColumn, activeWorkspace)
            : DEFAULT_STATUS_OPTIONS
        }
        onSave={handleSaveColumnOptions}
        canEdit={canManageVariants}
        ensureDone={manageOptionsColumn?.type === "status"}
      />

      <RowCommentsPanel
        open={Boolean(commentRowId)}
        onOpenChange={(o) => !o && setCommentRowId(null)}
        workspaceId={workspaceId}
        pageId={page.id}
        rowId={commentRowId}
      />

      <RowCardSheet
        open={Boolean(expandedRowId)}
        onOpenChange={(o) => !o && setExpandedRowId(null)}
        // Столбцы только для показа (закрыты и целиком нарисованы добавкой —
        // «Даты» стола ОС) в списке полей были бы пустым «—»: их показывает
        // панель строки.
        columns={
          lockedKeys && cellAddon
            ? displayColumns.filter((c) => !(lockedKeys[c.key] && cellAddon.keys.includes(c.key)))
            : displayColumns
        }
        row={rows.find((r) => r.id === expandedRowId) ?? null}
        canEdit={canEdit}
        // Карточка — тот же замок, что и таблица: иначе статус в ней
        // открывался бы, и отказ прилетал уже после выбора.
        cellLock={(row, colKey) => cellLockFor(row, colKey)}
        onCellChange={handleStatusChange}
        onPrev={() => openRowAt(expandedRowIndex - 1)}
        onNext={() => openRowAt(expandedRowIndex + 1)}
        hasPrev={expandedRowIndex > 0}
        hasNext={expandedRowIndex >= 0 && expandedRowIndex < processedRowIds.length - 1}
        position={expandedRowIndex >= 0 ? { index: expandedRowIndex + 1, total: processedRowIds.length } : null}
        onMarkDone={
          kanbanStatusColumn &&
          !(viewer && cellLockFor(rows.find((r) => r.id === expandedRowId) ?? ({} as PageRow), kanbanStatusColumn.key)) &&
          (() => {
            // Стол ОС: «Готово» — только выданному заказу.
            if (!canMarkRowDone) return true;
            const r = rows.find((x) => x.id === expandedRowId);
            return Boolean(r && canMarkRowDone(r));
          })()
            ? markRowDone
            : undefined
        }
        onDuplicate={(id) => void handleDuplicateRowById(id)}
        onDelete={
          viewer && rowDeleteLockReason(rows.find((r) => r.id === expandedRowId), viewer, lockCtx)
            ? undefined
            : (id) => void handleDeleteRowById(id)
        }
        // Визитка — верхней секцией карточки. Замок тот же, что у ячейки
        // клиента: заказ ведёт ОС — технарь визитку не правит, только видит.
        clientCard={
          extrasHintKey
            ? {
                initialOf: clientCardInitial,
                canEditOf: (row) => !cellLockFor(row, extrasHintKey),
                onSave: saveClientCard,
              }
            : undefined
        }
        extraPanel={(() => {
          const r = rows.find((x) => x.id === expandedRowId);
          return r ? renderRowPanel?.(r) : null;
        })()}
        hiddenFieldKeys={rowCardHiddenKeys}
      />

      <QuickOrderDialog
        open={quickOrderOpen}
        onOpenChange={(open) => {
          setQuickOrderOpen(open);
          if (!open) setQuickOrderStatus(null);
        }}
        onSubmit={handleQuickOrder}
        osOptions={quickOrderOsOptions}
      />

      <SmartPasteDialog request={smartPaste} onCancel={() => setSmartPaste(null)} onApply={(r) => void applySmartPaste(r)} />

      <BulkActionBar
        count={selectedRowIds.size}
        total={processedRows.length}
        onDelete={handleDeleteSelected}
        onClear={() => setSelectedRowIds(new Set())}
        onSelectAll={selectAllFilteredRows}
        canEdit={canEdit}
        statusOptions={kanbanStatusColumn?.statusOptions}
        onSetStatus={handleBulkStatus}
        onMarkDone={kanbanStatusColumn ? handleBulkMarkDone : undefined}
        otherOptionColumns={bulkOtherOptionColumns}
        onSetOptionValue={handleBulkOptionValue}
        onCopy={handleCopySelectedRows}
        onDuplicate={() => void handleDuplicateSelected()}
        onExportCsv={handleExportSelectedCsv}
      />
    </div>
    </LayoutGroup>
  );
}
