import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { motion } from "framer-motion";
import { memo } from "react";
import { Copy, GripVertical, MoreHorizontal, Trash2 } from "lucide-react";
import { TableCell } from "@/components/table/TableCell";
import { rowCardLayoutId } from "@/components/table/RowCardSheet";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/utils/cn";
import type { CellAddress, PageColumn, PageRow } from "@/types";

const ROW_GUTTER_WIDTH = 56;

interface TableRowProps {
  row: PageRow;
  rowNumber: number;
  columns: PageColumn[];
  rowHeight: number;
  activeCell: CellAddress | null;
  rangeCells: Set<string>;
  editingCell: CellAddress | null;
  editValue: string;
  canEdit: boolean;
  canReorder: boolean;
  isRowFullySelected: boolean;
  isChecked: boolean;
  pinnedKeys: string[];
  onToggleChecked: (rowId: string, shiftKey?: boolean) => void;
  onCellMouseDown: (rowId: string, colKey: string, e: React.MouseEvent) => void;
  onCellMouseEnter: (rowId: string, colKey: string) => void;
  onCellStartEdit: (rowId: string, colKey: string) => void;
  onEditValueChange: (value: string) => void;
  onCommitEdit: (direction?: "down" | "right" | "left" | "none") => void;
  onCancelEdit: () => void;
  onStatusChange: (rowId: string, colKey: string, value: string) => void;
  onRowNumberMouseDown: (rowId: string, e: React.MouseEvent) => void;
  onRowResizeStart: (rowId: string, e: React.MouseEvent) => void;
  onContextMenuOpen: (rowId: string) => void;
  onExpandRow: (rowId: string) => void;
  onDuplicateRow?: (rowId: string) => void;
  onDeleteRow?: (rowId: string) => void;
  onCopyDiskUrl?: (rowId: string) => void;
  diskUrl?: string | null;
  onUndoLast?: () => void;
  isExpanded?: boolean;
  coarsePointer?: boolean;
  statusTint?: string;
  onMarkDone?: (rowId: string) => void;
  onInsertRowAbove?: (rowId: string) => void;
  onInsertRowBelow?: (rowId: string) => void;
  onCopyRow?: (rowId: string) => void;
  expandedColKey?: string | null;
  gutterWidth?: number;
}

function TableRowInner({
  row,
  rowNumber,
  columns,
  rowHeight,
  activeCell,
  rangeCells,
  editingCell,
  editValue,
  canEdit,
  canReorder,
  isRowFullySelected,
  isChecked,
  pinnedKeys,
  onToggleChecked,
  onCellMouseDown,
  onCellMouseEnter,
  onCellStartEdit,
  onEditValueChange,
  onCommitEdit,
  onCancelEdit,
  onStatusChange,
  onRowNumberMouseDown,
  onRowResizeStart,
  onContextMenuOpen,
  onExpandRow,
  onDuplicateRow,
  onDeleteRow,
  onCopyDiskUrl,
  diskUrl,
  onUndoLast,
  isExpanded,
  coarsePointer,
  statusTint,
  onMarkDone,
  onInsertRowAbove,
  onInsertRowBelow,
  onCopyRow,
  expandedColKey,
  gutterWidth = ROW_GUTTER_WIDTH,
}: TableRowProps) {
  const allowRowDrag = canReorder && !coarsePointer;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
    disabled: !allowRowDrag,
  });

  const pinnedCols = columns.filter((c) => pinnedKeys.includes(c.key));
  let cumulativeLeft = gutterWidth;
  const pinnedOffsets = new Map<string, number>();
  pinnedCols.forEach((c) => {
    pinnedOffsets.set(c.key, cumulativeLeft);
    cumulativeLeft += c.width;
  });
  const lastStickyKey = pinnedCols.length ? pinnedCols[pinnedCols.length - 1].key : null;

  const isNew = Date.now() - row.createdAt < 24 * 60 * 60 * 1000;

  const rowMenu = (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground",
                  coarsePointer ? "inline-flex" : "hidden group-hover/row:inline-flex"
                )}
                title="Действия со строкой"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="z-[320]">
              <DropdownMenuItem onClick={() => onInsertRowAbove?.(row.id)} disabled={!canEdit}>
                Вставить строку выше
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onInsertRowBelow?.(row.id)} disabled={!canEdit}>
                Вставить строку ниже
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onCopyRow?.(row.id)}>
                Копировать строку
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDuplicateRow?.(row.id)} disabled={!canEdit}>
                Дублировать
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onCopyDiskUrl?.(row.id)} disabled={!diskUrl}>
                <Copy className="h-3.5 w-3.5" /> Копировать ссылку Диск
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onDeleteRow?.(row.id)}
                disabled={!canEdit}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" /> Удалить
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
  );

  return (
    <tr
      ref={setNodeRef}
      style={{
        height: rowHeight,
        transform: isDragging ? CSS.Transform.toString(transform) : undefined,
        transition: isDragging ? transition : undefined,
        opacity: isDragging ? 0.5 : 1,
        backgroundColor: statusTint ? `hsl(${statusTint} / 0.08)` : undefined,
      }}
      data-row-id={row.id}
      className={cn(
        "group/row table-data-row relative",
        (isRowFullySelected || isChecked) && "table-data-row-selected",
        activeCell?.rowId === row.id && "table-data-row-active"
      )}
      onContextMenu={() => onContextMenuOpen(row.id)}
    >
      <td
        onMouseDown={(e) => onRowNumberMouseDown(row.id, e)}
        onDoubleClick={() => onExpandRow(row.id)}
        title="Двойной клик — открыть строку карточкой"
        className={cn(
          "table-sticky-col sticky left-0 z-[22] overflow-hidden select-none border-b border-r border-border/40 bg-background text-center font-mono text-[11px] tabular text-muted-foreground",
          !lastStickyKey && "table-sticky-edge",
          isRowFullySelected && "bg-primary/10 font-medium text-primary"
        )}
        style={{ width: gutterWidth, minWidth: gutterWidth }}
      >
        <div className="relative flex h-full w-full items-center justify-center gap-0.5 px-0.5">
          {!isExpanded && (
            <motion.div
              layoutId={rowCardLayoutId(row.id)}
              className="pointer-events-none absolute inset-0 rounded-md"
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
            />
          )}
          {isNew && (
            <span
              className="absolute left-0 top-1/2 h-3.5 w-[3px] -translate-y-1/2 rounded-full bg-primary"
              title="Добавлено недавно"
            />
          )}
          {allowRowDrag && (
          <button
            {...attributes}
            {...listeners}
            className="hidden cursor-grab touch-none text-muted-foreground group-hover/row:block active:cursor-grabbing"
            title="Перетащить строку"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
          )}
          <Checkbox
            checked={isChecked}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleChecked(row.id, e.shiftKey);
            }}
            className={cn("h-4 w-4 max-md:h-5 max-md:w-5", coarsePointer && !isChecked && "hidden", !isChecked && !coarsePointer && "opacity-0 group-hover/row:opacity-100")}
          />
          <span className="flex min-w-[1.1rem] items-center justify-center text-[11px]">{rowNumber}</span>
          {rowMenu}
          <div
            onMouseDown={(e) => {
              e.stopPropagation();
              onRowResizeStart(row.id, e);
            }}
            className="absolute -bottom-[1px] left-0 h-[3px] w-full cursor-row-resize opacity-0 hover:opacity-100 hover:bg-primary"
          />
        </div>
      </td>
      {columns.map((column) => {
        const isActive = activeCell?.rowId === row.id && activeCell?.colKey === column.key;
        const isEditing = editingCell?.rowId === row.id && editingCell?.colKey === column.key;
        const isInRange = rangeCells.has(`${row.id}:${column.key}`);
        const stickyLeft = pinnedOffsets.get(column.key);
        return (
          <TableCell
            key={column.id}
            column={column}
            value={row.cells[column.key] ?? ""}
            isActive={isActive}
            isInRange={isInRange || isActive}
            isEditing={isEditing}
            editValue={editValue}
            canEdit={canEdit}
            onMouseDown={(e) => onCellMouseDown(row.id, column.key, e)}
            onMouseEnter={() => onCellMouseEnter(row.id, column.key)}
            onStartEdit={() => onCellStartEdit(row.id, column.key)}
            onEditValueChange={onEditValueChange}
            onCommitEdit={onCommitEdit}
            onCancelEdit={onCancelEdit}
            onUndoLast={onUndoLast}
            onStatusChange={(v) => onStatusChange(row.id, column.key, v)}
            onMarkDone={column.type === "status" ? () => onMarkDone?.(row.id) : undefined}
            stickyLeft={stickyLeft}
            isLastSticky={column.key === lastStickyKey}
            isExpanded={expandedColKey === column.key}
          />
        );
      })}
    </tr>
  );
}

function addrOnRow(addr: CellAddress | null, rowId: string) {
  return addr?.rowId === rowId;
}

function tableRowEqual(prev: TableRowProps, next: TableRowProps) {
  if (prev.row.id !== next.row.id) return false;
  if (prev.row.updatedAt !== next.row.updatedAt || prev.row.cells !== next.row.cells) {
    const keys = new Set([...Object.keys(prev.row.cells), ...Object.keys(next.row.cells)]);
    for (const key of keys) {
      if (prev.row.cells[key] !== next.row.cells[key]) return false;
    }
  }
  if (
    prev.rowNumber !== next.rowNumber ||
    prev.columns !== next.columns ||
    prev.rowHeight !== next.rowHeight ||
    prev.canEdit !== next.canEdit ||
    prev.canReorder !== next.canReorder ||
    prev.isRowFullySelected !== next.isRowFullySelected ||
    prev.isChecked !== next.isChecked ||
    prev.pinnedKeys !== next.pinnedKeys ||
    prev.diskUrl !== next.diskUrl ||
    prev.isExpanded !== next.isExpanded ||
    prev.coarsePointer !== next.coarsePointer ||
    prev.statusTint !== next.statusTint ||
    prev.expandedColKey !== next.expandedColKey ||
    prev.gutterWidth !== next.gutterWidth
  ) {
    return false;
  }
  const prevActive = addrOnRow(prev.activeCell, prev.row.id);
  const nextActive = addrOnRow(next.activeCell, next.row.id);
  if (prevActive !== nextActive) return false;
  if (nextActive && (prev.activeCell?.colKey !== next.activeCell?.colKey)) return false;
  const prevEditing = addrOnRow(prev.editingCell, prev.row.id);
  const nextEditing = addrOnRow(next.editingCell, next.row.id);
  if (prevEditing !== nextEditing) return false;
  if (nextEditing && (prev.editingCell?.colKey !== next.editingCell?.colKey || prev.editValue !== next.editValue)) {
    return false;
  }
  for (const col of next.columns) {
    const id = `${next.row.id}:${col.key}`;
    if (prev.rangeCells.has(id) !== next.rangeCells.has(id)) return false;
  }
  return true;
}

export const TableRow = memo(TableRowInner, tableRowEqual);

export { ROW_GUTTER_WIDTH };
