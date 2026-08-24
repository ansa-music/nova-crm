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
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ColumnHeaderCell } from "@/components/table/ColumnHeaderCell";
import { TableRow, ROW_GUTTER_WIDTH } from "@/components/table/TableRow";
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
} from "@/services/subPageService";
import { AddColumnDialog } from "@/components/table/AddColumnDialog";
import { ManageOptionsDialog } from "@/components/table/ManageOptionsDialog";
import { RowCommentsPanel } from "@/components/chat/RowCommentsPanel";
import { RowCardSheet } from "@/components/table/RowCardSheet";
import { useUnsavedGuard } from "@/hooks/useUnsavedGuard";
import { usePendingCellWrites } from "@/hooks/usePendingCellWrites";
import { useWorkspace } from "@/hooks/useWorkspace";
import { usePermissions } from "@/hooks/usePermissions";
import { updateResponsibleOptions, updateStatusOptions, updateCustomFieldOptions } from "@/services/workspaceService";
import { formatCurrency, downloadCsv } from "@/utils";
import { getColumnOptions, isOptionColumn, DEFAULT_STATUS_OPTIONS } from "@/utils/columnOptions";
import { celebrateDone } from "@/utils/confetti";
import { pushUndoCommand, undo as undoLastCommand } from "@/utils/undoStore";
import type { CellAddress, ColumnType, PageRow, SortState, StatusOption, WorkspacePage } from "@/types";

const DENSITY_ROW_HEIGHT: Record<"compact" | "default" | "comfortable", number> = {
  compact: 30,
  default: 38,
  comfortable: 48,
};

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
  const responsibleOptions = activeWorkspace?.responsibleOptions ?? [];
  const sharedStatusOptions = activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS;
  const customFields = activeWorkspace?.customFields ?? [];

  // Columns with the live drag preview AND the shared "Ответственный" list
  // overlaid, used only for rendering/exporting/grouping — selection math,
  // sorting, and every *Service(...) mutation call always use the stable
  // `columns` array untouched, so the workspace-wide list never gets
  // accidentally persisted into a specific column's own statusOptions field.
  const displayColumns = useMemo(() => {
    return columns.map((c) => {
      let next = c;
      if (resizePreview?.type === "col" && c.key === resizePreview.colKey) {
        next = { ...next, width: resizePreview.width };
      }
      if (c.type === "responsible") {
        next = { ...next, statusOptions: responsibleOptions };
      } else if (c.type === "status") {
        next = { ...next, statusOptions: sharedStatusOptions };
      } else if (c.type === "custom") {
        const options = customFields.find((f) => f.id === c.customFieldId)?.options ?? [];
        next = { ...next, statusOptions: options };
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, resizePreview, responsibleOptions, sharedStatusOptions, customFields]);

  const containerRef = useRef<HTMLDivElement>(null);
  const isSelectingRef = useRef(false);
  const editingCellRef = useRef<CellAddress | null>(null);
  const contextRowIdRef = useRef<string | null>(null);
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

  // Reset transient selection whenever the page changes.
  useEffect(() => {
    setActiveCell(null);
    setRangeAnchor(null);
    setEditingCell(null);
    setSortState({ colKey: null, direction: null });
    setFilters({});
    setSearchQuery("");
    setGroupByKey(null);
    setSelectedRowIds(new Set());
    setPageIndex(0);
  }, [page.id]);

  const rowHeight = DENSITY_ROW_HEIGHT[density];

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
      return true;
    });

    if (sortState.colKey && sortState.direction) {
      const col = columns.find((c) => c.key === sortState.colKey);
      const dir = sortState.direction;
      result = [...result].sort((a, b) => {
        const av = a.cells[sortState.colKey!] ?? "";
        const bv = b.cells[sortState.colKey!] ?? "";
        if (col?.type === "number" || col?.type === "currency") {
          const an = Number(av) || 0;
          const bn = Number(bv) || 0;
          return dir === "asc" ? an - bn : bn - an;
        }
        const cmp = String(av).localeCompare(String(bv), "ru");
        return dir === "asc" ? cmp : -cmp;
      });
    } else {
      result = [...result].sort((a, b) => a.order - b.order);
    }
    return result;
  }, [rows, columns, searchQuery, filters, sortState]);

  const canReorderRows =
    canEdit &&
    !sortState.colKey &&
    !groupByKey &&
    !searchQuery.trim() &&
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
      const key = label;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    });
    return { col, entries: Array.from(map.entries()) };
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
  const rowVirtualizer = useVirtualizer({
    count: paginatedRows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: (index) => paginatedRows[index]?.height ?? rowHeight,
    overscan: 10,
  });

  // ---- Selection bounds ----
  const getSelectionBounds = useCallback(() => {
    if (!activeCell) return null;
    const anchor = rangeAnchor ?? activeCell;
    const rAnchor = rowIds.indexOf(anchor.rowId);
    const rFocus = rowIds.indexOf(activeCell.rowId);
    const cAnchor = columns.findIndex((c) => c.key === anchor.colKey);
    const cFocus = columns.findIndex((c) => c.key === activeCell.colKey);
    if (rAnchor === -1 || rFocus === -1) return null;
    return {
      rowStart: Math.min(rAnchor, rFocus),
      rowEnd: Math.max(rAnchor, rFocus),
      colStart: Math.min(cAnchor, cFocus),
      colEnd: Math.max(cAnchor, cFocus),
    };
  }, [activeCell, rangeAnchor, rowIds, columns]);

  const rangeCells = useMemo(() => {
    const bounds = getSelectionBounds();
    const set = new Set<string>();
    if (!bounds) return set;
    for (let r = bounds.rowStart; r <= bounds.rowEnd; r++) {
      for (let c = bounds.colStart; c <= bounds.colEnd; c++) {
        set.add(`${rowIds[r]}:${columns[c].key}`);
      }
    }
    return set;
  }, [getSelectionBounds, rowIds, columns]);

  const isRowFullySelected = useCallback(
    (rowId: string) => {
      const bounds = getSelectionBounds();
      if (!bounds) return false;
      if (bounds.colStart !== 0 || bounds.colEnd !== columns.length - 1) return false;
      const idx = rowIds.indexOf(rowId);
      return idx >= bounds.rowStart && idx <= bounds.rowEnd;
    },
    [getSelectionBounds, rowIds, columns.length]
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
      if (!col || isOptionColumn(col.type)) return;
      const row = rows.find((r) => r.id === rowId);
      if (!row) return;
      setEditingCell({ rowId, colKey });
      setEditValue(initialValue !== undefined ? initialValue : String(row.cells[colKey] ?? ""));
    },
    [canEdit, columns, rows]
  );

  async function persistCellEdit(rowId: string, colKey: string, oldValue: string, newValue: string) {
    const version = pendingWrites.begin(rowId, colKey, newValue);
    try {
      const col = columns.find((c) => c.key === colKey);
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
      });
      throw error;
    }
  }

  async function moveActiveAfterCommit(direction: "down" | "right" | "left" | "none") {
    if (direction === "none" || !activeCell) return;
    const rIdx = rowIds.indexOf(activeCell.rowId);
    const cIdx = columns.findIndex((c) => c.key === activeCell.colKey);

    // Enter on the last row: auto-create a fresh empty row and jump straight
    // into editing the same column on it — matches Google Sheets/Airtable's
    // "just keep typing" flow instead of getting stuck on the last row.
    if (direction === "down" && rIdx === rowIds.length - 1) {
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
      const nextAddr = { rowId: newRow.id, colKey: activeCell.colKey };
      requestAnimationFrame(() => {
        setActiveCell(nextAddr);
        setRangeAnchor(nextAddr);
        const col = columns.find((c) => c.key === nextAddr.colKey);
        if (col && !isOptionColumn(col.type)) {
          setEditingCell(nextAddr);
          setEditValue("");
        }
        containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight });
      });
      return;
    }

    let nr = rIdx;
    let nc = cIdx;
    if (direction === "down") nr = Math.min(rowIds.length - 1, rIdx + 1);
    if (direction === "right") nc = Math.min(columns.length - 1, cIdx + 1);
    if (direction === "left") nc = Math.max(0, cIdx - 1);
    const next = { rowId: rowIds[nr], colKey: columns[nc].key };
    setActiveCell(next);
    setRangeAnchor(next);

    // Enter (down) auto-opens editing on the newly active cell so the
    // person can just keep typing without a second keypress — Tab/Shift+Tab
    // deliberately only move the selection, matching normal spreadsheet feel.
    if (direction === "down" && canEdit) {
      const col = columns.find((c) => c.key === next.colKey);
      if (col && !isOptionColumn(col.type)) {
        const row = rows.find((r) => r.id === next.rowId);
        setEditingCell(next);
        setEditValue(String(row?.cells[next.colKey] ?? ""));
      }
    }
  }

  const handleCommitEdit = useCallback(
    (direction: "down" | "right" | "left" | "none" = "none") => {
      if (!editingCell) return;
      const { rowId, colKey } = editingCell;
      const row = rows.find((r) => r.id === rowId);
      const oldValue = String(row?.cells[colKey] ?? "");
      const newValue = editValue;
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
    e.preventDefault();
    if (editingCellRef.current && (editingCellRef.current.rowId !== rowId || editingCellRef.current.colKey !== colKey)) {
      // Switching to a different cell while one is being edited must persist
      // the in-progress value first — it must never be silently discarded.
      handleCommitEdit("none");
    }
    const addr = { rowId, colKey };
    if (e.shiftKey && activeCell) {
      setActiveCell(addr);
    } else {
      setRangeAnchor(addr);
      setActiveCell(addr);
      isSelectingRef.current = true;
    }
  }

  function handleCellMouseEnter(rowId: string, colKey: string) {
    if (isSelectingRef.current) setActiveCell({ rowId, colKey });
  }

  function handleRowNumberMouseDown(rowId: string) {
    setRangeAnchor({ rowId, colKey: columns[0].key });
    setActiveCell({ rowId, colKey: columns[columns.length - 1].key });
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
    const startRowIdx = rowIds.indexOf(activeCell.rowId);
    const startColIdx = columns.findIndex((c) => c.key === activeCell.colKey);
    if (startRowIdx === -1) return;

    // Smart-paste guardrails: warn (don't block) when the pasted block's
    // shape doesn't match what's actually there, and auto-create any extra
    // rows needed instead of silently dropping data past the table's
    // current last row — pasting a big block used to just truncate
    // whatever didn't fit, with no indication anything was lost.
    const pastedCols = Math.max(...matrix.map((line) => line.length));
    const availableCols = columns.length - startColIdx;
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
      const lines = text.replace(/\r/g, "").split("\n");
      if (lines[lines.length - 1] === "") lines.pop();
      await applyMatrixPaste(lines.map((l) => l.split("\t")));
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
        const col = columns[c];
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
  function moveSelection(direction: "up" | "down" | "left" | "right", extend: boolean) {
    if (!activeCell) return;
    const rIdx = rowIds.indexOf(activeCell.rowId);
    const cIdx = columns.findIndex((c) => c.key === activeCell.colKey);
    let nr = rIdx;
    let nc = cIdx;
    if (direction === "up") nr = Math.max(0, rIdx - 1);
    if (direction === "down") nr = Math.min(rowIds.length - 1, rIdx + 1);
    if (direction === "left") nc = Math.max(0, cIdx - 1);
    if (direction === "right") nc = Math.min(columns.length - 1, cIdx + 1);
    const next = { rowId: rowIds[nr], colKey: columns[nc].key };
    setActiveCell(next);
    if (!extend) setRangeAnchor(next);
    else if (!rangeAnchor) setRangeAnchor(activeCell);
  }

  // Tab at the very last column wraps to the first column of the NEXT row
  // (spreadsheet convention) — and if that's also the last row, creates a
  // fresh empty one first, mirroring Enter's same auto-create-row behavior
  // in moveActiveAfterCommit above. Without this, Tab-ing through a wide
  // table just got stuck at the last cell of the last row.
  async function handleTabForward() {
    if (!activeCell) return;
    const rIdx = rowIds.indexOf(activeCell.rowId);
    const cIdx = columns.findIndex((c) => c.key === activeCell.colKey);
    if (cIdx !== columns.length - 1) {
      moveSelection("right", false);
      return;
    }
    if (rIdx !== rowIds.length - 1) {
      const next = { rowId: rowIds[rIdx + 1], colKey: columns[0].key };
      setActiveCell(next);
      setRangeAnchor(next);
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
    const nextAddr = { rowId: newRow.id, colKey: columns[0].key };
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
  const handleKeyDownRef = useRef<(e: KeyboardEvent) => void>(() => {});
  handleKeyDownRef.current = function handleKeyDown(e: KeyboardEvent) {
      const isCtrl = e.ctrlKey || e.metaKey;

      // Ctrl+Z/Ctrl+Y are handled by a single, app-wide listener now
      // (GlobalUndoHotkeys, mounted in AppLayout) — not here. That listener
      // also uses e.code instead of e.key so it isn't silently broken by
      // Cyrillic/non-Latin keyboard layouts (see its own comment).

      if (editingCellRef.current) return;
      if (containerRef.current && !containerRef.current.contains(document.activeElement)) {
        if (document.activeElement !== document.body) return;
      }
      if (!activeCell) return;

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
      if (e.key === "ArrowUp") {
        e.preventDefault();
        moveSelection("up", e.shiftKey);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        moveSelection("down", e.shiftKey);
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        moveSelection("left", e.shiftKey);
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        moveSelection("right", e.shiftKey);
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
    window.addEventListener("keydown", dispatch);
    return () => window.removeEventListener("keydown", dispatch);
  }, []);

  // ---- Resize ----
  // Dragging only updates local state (resizePreview) for instant visual
  // feedback — Firestore is written exactly once, on mouseup. Writing on
  // every mousemove would flood Firestore with dozens of writes per second
  // and make the drag feel laggy for every collaborator watching the page.
  function handleColumnResizeStart(colKey: string, e: React.MouseEvent) {
    const col = columns.find((c) => c.key === colKey)!;
    resizeStateRef.current = { type: "col", colKey, startPos: e.clientX, startSize: col.width, lastValue: col.width };
    setResizePreview({ type: "col", colKey, width: col.width });
    window.addEventListener("mousemove", handleResizeMove);
    window.addEventListener("mouseup", handleResizeEnd);
  }

  function handleRowResizeStart(rowId: string, e: React.MouseEvent) {
    const row = rows.find((r) => r.id === rowId);
    const startHeight = row?.height ?? rowHeight;
    resizeStateRef.current = { type: "row", rowId, startPos: e.clientY, startSize: startHeight, lastValue: startHeight };
    setResizePreview({ type: "row", rowId, height: startHeight });
    window.addEventListener("mousemove", handleResizeMove);
    window.addEventListener("mouseup", handleResizeEnd);
  }

  function handleResizeMove(e: MouseEvent) {
    const state = resizeStateRef.current;
    if (!state) return;
    if (state.type === "col") {
      const delta = e.clientX - state.startPos;
      const newWidth = Math.max(60, Math.round(state.startSize + delta));
      state.lastValue = newWidth;
      setResizePreview({ type: "col", colKey: state.colKey, width: newWidth });
    } else {
      const delta = e.clientY - state.startPos;
      const newHeight = Math.max(22, Math.round(state.startSize + delta));
      state.lastValue = newHeight;
      setResizePreview({ type: "row", rowId: state.rowId, height: newHeight });
    }
  }

  function handleResizeEnd() {
    const state = resizeStateRef.current;
    resizeStateRef.current = null;
    setResizePreview(null);
    window.removeEventListener("mousemove", handleResizeMove);
    window.removeEventListener("mouseup", handleResizeEnd);
    if (!state) return;
    if (state.type === "col") {
      const newColumns = columns.map((c) => (c.key === state.colKey ? { ...c, width: state.lastValue } : c));
      updatePageColumns(workspaceId, page.id, newColumns);
    } else {
      updateRowHeight(workspaceId, page.id, state.rowId, state.lastValue);
    }
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
    requestAnimationFrame(() => {
      setActiveCell({ rowId: newRow.id, colKey: columns[0].key });
      setRangeAnchor({ rowId: newRow.id, colKey: columns[0].key });
      if (!isOptionColumn(columns[0].type)) {
        setEditingCell({ rowId: newRow.id, colKey: columns[0].key });
        setEditValue("");
      }
      containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight });
    });
  }

  function handleContextMenuOpen(rowId: string) {
    contextRowIdRef.current = rowId;
  }

  async function handleDuplicateRow() {
    const rowId = contextRowIdRef.current;
    const row = rows.find((r) => r.id === rowId);
    if (!row) return;
    await duplicateRowService(workspaceId, page.id, row, rows.length);
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

  function toggleRowChecked(rowId: string) {
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
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
    // Neither "status", "responsible", nor "custom" store their own options
    // anymore — all three read a shared, workspace-wide list — so there's
    // never anything to carry over into the column doc itself.
    await changeColumnTypeService(workspaceId, page.id, columns, colKey, type, undefined, customFieldId);
    toast.success("Тип столбца изменён");
  }

  const kanbanStatusColumn = displayColumns.find((c) => c.type === "status") ?? null;

  const manageOptionsColumn = columns.find((c) => c.key === manageOptionsColKey) ?? null;

  async function handleSaveColumnOptions(options: StatusOption[]) {
    if (!manageOptionsColumn) return;
    // All three option-based column types are shared, site-wide lists that
    // live on the workspace doc — never on the individual column.
    if (manageOptionsColumn.type === "responsible") {
      await updateResponsibleOptions(workspaceId, options);
    } else if (manageOptionsColumn.type === "status") {
      await updateStatusOptions(workspaceId, options);
    } else if (manageOptionsColumn.type === "custom" && manageOptionsColumn.customFieldId) {
      await updateCustomFieldOptions(workspaceId, customFields, manageOptionsColumn.customFieldId, options);
    }
    toast.success("Варианты обновлены");
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

  // Financial summary bar: shown when the page has at least one currency
  // column. "Общий" is the grand total across every row; "Сумма" is the same
  // total restricted to rows whose status column reads something like
  // "Готово". Recomputes instantly as rows/cells change (plain useMemo, no
  // extra Firestore round-trip).
  const financialSummary = useMemo(() => {
    const priceCol = columns.find((c) => c.type === "currency");
    if (!priceCol) return null;
    const statusCol = columns.find((c) => c.type === "status");
    let grandTotal = 0;
    let doneTotal = 0;
    for (const row of rows) {
      const raw = Number(row.cells[priceCol.key] ?? 0) || 0;
      grandTotal += raw;
      if (statusCol) {
        const rawStatus = String(row.cells[statusCol.key] ?? "");
        const label = sharedStatusOptions.find((o) => o.value === rawStatus)?.label ?? rawStatus;
        if (label.toLowerCase().includes("готов")) doneTotal += raw;
      }
    }
    return { priceCol, statusCol, grandTotal, doneTotal };
  }, [columns, rows, sharedStatusOptions]);

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom = virtualItems.length > 0 ? totalSize - virtualItems[virtualItems.length - 1].end : 0;

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
        editValue={editValue}
        canEdit={canEdit}
        canReorder={canReorderRows}
        isRowFullySelected={isRowFullySelected(row.id)}
        isChecked={selectedRowIds.has(row.id)}
        pinnedKeys={pinnedKeys}
        onToggleChecked={toggleRowChecked}
        onCellMouseDown={handleCellMouseDown}
        onCellMouseEnter={handleCellMouseEnter}
        onCellDoubleClick={(rowId, colKey) => startEditing(rowId, colKey)}
        onEditValueChange={setEditValue}
        onCommitEdit={handleCommitEdit}
        onCancelEdit={() => setEditingCell(null)}
        onStatusChange={handleStatusChange}
        onRowNumberMouseDown={(rowId) => handleRowNumberMouseDown(rowId)}
        onRowResizeStart={handleRowResizeStart}
        onContextMenuOpen={handleContextMenuOpen}
        onExpandRow={setExpandedRowId}
      />
    );
  }

  const pinnedOrder = displayColumns.filter((c) => pinnedKeys.includes(c.key));

  const isSaving = pendingWrites.hasSavingCell;

  return (
    <div className="flex h-full flex-col bg-background">
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
        selectedCount={selectedRowIds.size}
        onDeleteSelected={handleDeleteSelected}
        hasStatusColumn={Boolean(kanbanStatusColumn)}
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
        <div ref={containerRef} tabIndex={0} className="relative flex-1 overflow-auto bg-background outline-none">
          <table className="border-collapse" style={{ tableLayout: "fixed" }}>
            <thead className="sticky top-0 z-20">
              <tr>
                <th
                  className="sticky left-0 top-0 z-30 border-b border-r border-border bg-muted/80"
                  style={{ width: ROW_GUTTER_WIDTH, minWidth: ROW_GUTTER_WIDTH }}
                />
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
                      isPinned={pinnedKeys.includes(column.key)}
                      onTogglePin={togglePin}
                      stickyLeft={
                        pinnedKeys.includes(column.key)
                          ? ROW_GUTTER_WIDTH +
                            pinnedOrder.slice(0, pinnedOrder.findIndex((c) => c.key === column.key)).reduce((sum, c) => sum + c.width, 0)
                          : undefined
                      }
                      canReorder={canEdit}
                      canEditStructure={canEditStructure}
                      canManageOptions={isOwner}
                      onRename={handleRenameColumn}
                      onChangeType={handleChangeColumnType}
                      onManageOptions={setManageOptionsColKey}
                      onDuplicate={handleDuplicateColumn}
                      onDelete={handleDeleteColumn}
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
                      {virtualItems.map((virtualRow) => {
                        const row = paginatedRows[virtualRow.index];
                        if (!row) return null;
                        return renderRow(row, virtualRow.index);
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
                            eyebrow="Таблица"
                            title="Здесь пока пусто"
                            description="Добавьте первую строку, чтобы начать работу."
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
                            eyebrow="Поиск"
                            title="Ничего не найдено"
                            description="Попробуйте изменить запрос или сбросить фильтры."
                          />
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
                <ContextMenuSeparator />
                <ContextMenuItem onClick={handleDuplicateRow} disabled={!canEdit}>
                  Дублировать строку
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
      </DndContext>
      )}

      {financialSummary && (
        <div className="flex items-center gap-6 border-t border-border bg-muted/30 px-4 py-2.5 text-sm">
          <div>
            <span className="mr-2 text-xs text-muted-foreground">Общий:</span>
            <span className="font-semibold">{formatCurrency(financialSummary.grandTotal)}</span>
          </div>
          {financialSummary.statusCol && (
            <div className="border-l border-border pl-6">
              <span className="mr-2 text-xs text-emerald-500">Сумма (Готово):</span>
              <span className="font-semibold text-emerald-500">{formatCurrency(financialSummary.doneTotal)}</span>
            </div>
          )}
        </div>
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

      {manageOptionsColumn && (
        <ManageOptionsDialog
          open={Boolean(manageOptionsColKey)}
          onOpenChange={(o) => !o && setManageOptionsColKey(null)}
          title={`Варианты: «${manageOptionsColumn.label}»`}
          description={
            manageOptionsColumn.type === "responsible"
              ? "Общий список для всех столбцов «Ответственный» на сайте — изменения увидят все."
              : manageOptionsColumn.type === "custom"
                ? `Общий список для всех столбцов «${customFields.find((f) => f.id === manageOptionsColumn.customFieldId)?.name ?? manageOptionsColumn.label}» на сайте — изменения увидят все.`
                : "Общий список для всех столбцов «Статус» на сайте — изменения увидят все."
          }
          options={getColumnOptions(manageOptionsColumn, activeWorkspace)}
          onSave={handleSaveColumnOptions}
        />
      )}

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
    </div>
  );
}
