import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { motion } from "framer-motion";
import { GripVertical } from "lucide-react";
import { TableCell } from "@/components/table/TableCell";
import { rowCardLayoutId } from "@/components/table/RowCardSheet";
import { Checkbox } from "@/components/ui/checkbox";
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
  onToggleChecked: (rowId: string) => void;
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
  isExpanded?: boolean;
}

export function TableRow({
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
  isExpanded,
}: TableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
    disabled: !canReorder,
  });

  const pinnedCols = columns.filter((c) => pinnedKeys.includes(c.key));
  let cumulativeLeft = ROW_GUTTER_WIDTH;
  const pinnedOffsets = new Map<string, number>();
  pinnedCols.forEach((c) => {
    pinnedOffsets.set(c.key, cumulativeLeft);
    cumulativeLeft += c.width;
  });
  const lastStickyKey = pinnedCols.length ? pinnedCols[pinnedCols.length - 1].key : null;

  const isNew = Date.now() - row.createdAt < 24 * 60 * 60 * 1000;

  return (
    <tr
      ref={setNodeRef}
      style={{
        height: rowHeight,
        transform: isDragging ? CSS.Transform.toString(transform) : undefined,
        transition: isDragging ? transition : undefined,
        opacity: isDragging ? 0.5 : 1,
      }}
      className={cn(
        "group/row table-data-row",
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
          "table-sticky-col sticky left-0 z-20 select-none border-b border-r border-border/40 bg-background text-center font-mono text-[11px] tabular text-muted-foreground",
          !lastStickyKey && "table-sticky-edge",
          isRowFullySelected && "bg-primary/10 font-medium text-primary"
        )}
        style={{ width: ROW_GUTTER_WIDTH, minWidth: ROW_GUTTER_WIDTH }}
      >
        <div className="relative flex h-full w-full items-center justify-center gap-1">
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
          <button
            {...attributes}
            {...listeners}
            className="hidden cursor-grab touch-none text-muted-foreground group-hover/row:block active:cursor-grabbing"
            title="Перетащить строку"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
          <span className="flex h-4 w-4 items-center justify-center group-hover/row:hidden">
            {isChecked ? null : rowNumber}
          </span>
          <Checkbox
            checked={isChecked}
            onCheckedChange={() => onToggleChecked(row.id)}
            onClick={(e) => e.stopPropagation()}
            className={cn("absolute h-4 w-4 max-md:h-5 max-md:w-5", !isChecked && "hidden group-hover/row:flex")}
          />
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
            onStatusChange={(v) => onStatusChange(row.id, column.key, v)}
            stickyLeft={stickyLeft}
            isLastSticky={column.key === lastStickyKey}
          />
        );
      })}
    </tr>
  );
}

export { ROW_GUTTER_WIDTH };
