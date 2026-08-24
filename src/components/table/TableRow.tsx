import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { TableCell } from "@/components/table/TableCell";
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
  onCellDoubleClick: (rowId: string, colKey: string) => void;
  onEditValueChange: (value: string) => void;
  onCommitEdit: (direction?: "down" | "right" | "left" | "none") => void;
  onCancelEdit: () => void;
  onStatusChange: (rowId: string, colKey: string, value: string) => void;
  onRowNumberMouseDown: (rowId: string, e: React.MouseEvent) => void;
  onRowResizeStart: (rowId: string, e: React.MouseEvent) => void;
  onContextMenuOpen: (rowId: string) => void;
  onExpandRow: (rowId: string) => void;
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
  onCellDoubleClick,
  onEditValueChange,
  onCommitEdit,
  onCancelEdit,
  onStatusChange,
  onRowNumberMouseDown,
  onRowResizeStart,
  onContextMenuOpen,
  onExpandRow,
}: TableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
    disabled: !canReorder,
  });

  let cumulativeLeft = ROW_GUTTER_WIDTH;
  const pinnedOffsets = new Map<string, number>();
  columns
    .filter((c) => pinnedKeys.includes(c.key))
    .forEach((c) => {
      pinnedOffsets.set(c.key, cumulativeLeft);
      cumulativeLeft += c.width;
    });

  // A quiet "new" marker — no extra reads needed, createdAt is already on
  // every row. Just a thin accent bar, not a badge, so it doesn't compete
  // with the actual data for attention.
  const isNew = Date.now() - row.createdAt < 24 * 60 * 60 * 1000;

  return (
    <tr
      ref={setNodeRef}
      style={{ height: rowHeight, transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="group/row transition-colors duration-200 hover:bg-muted/35"
      onContextMenu={() => onContextMenuOpen(row.id)}
    >
      <td
        onMouseDown={(e) => onRowNumberMouseDown(row.id, e)}
        onDoubleClick={() => onExpandRow(row.id)}
        title="Двойной клик — открыть строку карточкой"
        className={cn(
          "sticky left-0 z-20 select-none border-b border-r border-border/50 bg-background text-center font-mono text-[11px] tabular text-muted-foreground",
          isRowFullySelected && "bg-primary/10 font-medium text-primary"
        )}
        style={{ width: ROW_GUTTER_WIDTH, minWidth: ROW_GUTTER_WIDTH }}
      >
        <div className="relative flex h-full w-full items-center justify-center gap-1">
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
            className={cn("absolute", !isChecked && "hidden group-hover/row:flex")}
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
            onDoubleClick={() => onCellDoubleClick(row.id, column.key)}
            onEditValueChange={onEditValueChange}
            onCommitEdit={onCommitEdit}
            onCancelEdit={onCancelEdit}
            onStatusChange={(v) => onStatusChange(row.id, column.key, v)}
            stickyLeft={stickyLeft}
          />
        );
      })}
    </tr>
  );
}

export { ROW_GUTTER_WIDTH };
