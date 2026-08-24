import {
  Fragment,
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
import { Plus } from "lucide-react";
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
import { TableRow } from "@/components/table/TableRow";
import { GroupHeaderRow } from "@/components/table/GroupHeaderRow";
import { TableToolbar } from "@/components/table/TableToolbar";
import { KanbanView } from "@/components/table/KanbanView";
import { TablePagination } from "@/components/table/TablePagination";
import { FilterPopover } from "@/components/table/FilterPopover";
import { toast } from "@/components/ui/sonner";
import {
  addRow as addRowServiceBase,
  deleteRow as deleteRowServiceBase,
  duplicateRow as duplicateRowServiceBase,
  reorderRows as reorderRowsBase,
  updateRowCell as updateRowCellBase,
  updateRowHeight as updateRowHeightBase,
  updatePageColumns as updatePageColumnsBase,
  addColumn as addColumnServiceBase,
  renameColumn as renameColumnServiceBase,
  changeColumnType as changeColumnTypeServiceBase,
  duplicateColumn as duplicateColumnServiceBase,
  deleteColumn as deleteColumnServiceBase,
  updateColumnStatusOptions as updateColumnStatusOptionsBase,
} from "@/services/pageService";
import {
  addSubPageRow,
  deleteSubPageRow,
  duplicateSubPageRow,
  reorderSubPageRows,
  updateSubPageRowCell,
  updateSubPageRowHeight,
  updateSubPageColumns,
  addSubPageColumn,
  renameSubPageColumn,
  changeSubPageColumnType,
  duplicateSubPageColumn,
  deleteSubPageColumn,
  updateSubPageColumnStatusOptions,
} from "@/services/subPageService";
import { AddColumnDialog } from "@/components/table/AddColumnDialog";
import { ManageOptionsDialog } from "@/components/table/ManageOptionsDialog";
import { TableSchemaEditor } from "@/components/table/TableSchemaEditor";
import { RowCommentsPanel } from "@/components/chat/RowCommentsPanel";
import { RowCardSheet } from "@/components/table/RowCardSheet";
import { BulkActionBar } from "@/components/table/BulkActionBar";
import { useUnsavedGuard } from "@/hooks/useUnsavedGuard";
import { useUiStore } from "@/store/uiStore";
import { usePendingCellWrites } from "@/hooks/usePendingCellWrites";
import { useWorkspace } from "@/hooks/useWorkspace";
import { usePermissions } from "@/hooks/usePermissions";
import { updateResponsibleOptions, updateCustomFieldOptions } from "@/services/workspaceService";
import { formatCurrency, formatNumber, downloadCsv } from "@/utils";
import { isSummableColumn, sumNumericCells } from "@/utils/tableAggregates";
import { clampColumnWidth } from "@/utils/tableLayout";
import { getColumnOptions, isDoneStatusLabel, isOptionColumn, DEFAULT_STATUS_OPTIONS, NOT_DONE_STATUS_FILTER, findDoneStatusOption } from "@/utils/columnOptions";
import { isHttpUrl, parseHttpUrl } from "@/utils/httpUrl";
import { parseClipboardMatrix } from "@/utils/clipboardMatrix";
import { celebrateDone } from "@/utils/confetti";
import { pushUndoCommand, undo as undoLastCommand } from "@/utils/undoStore";
import type { CellAddress, ColumnType, PageRow, SortState, StatusOption, WorkspacePage } from "@/types";

const DENSITY_ROW_HEIGHT: Record<"compact" | "default" | "comfortable", number> = {
  compact: 36,
  default: 42,
  comfortable: 48,
};

type CellValue = string | number | null | undefined;

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

interface DataTableProps {
  workspaceId: string;
  page: WorkspacePage;
  rows: PageRow[];
  canEdit: boolean;
  canEditStructure: boolean;
  userId: string;
  userName: string;
  /** When set, every row/column mutation targets this subpage's nested table instead of the page's own. */
  subPageId?: string;
}

export function DataTable({ workspaceId, page, rows, canEdit, canEditStructure, userId, userName, subPageId }: DataTableProps) {
  const columns = useMemo(() => [...page.columns].sort((a, b) => a.order - b.order), [page.columns]);

  // Branch every row/column mutation between the page's own table and a
  // subpage's nested one, based on whether subPageId is set. Every call
  // site below keeps using the same short names as before — only these
  // definitions differ.
  const addRowService = subPageId
    ? (wsId: string, pId: string, cells: Record<string, string | number | null>, order: number) =>
        addSubPageRow(wsId, pId, subPageId, cells, order)
    : addRowServiceBase;
  const deleteRowService = subPageId
    ? (wsId: string, pId: string, rowId: string) => deleteSubPageRow(wsId, pId, subPageId, rowId)
    : deleteRowServiceBase;
  const duplicateRowService = subPageId
    ? (wsId: string, pId: string, row: PageRow, order: number) => duplicateSubPageRow(wsId, pId, subPageId, row, order)
    : duplicateRowServiceBase;
  const reorderRows = subPageId
    ? (wsId: string, pId: string, orderedIds: string[]) => reorderSubPageRows(wsId, pId, subPageId, orderedIds)
    : reorderRowsBase;
  const updateRowHeight = subPageId
    ? (wsId: string, pId: string, rowId: string, height: number) => updateSubPageRowHeight(wsId, pId, subPageId, rowId, height)
    : updateRowHeightBase;
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
  const updateColumnStatusOptions = subPageId
    ? (wsId: string, pId: string, cols: typeof page.columns, colKey: string, options: StatusOption[]) =>
        updateSubPageColumnStatusOptions(wsId, pId, subPageId, cols, colKey, options)
    : updateColumnStatusOptionsBase;
  async function updateRowCell(ctx: Parameters<typeof updateRowCellBase>[0]) {
    if (subPageId) {
      await updateSubPageRowCell(ctx.workspaceId, ctx.pageId, subPageId, ctx.rowId, ctx.field, ctx.newValue);
      return;
    }
    await updateRowCellBase(ctx);
  }

  const [activeCell, setActiveCell] = useState<CellAddress | null>(null);
  const [rangeAnchor, setRangeAnchor] = useState<CellAddress | null>(null);
  const [editingCell, setEditingCell] = useState<CellAddress | null>(null);
  useUnsavedGuard(Boolean(editingCell));
  const pendingWrites = usePendingCellWrites();
  const [editValue, setEditValue] = useState("");
  const [sortState, setSortState] = useState<SortState>({ colKey: null, direction: null });
  const [filters, setFilters] = useState<Record<string, Set<string>>>({});
  const [filterPopover, setFilterPopover] = useState<{ colKey: string; x: number; y: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [groupByKey, setGroupByKey] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [density, setDensity] = useState<"compact" | "default" | "comfortable">(() => {
    // Persisted across visits/reloads (per-browser) — was previously reset
    // to "default" every time you opened a table, even if you'd just set
    // it to "compact" a moment ago.
    if (typeof window === "undefined") return "default";
    const saved = window.localStorage.getItem("nova-crm:table-density");
    return saved === "compact" || saved === "default" || saved === "comfortable" ? saved : "default";
  });

  function handleDensityChange(next: "compact" | "default" | "comfortable") {
    setDensity(next);
    window.localStorage.setItem("nova-crm:table-density", next);
  }
  // Persisted per page/subpage — same localStorage-on-mount pattern as
  // pinnedKeys below, keyed by subPageId when set so each subpage tab can
  // remember its own view independently of the parent page's "Основная".
  const [viewMode, setViewMode] = useState<"table" | "kanban">(() => {
    if (typeof window === "undefined") return "table";
    const saved = window.localStorage.getItem(`nova-crm:view-mode:${subPageId ?? page.id}`);
    return saved === "kanban" ? "kanban" : "table";
  });
  function handleViewModeChange(next: "table" | "kanban") {
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
  const [pageIndex, setPageIndex] = useState(0);
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

  const { activeWorkspace } = useWorkspace();
  const permissions = usePermissions();
  const isOwner = permissions.role === "owner";
  const canManageVariants = permissions.canManageStatusVariants;
  const responsibleOptions = activeWorkspace?.responsibleOptions ?? [];
  const sharedStatusOptions = activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS;
  const customFields = activeWorkspace?.customFields ?? [];

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

  const stickyKeys = useMemo(
    () => pinnedKeys.filter((k) => displayColumns.some((c) => c.key === k)),
    [pinnedKeys, displayColumns]
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const [hFade, setHFade] = useState({ left: false, right: false });
  const isSelectingRef = useRef(false);
  const editingCellRef = useRef<CellAddress | null>(null);
  const contextRowIdRef = useRef<string | null>(null);
  const lastCheckedRowIdRef = useRef<string | null>(null);
  const pendingScrollRowIdRef = useRef<string | null>(null);
  const clipboardRef = useRef<{ matrix: string[][] } | null>(null);
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
    setSortState({ colKey: null, direction: null });
    setFilters({});
    setSearchQuery("");
    setStatusFilter(null);
    setGroupByKey(null);
    setSelectedRowIds(new Set());
    setPageIndex(0);
  }, [page.id]);

  const [coarsePointer, setCoarsePointer] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const apply = () => setCoarsePointer(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  const rowHeight = coarsePointer
    ? Math.max(52, DENSITY_ROW_HEIGHT[density])
    : Math.max(48, DENSITY_ROW_HEIGHT[density]);
  const gutterWidth = coarsePointer ? 48 : 56;

  const setTableImmersive = useUiStore((s) => s.setTableImmersive);
  const [gridFocused, setGridFocused] = useState(false);
  const [expandedTextCell, setExpandedTextCell] = useState<CellAddress | null>(null);
  useEffect(() => {
    if (!coarsePointer) {
      setTableImmersive(false);
      return;
    }
    setTableImmersive(gridFocused || Boolean(activeCell) || Boolean(editingCell));
    return () => setTableImmersive(false);
  }, [coarsePointer, gridFocused, activeCell, editingCell, setTableImmersive]);

  // ---- Filtering + search + sort ----
  const processedRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let result = rows.filter((row) => {
      if (q) {
        const matches = columns.some((c) => String(row.cells[c.key] ?? "").toLowerCase().includes(q));
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
      return true;
    });

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
        if (aEmpty && bEmpty) return 0;
        return compareFilledValues(av, bv, col?.type, dir);
      });
    } else {
      result = [...result].sort((a, b) => a.order - b.order);
    }
    return result;
  }, [rows, columns, searchQuery, filters, sortState, statusFilter, activeWorkspace]);

  const canReorderRows =
    canEdit &&
    !coarsePointer &&
    !sortState.colKey &&
    !groupByKey &&
    !searchQuery.trim() &&
    !statusFilter &&
    Object.values(filters).every((s) => !s || s.size === 0);

  // ---- Grouping ----
  const groups = useMemo(() => {
    if (!groupByKey) return null;
    const col = displayColumns.find((c) => c.key === groupByKey);
    const map = new Map<string, PageRow[]>();
    processedRows.forEach((row) => {
      const raw = String(row.cells[groupByKey] ?? "");
      const label =
        col && isOptionColumn(col.type) ? col.statusOptions?.find((o) => o.value === raw)?.label ?? raw : raw;
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
    entries.sort((a, b) => {
      const aEmpty = isEmptyGroupLabel(a[0]);
      const bEmpty = isEmptyGroupLabel(b[0]);
      if (aEmpty === bEmpty) return 0;
      return aEmpty ? 1 : -1;
    });
    return { col, entries };
  }, [groupByKey, processedRows, displayColumns]);

  // ---- Pagination (disabled while grouped) ----
  const paginatedRows = useMemo(() => {
    if (groups || !Number.isFinite(pageSize)) return processedRows;
    const start = pageIndex * pageSize;
    return processedRows.slice(start, start + pageSize);
  }, [processedRows, pageIndex, pageSize, groups]);

  const rowIds = useMemo(() => paginatedRows.map((r) => r.id), [paginatedRows]);
  const allOrderedRowIds = useMemo(() => [...rows].sort((a, b) => a.order - b.order).map((r) => r.id), [rows]);

  // ---- Virtualized rendering (flat, non-grouped view only) ----
  const shouldVirtualize = !groups && paginatedRows.length > 80;
  const rowVirtualizer = useVirtualizer({
    count: paginatedRows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: (index) => paginatedRows[index]?.height ?? rowHeight,
    overscan: 10,
    enabled: shouldVirtualize,
  });

  useEffect(() => {
    const id = pendingScrollRowIdRef.current;
    if (!id) return;
    const idx = paginatedRows.findIndex((r) => r.id === id);
    if (idx < 0) return;
    pendingScrollRowIdRef.current = null;
    rowVirtualizer.scrollToIndex(idx, { align: "end" });
    requestAnimationFrame(() => {
      containerRef.current
        ?.querySelector(`tr[data-row-id="${id}"]`)
        ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    });
  }, [paginatedRows, rowVirtualizer]);

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

  const isRowFullySelected = useCallback(
    (rowId: string) => {
      const bounds = getSelectionBounds();
      if (!bounds) return false;
      if (bounds.colStart !== 0 || bounds.colEnd !== displayColumns.length - 1) return false;
      const idx = rowIds.indexOf(rowId);
      return idx >= bounds.rowStart && idx <= bounds.rowEnd;
    },
    [getSelectionBounds, rowIds, displayColumns.length]
  );

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
      const row = rows.find((r) => r.id === rowId);
      if (!row) return;
      setEditingCell({ rowId, colKey });
      setEditValue(initialValue !== undefined ? initialValue : String(row.cells[colKey] ?? ""));
    },
    [canEdit, columns, rows]
  );

  async function persistCellEdit(rowId: string, colKey: string, oldValue: string, newValue: string) {
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

      // Auto-fill the FIRST column of the table (whatever it's called —
      // "Название" or anything else, order 0) — the very first time it goes
      // from empty to non-empty, if there's a "Дата" column on this table
      // AND it's still empty, stamp it with today's date. Only ever fires
      // once per row: the moment the date column already holds something
      // (auto-filled or hand-picked), this never touches it again.
      const isFirstColumn = columns[0]?.key === colKey;
      if (isFirstColumn && !oldValue.trim() && newValue.trim()) {
        const dateCol = columns.find((c) => c.type === "date");
        const row = rows.find((r) => r.id === rowId);
        const currentDateValue = dateCol ? row?.cells[dateCol.key] : undefined;
        const dateIsEmpty = currentDateValue === undefined || currentDateValue === null || currentDateValue === "";
        if (dateCol && dateIsEmpty) {
          await persistCellEdit(rowId, dateCol.key, "", String(Date.now()));
        }
      }
    } catch (error) {
      pendingWrites.fail(rowId, colKey, version);
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

  async function moveActiveAfterCommit(direction: "down" | "right" | "left" | "none") {
    if (direction === "none" || !activeCell) return;
    const navCols = displayColumns;
    const rIdx = rowIds.indexOf(activeCell.rowId);
    const cIdx = navCols.findIndex((c) => c.key === activeCell.colKey);

    async function createRowAndGo(colKey: string) {
      if (!canEdit) return;
      const cells: Record<string, string | number | null> = {};
      columns.forEach((c) => (cells[c.key] = ""));
      const newRow = await addRowService(workspaceId, page.id, cells, rows.length);
      pushCommand({
        undo: () => deleteRowService(workspaceId, page.id, newRow.id),
        redo: () => {
          addRowService(workspaceId, page.id, cells, rows.length);
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
    if (direction === "down" && rIdx === rowIds.length - 1) {
      await createRowAndGo(activeCell.colKey);
      return;
    }

    if (direction === "right" && cIdx >= navCols.length - 1 && rIdx === rowIds.length - 1) {
      await createRowAndGo(navCols[0]?.key ?? activeCell.colKey);
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
    if (!col || isOptionColumn(col.type) || col.type === "date") return;
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
      setEditingCell(null);
      if (oldValue !== newValue) {
        persistCellEdit(rowId, colKey, oldValue, newValue);
        pushCommand({
          undo: () => persistCellEdit(rowId, colKey, newValue, oldValue),
          redo: () => persistCellEdit(rowId, colKey, oldValue, newValue),
        });
      }
      moveActiveAfterCommit(direction);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editingCell, editValue, rows]
  );

  function handleStatusChange(rowId: string, colKey: string, value: string) {
    const row = rows.find((r) => r.id === rowId);
    const oldValue = String(row?.cells[colKey] ?? "");
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
      const isDone = (v: string) => (options.find((o) => o.value === v)?.label ?? v).toLowerCase().includes("готов");
      if (isDone(value) && !isDone(oldValue)) celebrateDone();
    }
  }

  // ---- Selection handlers ----
  function handleCellMouseDown(rowId: string, colKey: string, e: React.MouseEvent) {
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
    if (already && longText && !(expandedTextCell?.rowId === rowId && expandedTextCell?.colKey === colKey)) {
      setExpandedTextCell({ rowId, colKey });
    }
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

  function handleCopy() {
    const bounds = getSelectionBounds();
    if (!bounds) return;
    const matrix = buildMatrixFromBounds(bounds);
    clipboardRef.current = { matrix };
    navigator.clipboard?.writeText(matrix.map((l) => l.join("\t")).join("\n")).catch(() => {});
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

  async function applyMatrixPasteAt(matrix: string[][], startRowIdx: number, startColIdx: number) {
    const pastedCols = Math.max(...matrix.map((line) => line.length));
    const availableCols = displayColumns.length - startColIdx;
    if (pastedCols > availableCols) {
      toast.info(`Вставлено ${availableCols} из ${pastedCols} столбцов — правее столбцов не нашлось`);
    }

    const missingRows = startRowIdx + matrix.length - rowIds.length;
    let effectiveRowIds = rowIds;
    if (missingRows > 0) {
      if (!window.confirm(`Вставка требует ещё ${missingRows} строк(и) — создать их?`)) {
        matrix = matrix.slice(0, rowIds.length - startRowIdx);
      } else {
        const newIds: string[] = [];
        for (let i = 0; i < missingRows; i++) {
          const cells: Record<string, string | number | null> = {};
          columns.forEach((c) => (cells[c.key] = ""));
          const newRow = await addRowService(workspaceId, page.id, cells, rows.length + i);
          newIds.push(newRow.id);
        }
        effectiveRowIds = [...rowIds, ...newIds];
      }
    }

    matrix.forEach((line, ri) => {
      const rowId = effectiveRowIds[startRowIdx + ri];
      if (!rowId) return;
      const row = rows.find((r) => r.id === rowId);
      const isNewlyCreatedRow = !row;
      line.forEach((val, ci) => {
        const col = displayColumns[startColIdx + ci];
        if (!col) return;
        const oldValue = isNewlyCreatedRow ? "" : String(row!.cells[col.key] ?? "");
        let newValue = val;
        if (isOptionColumn(col.type)) {
          const match = col.statusOptions?.find((o) => o.label.toLowerCase() === val.trim().toLowerCase());
          newValue = match ? match.value : oldValue;
        }
        if (newValue !== oldValue) {
          persistCellEdit(rowId, col.key, oldValue, newValue);
          pushCommand({
            undo: () => persistCellEdit(rowId, col.key, newValue, oldValue),
            redo: () => persistCellEdit(rowId, col.key, oldValue, newValue),
          });
        }
      });
    });
  }

  async function handlePaste() {
    if (clipboardRef.current) {
      await applyMatrixPaste(clipboardRef.current.matrix);
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      await applyMatrixPaste(parseClipboardMatrix(text));
    } catch {
      // clipboard read denied — ignore
    }
  }

  function clearSelectedCells() {
    if (!canEdit) return;
    const bounds = getSelectionBounds();
    if (!bounds) return;
    for (let r = bounds.rowStart; r <= bounds.rowEnd; r++) {
      const row = rows.find((rr) => rr.id === rowIds[r]);
      if (!row) continue;
      for (let c = bounds.colStart; c <= bounds.colEnd; c++) {
        const col = displayColumns[c];
        if (!col) continue;
        const oldValue = String(row.cells[col.key] ?? "");
        if (oldValue) {
          persistCellEdit(row.id, col.key, oldValue, "");
          pushCommand({
            undo: () => persistCellEdit(row.id, col.key, "", oldValue),
            redo: () => persistCellEdit(row.id, col.key, oldValue, ""),
          });
        }
      }
    }
  }

  // ---- Keyboard navigation ----
  function revealCell(rowId: string, colKey: string, rowIndex: number) {
    if (!groupByKey) rowVirtualizer.scrollToIndex(Math.max(0, rowIndex), { align: "auto" });
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
    const cells: Record<string, string | number | null> = {};
    columns.forEach((c) => (cells[c.key] = ""));
    const newRow = await addRowService(workspaceId, page.id, cells, rows.length);
    pushCommand({
      undo: () => deleteRowService(workspaceId, page.id, newRow.id),
      redo: () => {
        addRowService(workspaceId, page.id, cells, rows.length);
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
      for (let c = bounds.colStart; c <= bounds.colEnd; c++) {
        const col = displayColumns[c];
        if (!col) continue;
        const srcRow = rows.find((r) => r.id === rowIds[bounds.rowStart]);
        const src = String(srcRow?.cells[col.key] ?? "");
        for (let r = bounds.rowStart + 1; r <= bounds.rowEnd; r++) {
          const destId = rowIds[r];
          const dest = rows.find((rr) => rr.id === destId);
          const old = String(dest?.cells[col.key] ?? "");
          if (old !== src) {
            persistCellEdit(destId, col.key, old, src);
            pushCommand({
              undo: () => persistCellEdit(destId, col.key, src, old),
              redo: () => persistCellEdit(destId, col.key, old, src),
            });
          }
        }
      }
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
    const ordered = [...rows].sort((a, b) => a.order - b.order);
    const idx = ordered.findIndex((r) => r.id === anchorId);
    if (idx < 0) {
      await handleAddRow();
      return;
    }
    const prev = where === "above" ? ordered[idx - 1] : ordered[idx];
    const next = where === "above" ? ordered[idx] : ordered[idx + 1];
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
    setActiveCell({ rowId: newRow.id, colKey: columns[0]?.key ?? "" });
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
    clipboardRef.current = { matrix };
    const text = matrix.map((line) => line.join("\t")).join("\n");
    navigator.clipboard?.writeText(text).catch(() => {});
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
        }
        return;
      }
      if (editingCellRef.current) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable=true]")) return;
      if (containerRef.current && !containerRef.current.contains(document.activeElement)) {
        if (document.activeElement !== document.body && document.activeElement !== containerRef.current) return;
      }
      if (!activeCell) return;

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
        if (e.shiftKey) void insertRowRelative(activeCell.rowId, "above");
        else void handleAddRow();
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
        startEditing(activeCell.rowId, activeCell.colKey);
        return;
      }
      if (arrowCode || e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const dir = arrowCode ?? (e.key === "ArrowUp" ? "up" : e.key === "ArrowDown" ? "down" : e.key === "ArrowLeft" ? "left" : "right");
        moveSelection(dir, e.shiftKey);
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        const first = displayColumns[0]?.key;
        if (first) {
          const next = { rowId: activeCell.rowId, colKey: first };
          setActiveCell(next);
          if (!e.shiftKey) setRangeAnchor(next);
        }
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        const last = displayColumns[displayColumns.length - 1]?.key;
        if (last) {
          const next = { rowId: activeCell.rowId, colKey: last };
          setActiveCell(next);
          if (!e.shiftKey) setRangeAnchor(next);
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
          const options = getColumnOptions(col, activeWorkspace);
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
      const newColumns = columns.map((c) => (c.key === state.colKey ? { ...c, width: state.lastValue } : c));
      updatePageColumns(workspaceId, page.id, newColumns);
    } else {
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
    const newColumns = columns.map((c) => (c.key === colKey ? { ...c, width } : c));
    void updatePageColumns(workspaceId, page.id, newColumns);
  }

  function markRowDone(rowId: string) {
    const statusCol = displayColumns.find((c) => c.type === "status");
    if (!statusCol || !canEdit) return;
    const done = findDoneStatusOption(statusCol.statusOptions ?? []);
    if (!done) return;
    handleStatusChange(rowId, statusCol.key, done.value);
  }

  // ---- Sort / filter / pin ----
  function handleSort(colKey: string) {
    setSortState((prev) => ({
      colKey,
      direction: prev.colKey === colKey && prev.direction === "asc" ? "desc" : "asc",
    }));
  }

  function handleFilterClick(colKey: string, e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setFilterPopover({ colKey, x: rect.left, y: rect.bottom + 4 });
  }

  function togglePin(colKey: string) {
    setPinnedKeys((prev) => (prev.includes(colKey) ? prev.filter((k) => k !== colKey) : [...prev, colKey]));
  }

  // ---- DnD (columns + rows) ----
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const colIds = columns.map((c) => c.id);
    if (colIds.includes(String(active.id))) {
      const oldIndex = columns.findIndex((c) => c.id === active.id);
      const newIndex = columns.findIndex((c) => c.id === over.id);
      const reordered = arrayMove(columns, oldIndex, newIndex).map((c, i) => ({ ...c, order: i }));
      await updatePageColumns(workspaceId, page.id, reordered);
      return;
    }

    if (canReorderRows && allOrderedRowIds.includes(String(active.id))) {
      const oldIndex = allOrderedRowIds.indexOf(String(active.id));
      const newIndex = allOrderedRowIds.indexOf(String(over.id));
      const reordered = arrayMove(allOrderedRowIds, oldIndex, newIndex);
      await reorderRows(workspaceId, page.id, reordered);
    }
  }

  // ---- Row-level actions ----
  async function handleAddRow() {
    setSearchQuery("");
    setPageIndex(0);
    const cells: Record<string, string | number | null> = {};
    columns.forEach((c) => (cells[c.key] = ""));
    const newRow = await addRowService(workspaceId, page.id, cells, rows.length);
    let liveId = newRow.id;
    pushCommand({
      undo: () => deleteRowService(workspaceId, page.id, liveId),
      redo: async () => {
        const restored = await addRowService(workspaceId, page.id, cells, rows.length);
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

  function handleContextMenuOpen(rowId: string) {
    contextRowIdRef.current = rowId;
  }

  async function handleDuplicateRowById(rowId: string | null | undefined) {
    if (!rowId || !canEdit) return;
    const row = rows.find((r) => r.id === rowId);
    if (!row) return;
    const copy = await duplicateRowService(workspaceId, page.id, row, rows.length);
    if (!copy) return;
    let liveId = copy.id;
    pushCommand({
      undo: () => deleteRowService(workspaceId, page.id, liveId),
      redo: async () => {
        const restored = await duplicateRowService(workspaceId, page.id, row, rows.length);
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

  function rowDiskUrl(rowId: string): string | null {
    const row = rows.find((r) => r.id === rowId);
    const diskCol = displayColumns.find((c) => c.type === "url");
    if (!row || !diskCol) return null;
    return parseHttpUrl(String(row.cells[diskCol.key] ?? ""))?.href ?? null;
  }

  async function handleDeleteRow() {
    const rowId = contextRowIdRef.current;
    if (!rowId) return;
    const row = rows.find((r) => r.id === rowId);
    if (!row) return;
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
    const ids = paginatedRows.map((r) => r.id);
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

  async function handleDeleteSelected() {
    if (!window.confirm(`Удалить выбранные строки (${selectedRowIds.size})?`)) return;
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
        if (isOptionColumn(c.type)) return c.statusOptions?.find((o) => o.value === raw)?.label ?? "";
        if (c.type === "currency" && raw) return formatCurrency(Number(raw));
        return raw;
      })
    );
    downloadCsv(`${page.name}.csv`, header, lines);
  }

  async function handleRenameColumn(colKey: string) {
    const current = columns.find((c) => c.key === colKey);
    if (!current) return;
    const newLabel = window.prompt("Новое название столбца", current.label);
    if (!newLabel || !newLabel.trim() || newLabel.trim() === current.label) return;
    await renameColumnService(workspaceId, page.id, columns, colKey, newLabel.trim());
    toast.success("Столбец переименован");
  }

  async function handleChangeColumnType(colKey: string, type: ColumnType, customFieldId?: string) {
    const current = columns.find((c) => c.key === colKey);
    if (!current || (current.type === type && current.customFieldId === customFieldId)) return;
    const seeded = type === "status" ? DEFAULT_STATUS_OPTIONS : undefined;
    await changeColumnTypeService(workspaceId, page.id, columns, colKey, type, seeded, customFieldId);
    toast.success("Тип столбца изменён");
  }

  const kanbanStatusColumn = displayColumns.find((c) => c.type === "status") ?? null;

  const manageOptionsColumn = columns.find((c) => c.key === manageOptionsColKey) ?? null;

  async function handleSaveColumnOptions(options: StatusOption[]) {
    if (!manageOptionsColumn) return;
    if (manageOptionsColumn.type === "status") {
      if (!permissions.canManageStatusVariants) throw new Error("Варианты статуса меняет только Owner");
      await updateColumnStatusOptions(workspaceId, page.id, columns, manageOptionsColumn.key, options);
    } else if (manageOptionsColumn.type === "responsible") {
      if (!isOwner) throw new Error("Список ответственных меняет только Owner");
      await updateResponsibleOptions(workspaceId, options);
    } else if (manageOptionsColumn.type === "custom" && manageOptionsColumn.customFieldId) {
      if (!isOwner) throw new Error("Кастомные поля меняет только Owner");
      await updateCustomFieldOptions(workspaceId, customFields, manageOptionsColumn.customFieldId, options);
    }
    toast.success("Варианты обновлены");
  }

  async function handleManageStatuses() {
    if (!permissions.canManageStatusVariants) return;
    let statusCol = columns.find((c) => c.type === "status");
    if (!statusCol) {
      const keys = new Set(columns.map((c) => c.key));
      let key = "status";
      let i = 1;
      while (keys.has(key)) {
        key = `status_${i}`;
        i += 1;
      }
      statusCol = await addColumnService(workspaceId, page.id, columns, {
        key,
        label: "Статус",
        type: "status",
        statusOptions: DEFAULT_STATUS_OPTIONS,
      });
      toast.success("Столбец «Статус» добавлен");
    }
    setManageOptionsColKey(statusCol.key);
  }

  async function handleToggleHiddenColumn(colKey: string) {
    const next = columns.map((c) => (c.key === colKey ? { ...c, hidden: !c.hidden } : c));
    await updatePageColumns(workspaceId, page.id, next);
  }

  async function handleMoveColumn(colKey: string, direction: -1 | 1) {
    const ordered = [...columns].sort((a, b) => a.order - b.order);
    const index = ordered.findIndex((c) => c.key === colKey);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) return;
    const swapped = [...ordered];
    const tmp = swapped[index];
    swapped[index] = swapped[nextIndex];
    swapped[nextIndex] = tmp;
    await updatePageColumns(
      workspaceId,
      page.id,
      swapped.map((c, i) => ({ ...c, order: i }))
    );
  }

  async function handleDuplicateColumn(colKey: string) {
    const copy = await duplicateColumnService(workspaceId, page.id, columns, colKey);
    toast.success(`Столбец «${copy.label}» создан`);
  }

  async function handleDeleteColumn(colKey: string) {
    const current = columns.find((c) => c.key === colKey);
    if (!current) return;
    if (!window.confirm(`Удалить столбец «${current.label}»? Данные в нём будут скрыты.`)) return;
    const originalIndex = columns.findIndex((c) => c.key === colKey);
    await deleteColumnService(workspaceId, page.id, columns, colKey);
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
          if (label.toLowerCase().includes("готов")) {
            done += sumNumericCells([row], col.key);
          }
        }
      }
      sums[col.key] = { sum, done };
    }
    return sums;
  }, [columns, processedRows, sharedStatusOptions]);

  const selectionNumericSum = useMemo(() => {
    const bounds = getSelectionBounds();
    if (!bounds) return null;
    let sum = 0;
    let count = 0;
    for (let r = bounds.rowStart; r <= bounds.rowEnd; r++) {
      const row = paginatedRows[r];
      if (!row) continue;
      for (let c = bounds.colStart; c <= bounds.colEnd; c++) {
        const col = displayColumns[c];
        if (!col || !isSummableColumn(col.type)) continue;
        const n = Number(String(row.cells[col.key] ?? "").replace(/\s/g, "").replace(",", "."));
        if (!Number.isFinite(n)) continue;
        sum += n;
        count += 1;
      }
    }
    return count > 1 ? sum : null;
  }, [getSelectionBounds, paginatedRows, displayColumns]);

  const virtualItems = shouldVirtualize ? rowVirtualizer.getVirtualItems() : [];
  const totalSize = shouldVirtualize ? rowVirtualizer.getTotalSize() : 0;
  const paddingTop = shouldVirtualize && virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    shouldVirtualize && virtualItems.length > 0 ? totalSize - virtualItems[virtualItems.length - 1].end : 0;

  function renderRow(row: PageRow, index: number) {
    const effectiveRowHeight =
      resizePreview?.type === "row" && resizePreview.rowId === row.id
        ? resizePreview.height
        : row.height ?? rowHeight;
    const displayRow = columns.some((c) => pendingWrites.state(row.id, c.key) !== "idle")
      ? {
          ...row,
          cells: Object.fromEntries(
            columns.map((c) => [c.key, pendingWrites.resolve(row.id, c.key, row.cells[c.key] ?? null)])
          ),
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
        canReorder={canReorderRows}
        isRowFullySelected={isRowFullySelected(row.id)}
        isChecked={selectedRowIds.has(row.id)}
        pinnedKeys={stickyKeys}
        gutterWidth={gutterWidth}
        onToggleChecked={toggleRowChecked}
        onCellMouseDown={handleCellMouseDown}
        onCellMouseEnter={handleCellMouseEnter}
        onCellStartEdit={(rowId, colKey) => startEditing(rowId, colKey)}
        onEditValueChange={setEditValue}
        onCommitEdit={handleCommitEdit}
        onCancelEdit={() => setEditingCell(null)}
        onStatusChange={handleStatusChange}
        onRowNumberMouseDown={(rowId, e) => handleRowNumberMouseDown(rowId, e)}
        onRowResizeStart={handleRowResizeStart}
        onContextMenuOpen={handleContextMenuOpen}
        onExpandRow={setExpandedRowId}
        onDuplicateRow={(id) => void handleDuplicateRowById(id)}
        onDeleteRow={(id) => void handleDeleteRowById(id)}
        onCopyDiskUrl={(id) => handleCopyDiskUrl(id)}
        diskUrl={rowDiskUrl(row.id)}
        onUndoLast={() => void undoLastCommand()}
        isExpanded={expandedRowId === row.id}
        coarsePointer={coarsePointer}
        statusTint={
          (() => {
            const statusCol = displayColumns.find((c) => c.type === "status");
            if (!statusCol) return undefined;
            const raw = String(displayRow.cells[statusCol.key] ?? "");
            return statusCol.statusOptions?.find((o) => o.value === raw)?.color;
          })()
        }
        onMarkDone={() => markRowDone(row.id)}
        onInsertRowAbove={(id) => void insertRowRelative(id, "above")}
        onInsertRowBelow={(id) => void insertRowRelative(id, "below")}
        onCopyRow={(id) => handleCopyRow(id)}
        expandedColKey={expandedTextCell?.rowId === row.id ? expandedTextCell.colKey : null}
      />
    );
  }

  useEffect(() => {
    const el = containerRef.current;
    if (!el || viewMode !== "table") return;
    const update = () => {
      setHFade({
        left: el.scrollLeft > 8,
        right: el.scrollLeft + el.clientWidth < el.scrollWidth - 8,
      });
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [displayColumns, paginatedRows.length, viewMode]);

  const pinnedOrder = displayColumns.filter((c) => stickyKeys.includes(c.key));

  const isSaving = pendingWrites.hasSavingCell;

  return (
    <LayoutGroup>
    <div className="relative flex h-full min-h-0 flex-col bg-background">
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
        groupByKey={groupByKey}
        onGroupByChange={setGroupByKey}
        density={density}
        onDensityChange={handleDensityChange}
        onAddRow={handleAddRow}
        onExportCsv={handleExportCsv}
        canEdit={canEdit}
        canEditStructure={canEditStructure}
        onAddColumn={() => setAddColumnOpen(true)}
        onOpenSchema={() => setSchemaOpen(true)}
        onManageStatuses={() => void handleManageStatuses()}
        canManageStatuses={canManageVariants}
        selectedCount={selectedRowIds.size}
        onDeleteSelected={handleDeleteSelected}
        hasStatusColumn={Boolean(kanbanStatusColumn)}
        statusOptions={kanbanStatusColumn?.statusOptions}
        statusFilter={statusFilter}
        onStatusFilterChange={(v) => {
          setStatusFilter(v);
          setPageIndex(0);
        }}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
      />

      {viewMode === "kanban" && kanbanStatusColumn ? (
        <KanbanView
          columns={displayColumns}
          rows={processedRows}
          statusColumn={kanbanStatusColumn}
          canEdit={canEdit}
          onStatusChange={handleStatusChange}
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
            void applyMatrixPaste(parseClipboardMatrix(text));
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
                  <div className="flex h-11 items-center justify-center sm:h-9">
                    <Checkbox
                      checked={paginatedRows.length > 0 && paginatedRows.every((r) => selectedRowIds.has(r.id))}
                      onClick={(e) => {
                        e.preventDefault();
                        toggleSelectAllVisible();
                      }}
                      aria-label="Выбрать все строки"
                    />
                  </div>
                </th>
                <SortableContext items={displayColumns.map((c) => c.id)} strategy={horizontalListSortingStrategy}>
                  {displayColumns.map((column) => (
                    <ColumnHeaderCell
                      key={column.id}
                      column={column}
                      sortState={sortState}
                      onSort={handleSort}
                      onFilterClick={handleFilterClick}
                      hasActiveFilter={(filters[column.key]?.size ?? 0) > 0}
                      onResizeStart={handleColumnResizeStart}
                      onAutoSize={handleAutoSizeColumn}
                      isPinned={pinnedKeys.includes(column.key)}
                      onTogglePin={togglePin}
                      stickyLeft={
                        stickyKeys.includes(column.key)
                          ? gutterWidth +
                            pinnedOrder.slice(0, pinnedOrder.findIndex((c) => c.key === column.key)).reduce((sum, c) => sum + c.width, 0)
                          : undefined
                      }
                      isLastSticky={pinnedOrder.length > 0 && column.key === pinnedOrder[pinnedOrder.length - 1].key}
                      canReorder={canEdit && !coarsePointer}
                      compactChrome={coarsePointer}
                      canEditStructure={canEditStructure}
                      canManageOptions={canManageVariants}
                      onToggleHidden={canEditStructure ? handleToggleHiddenColumn : undefined}
                      onRename={handleRenameColumn}
                      onChangeType={handleChangeColumnType}
                      onManageOptions={canManageVariants ? setManageOptionsColKey : undefined}
                      onDuplicate={handleDuplicateColumn}
                      onDelete={handleDeleteColumn}
                      onSelectColumn={selectColumn}
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
              </tr>
            </thead>
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <tbody>
                  {groups ? (
                    groups.entries.map(([label, groupRows]) => {
                      const collapsed = collapsedGroups.has(label);
                      return (
                        <Fragment key={label}>
                          <GroupHeaderRow
                            label={label}
                            count={groupRows.length}
                            colSpan={columns.length}
                            collapsed={collapsed}
                            color={groups.col?.statusOptions?.find((o) => o.label === label)?.color}
                            onToggle={() =>
                              setCollapsedGroups((prev) => {
                                const next = new Set(prev);
                                if (next.has(label)) next.delete(label);
                                else next.add(label);
                                return next;
                              })
                            }
                          />
                          {!collapsed && groupRows.map((row, i) => renderRow(row, i))}
                        </Fragment>
                      );
                    })
                  ) : (
                    <SortableContext items={rowIds} strategy={verticalListSortingStrategy}>
                      {paddingTop > 0 && (
                        <tr>
                          <td colSpan={columns.length + 1} style={{ height: paddingTop }} />
                        </tr>
                      )}
                      {(shouldVirtualize ? virtualItems.map((virtualRow) => virtualRow.index) : paginatedRows.map((_, i) => i)).map((index) => {
                        const row = paginatedRows[index];
                        if (!row) return null;
                        return renderRow(row, index);
                      })}
                      {paddingBottom > 0 && (
                        <tr>
                          <td colSpan={columns.length + 1} style={{ height: paddingBottom }} />
                        </tr>
                      )}
                    </SortableContext>
                  )}
                  {processedRows.length === 0 && (
                    <tr>
                      <td colSpan={columns.length + 1}>
                        {rows.length === 0 ? (
                          <EmptyState
                            className="py-12"
                            title="Пока пусто"
                            action={
                              canEdit ? (
                                <Button size="sm" className="gap-1.5" onClick={handleAddRow}>
                                  <Plus className="h-3.5 w-3.5" /> Добавить строку
                                </Button>
                              ) : undefined
                            }
                          />
                        ) : (
                          <EmptyState className="py-12" title="Ничего не найдено" />
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onClick={handleCopy}>
                  Копировать <ContextMenuShortcut>Ctrl+C</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem onClick={handlePaste} disabled={!canEdit}>
                  Вставить <ContextMenuShortcut>Ctrl+V</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem onClick={() => handleCopyRow()}>
                  Копировать строку
                </ContextMenuItem>
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
            {processedRows.length > 0 && (
              <tfoot className="sticky bottom-0 z-20 overflow-visible">
                <tr className="border-t border-border/70 bg-background">
                  <td
                    className="table-sticky-col sticky left-0 z-30 border-r border-border/50 bg-background px-1 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))] text-center font-mono text-[11px] tabular text-muted-foreground"
                    style={{ width: gutterWidth, minWidth: gutterWidth }}
                    title="Строк в фильтре"
                  >
                    <div className="flex flex-col items-center gap-0.5">
                      <span>{processedRows.length}</span>
                      {selectionNumericSum != null && (
                        <span className="text-[10px] text-primary" title="Сумма выделенных чисел">
                          Σ {formatNumber(selectionNumericSum)}
                        </span>
                      )}
                    </div>
                  </td>
                  {displayColumns.map((column) => {
                    const tot = columnTotals[column.key];
                    const stickyLeft = stickyKeys.includes(column.key)
                      ? gutterWidth +
                        pinnedOrder.slice(0, pinnedOrder.findIndex((c) => c.key === column.key)).reduce((sum, c) => sum + c.width, 0)
                      : undefined;
                    return (
                      <td
                        key={`total-${column.id}`}
                        className={`overflow-visible whitespace-normal border-r border-border/35 px-2 py-2.5 pb-[max(0.6rem,env(safe-area-inset-bottom,0px))] text-right text-sm leading-tight tabular-nums ${
                          stickyLeft !== undefined ? "table-sticky-col sticky z-[25] bg-background" : "bg-background"
                        } ${pinnedOrder.length && column.key === pinnedOrder[pinnedOrder.length - 1].key ? "table-sticky-edge" : ""}`}
                        style={{
                          width: column.width,
                          minWidth: column.width,
                          left: stickyLeft,
                        }}
                      >
                        {column.type === "date" ? null : tot ? (
                          <div className="flex min-w-0 flex-col items-end gap-0.5">
                            <span
                              className="block max-w-full truncate font-medium"
                              title={column.type === "currency" ? formatCurrency(tot.sum) : formatNumber(tot.sum)}
                            >
                              {column.type === "currency" ? formatCurrency(tot.sum) : formatNumber(tot.sum)}
                            </span>
                            {tot.done !== undefined && (
                              <span className="block max-w-full whitespace-normal break-words text-[10px] leading-tight text-success" title={`Готово ${formatCurrency(tot.done)}`}>
                                Готово {formatCurrency(tot.done)}
                              </span>
                            )}
                          </div>
                        ) : column.key === displayColumns[0]?.key ? (
                          <span className="block text-left text-[11px] text-muted-foreground">Итого</span>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            )}
          </table>

          {filterPopover && (
            <FilterPopover
              x={filterPopover.x}
              y={filterPopover.y}
              values={Array.from(
                new Set(
                  rows.map((r) => {
                    const col = displayColumns.find((c) => c.key === filterPopover.colKey);
                    const raw = String(r.cells[filterPopover.colKey] ?? "");
                    return col && isOptionColumn(col.type)
                      ? col.statusOptions?.find((o) => o.value === raw)?.label ?? raw
                      : raw;
                  })
                )
              ).sort((a, b) => a.localeCompare(b, "ru"))}
              excluded={filters[filterPopover.colKey] ?? new Set()}
              onToggleValue={(value) =>
                setFilters((prev) => {
                  const next = { ...prev };
                  const set = new Set(next[filterPopover.colKey] ?? []);
                  if (set.has(value)) set.delete(value);
                  else set.add(value);
                  next[filterPopover.colKey] = set;
                  return next;
                })
              }
              onSelectAll={() => setFilters((prev) => ({ ...prev, [filterPopover.colKey]: new Set() }))}
              onClose={() => setFilterPopover(null)}
            />
          )}
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

      {canEdit && viewMode === "table" && processedRows.length > 0 && (
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

      <AddColumnDialog
        open={addColumnOpen}
        onOpenChange={setAddColumnOpen}
        workspaceId={workspaceId}
        pageId={page.id}
        existingColumns={columns}
        createColumn={addColumnService}
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
        columns={displayColumns}
        row={rows.find((r) => r.id === expandedRowId) ?? null}
      />

      <BulkActionBar
        count={selectedRowIds.size}
        onDelete={handleDeleteSelected}
        onClear={() => setSelectedRowIds(new Set())}
        canEdit={canEdit}
        statusOptions={kanbanStatusColumn?.statusOptions}
        onSetStatus={handleBulkStatus}
      />
    </div>
    </LayoutGroup>
  );
}
