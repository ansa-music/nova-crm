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
  renameSubPageColumn,
  changeSubPageColumnType,
  duplicateSubPageColumn,
  deleteSubPageColumn,
} from "@/services/subPageService";
import { AddColumnDialog } from "@/components/table/AddColumnDialog";
import { RowCommentsPanel } from "@/components/chat/RowCommentsPanel";
import { formatCurrency, downloadCsv } from "@/utils";
import type { CellAddress, ColumnType, PageRow, SortState, WorkspacePage } from "@/types";

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

type Command = { undo: () => void | Promise<void>; redo: () => void | Promise<void> };

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
  const renameColumnService = subPageId
    ? (wsId: string, pId: string, cols: typeof page.columns, colKey: string, newLabel: string) =>
        renameSubPageColumn(wsId, pId, subPageId, cols, colKey, newLabel)
    : renameColumnServiceBase;
  const changeColumnTypeService = subPageId
    ? (wsId: string, pId: string, cols: typeof page.columns, colKey: string, type: ColumnType, statusOptions?: typeof columns[number]["statusOptions"]) =>
        changeSubPageColumnType(wsId, pId, subPageId, cols, colKey, type, statusOptions)
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
  const [editValue, setEditValue] = useState("");
  const [sortState, setSortState] = useState<SortState>({ colKey: null, direction: null });
  const [filters, setFilters] = useState<Record<string, Set<string>>>({});
  const [filterPopover, setFilterPopover] = useState<{ colKey: string; x: number; y: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [groupByKey, setGroupByKey] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [density, setDensity] = useState<"compact" | "default" | "comfortable">("default");
  const [addColumnOpen, setAddColumnOpen] = useState(false);
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
  const [pageSize, setPageSize] = useState(25);
  const [resizePreview, setResizePreview] = useState<
    | { type: "col"; colKey: string; width: number }
    | { type: "row"; rowId: string; height: number }
    | null
  >(null);

  // Columns with the live drag preview overlaid, used only for rendering —
  // selection math and all other logic always use the stable `columns` array.
  const displayColumns = useMemo(() => {
    if (resizePreview?.type !== "col") return columns;
    return columns.map((c) => (c.key === resizePreview.colKey ? { ...c, width: resizePreview.width } : c));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, resizePreview]);

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
  const undoStack = useRef<Command[]>([]);
  const redoStack = useRef<Command[]>([]);

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
    const col = columns.find((c) => c.key === groupByKey);
    const map = new Map<string, PageRow[]>();
    processedRows.forEach((row) => {
      const raw = String(row.cells[groupByKey] ?? "");
      const label =
        col?.type === "status" ? col.statusOptions?.find((o) => o.value === raw)?.label ?? raw : raw;
      const key = label || "__empty__";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    });
    return { col, entries: Array.from(map.entries()) };
  }, [groupByKey, processedRows, columns]);

  // ---- Pagination (disabled while grouped) ----
  const paginatedRows = useMemo(() => {
    if (groups) return processedRows;
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

  // ---- Undo/redo command stack ----
  function pushCommand(cmd: Command) {
    undoStack.current.push(cmd);
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
  }

  async function undo() {
    const cmd = undoStack.current.pop();
    if (!cmd) return;
    await cmd.undo();
    redoStack.current.push(cmd);
  }

  async function redo() {
    const cmd = redoStack.current.pop();
    if (!cmd) return;
    await cmd.redo();
    undoStack.current.push(cmd);
  }

  // ---- Editing ----
  const startEditing = useCallback(
    (rowId: string, colKey: string, initialValue?: string) => {
      if (!canEdit) return;
      const col = columns.find((c) => c.key === colKey);
      if (!col || col.type === "status") return;
      const row = rows.find((r) => r.id === rowId);
      if (!row) return;
      setEditingCell({ rowId, colKey });
      setEditValue(initialValue !== undefined ? initialValue : String(row.cells[colKey] ?? ""));
    },
    [canEdit, columns, rows]
  );

  async function persistCellEdit(rowId: string, colKey: string, oldValue: string, newValue: string) {
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
        if (col && col.type !== "status") {
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
      if (col && col.type !== "status") {
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
        const col = columns[c];
        if (!rowData) {
          line.push("");
          continue;
        }
        const raw = String(rowData.cells[col.key] ?? "");
        if (col.type === "status") {
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

  function applyMatrixPaste(matrix: string[][]) {
    if (!canEdit || !activeCell || matrix.length === 0) return;
    const startRowIdx = rowIds.indexOf(activeCell.rowId);
    const startColIdx = columns.findIndex((c) => c.key === activeCell.colKey);
    if (startRowIdx === -1) return;
    matrix.forEach((line, ri) => {
      const rowId = rowIds[startRowIdx + ri];
      if (!rowId) return;
      const row = rows.find((r) => r.id === rowId);
      if (!row) return;
      line.forEach((val, ci) => {
        const col = columns[startColIdx + ci];
        if (!col) return;
        const oldValue = String(row.cells[col.key] ?? "");
        let newValue = val;
        if (col.type === "status") {
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
      applyMatrixPaste(clipboardRef.current.matrix);
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      const lines = text.replace(/\r/g, "").split("\n");
      if (lines[lines.length - 1] === "") lines.pop();
      applyMatrixPaste(lines.map((l) => l.split("\t")));
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

  // The handler closes over lots of per-render state (activeCell, columns,
  // filters, etc). Rather than re-attaching a window listener on every
  // render, we keep the DOM listener mounted once and always dispatch
  // through a ref pointing at the latest closure.
  const handleKeyDownRef = useRef<(e: KeyboardEvent) => void>(() => {});
  handleKeyDownRef.current = function handleKeyDown(e: KeyboardEvent) {
      if (editingCellRef.current) return;
      if (containerRef.current && !containerRef.current.contains(document.activeElement)) {
        if (document.activeElement !== document.body) return;
      }
      if (!activeCell) return;
      const isCtrl = e.ctrlKey || e.metaKey;

      if (isCtrl && e.key.toLowerCase() === "c") {
        e.preventDefault();
        handleCopy();
        return;
      }
      if (isCtrl && e.key.toLowerCase() === "v") {
        e.preventDefault();
        handlePaste();
        return;
      }
      if (isCtrl && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
        return;
      }
      if (isCtrl && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
        e.preventDefault();
        redo();
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
        moveSelection(e.shiftKey ? "left" : "right", false);
        return;
      }
      if (!isCtrl && !e.altKey && e.key.length === 1) {
        const col = columns.find((c) => c.key === activeCell.colKey);
        if (col && col.type !== "status") startEditing(activeCell.rowId, activeCell.colKey, e.key);
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
    pushCommand({
      undo: () => deleteRowService(workspaceId, page.id, newRow.id),
      redo: () => {
        addRowService(workspaceId, page.id, cells, rows.length);
      },
    });
    requestAnimationFrame(() => {
      setActiveCell({ rowId: newRow.id, colKey: columns[0].key });
      setRangeAnchor({ rowId: newRow.id, colKey: columns[0].key });
      setEditingCell({ rowId: newRow.id, colKey: columns[0].key });
      setEditValue("");
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
    await deleteRowService(workspaceId, page.id, rowId);
    pushCommand({
      undo: () => {
        addRowService(workspaceId, page.id, row.cells, row.order);
      },
      redo: () => deleteRowService(workspaceId, page.id, rowId),
    });
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
    await Promise.all(Array.from(selectedRowIds).map((id) => deleteRowService(workspaceId, page.id, id)));
    setSelectedRowIds(new Set());
    toast.success("Строки удалены");
  }

  function handleExportCsv() {
    const header = columns.map((c) => c.label);
    const lines = processedRows.map((row) =>
      columns.map((c) => {
        const raw = String(row.cells[c.key] ?? "");
        if (c.type === "status") return c.statusOptions?.find((o) => o.value === raw)?.label ?? "";
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

  async function handleChangeColumnType(colKey: string, type: ColumnType) {
    const current = columns.find((c) => c.key === colKey);
    if (!current || current.type === type) return;
    await changeColumnTypeService(workspaceId, page.id, columns, colKey, type, current.statusOptions);
    toast.success("Тип столбца изменён");
  }

  async function handleDuplicateColumn(colKey: string) {
    const copy = await duplicateColumnService(workspaceId, page.id, columns, colKey);
    toast.success(`Столбец «${copy.label}» создан`);
  }

  async function handleDeleteColumn(colKey: string) {
    const current = columns.find((c) => c.key === colKey);
    if (!current) return;
    if (!window.confirm(`Удалить столбец «${current.label}»? Данные в нём будут скрыты.`)) return;
    await deleteColumnService(workspaceId, page.id, columns, colKey);
    toast.success("Столбец удалён");
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
        const label = statusCol.statusOptions?.find((o) => o.value === rawStatus)?.label ?? rawStatus;
        if (label.toLowerCase().includes("готов")) doneTotal += raw;
      }
    }
    return { priceCol, statusCol, grandTotal, doneTotal };
  }, [columns, rows]);

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom = virtualItems.length > 0 ? totalSize - virtualItems[virtualItems.length - 1].end : 0;

  function renderRow(row: PageRow, index: number) {
    const effectiveRowHeight =
      resizePreview?.type === "row" && resizePreview.rowId === row.id
        ? resizePreview.height
        : row.height ?? rowHeight;
    return (
      <TableRow
        key={row.id}
        row={row}
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
      />
    );
  }

  const pinnedOrder = displayColumns.filter((c) => pinnedKeys.includes(c.key));

  return (
    <div className="flex h-full flex-col">
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
        onDensityChange={setDensity}
        onAddRow={handleAddRow}
        onExportCsv={handleExportCsv}
        canEdit={canEdit}
        canEditStructure={canEditStructure}
        onAddColumn={() => setAddColumnOpen(true)}
        selectedCount={selectedRowIds.size}
        onDeleteSelected={handleDeleteSelected}
      />

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div ref={containerRef} tabIndex={0} className="relative flex-1 overflow-auto outline-none">
          <table className="border-collapse" style={{ tableLayout: "fixed" }}>
            <thead className="sticky top-0 z-20">
              <tr>
                <th
                  className="sticky left-0 top-0 z-30 border-b border-r border-border bg-muted"
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
                      onRename={handleRenameColumn}
                      onChangeType={handleChangeColumnType}
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
                      <td colSpan={columns.length + 1} className="py-16 text-center text-sm text-muted-foreground">
                        Нет данных для отображения
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
                    const col = columns.find((c) => c.key === filterPopover.colKey);
                    const raw = String(r.cells[filterPopover.colKey] ?? "");
                    return col?.type === "status" ? col.statusOptions?.find((o) => o.value === raw)?.label ?? raw : raw;
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

      {financialSummary && (
        <div className="flex items-center gap-6 border-t border-border bg-muted/30 px-4 py-2 text-sm">
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

      {!groups && (
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
      />

      <RowCommentsPanel
        open={Boolean(commentRowId)}
        onOpenChange={(o) => !o && setCommentRowId(null)}
        workspaceId={workspaceId}
        pageId={page.id}
        rowId={commentRowId}
      />
    </div>
  );
}
