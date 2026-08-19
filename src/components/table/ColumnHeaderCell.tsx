import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, Filter, GripVertical, Pin, PinOff } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/utils/cn";
import type { ColumnType, PageColumn, SortState } from "@/types";

const COLUMN_TYPE_LABELS: Record<ColumnType, string> = {
  text: "Текст",
  number: "Число",
  currency: "Валюта",
  status: "Статус",
  responsible: "Ответственный",
  date: "Дата",
  email: "Email",
  phone: "Телефон",
};
const COLUMN_TYPES: ColumnType[] = ["text", "number", "currency", "status", "responsible", "date", "email", "phone"];

interface ColumnHeaderCellProps {
  column: PageColumn;
  sortState: SortState;
  onSort: (colKey: string) => void;
  onFilterClick: (colKey: string, e: React.MouseEvent) => void;
  hasActiveFilter: boolean;
  onResizeStart: (colKey: string, e: React.MouseEvent) => void;
  isPinned: boolean;
  onTogglePin: (colKey: string) => void;
  stickyLeft?: number;
  canReorder: boolean;
  canEditStructure?: boolean;
  onRename?: (colKey: string) => void;
  onChangeType?: (colKey: string, type: ColumnType) => void;
  onDuplicate?: (colKey: string) => void;
  onDelete?: (colKey: string) => void;
}

export function ColumnHeaderCell({
  column,
  sortState,
  onSort,
  onFilterClick,
  hasActiveFilter,
  onResizeStart,
  isPinned,
  onTogglePin,
  stickyLeft,
  canReorder,
  canEditStructure,
  onRename,
  onChangeType,
  onDuplicate,
  onDelete,
}: ColumnHeaderCellProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: column.id,
    disabled: !canReorder,
  });

  const isSorted = sortState.colKey === column.key;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <th
          ref={setNodeRef}
          style={{
            width: column.width,
            minWidth: column.width,
            left: stickyLeft,
            transform: CSS.Transform.toString(transform),
            transition,
            opacity: isDragging ? 0.6 : 1,
          }}
          className={cn(
            "group relative border-b border-r border-border bg-muted/60 px-1 text-left text-xs font-medium text-muted-foreground",
            stickyLeft !== undefined && "sticky z-20 bg-muted"
          )}
        >
          <div className="flex h-9 items-center gap-1">
            {canReorder && (
              <button
                {...attributes}
                {...listeners}
                className="cursor-grab touch-none rounded p-0.5 opacity-0 hover:bg-accent group-hover:opacity-100 active:cursor-grabbing"
                title="Перетащить столбец"
              >
                <GripVertical className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={() => onSort(column.key)}
              className="flex min-w-0 flex-1 items-center gap-1 truncate text-left hover:text-foreground"
            >
              <span className="truncate">{column.label}</span>
              {isSorted && sortState.direction === "asc" && <ArrowUp className="h-3 w-3 shrink-0" />}
              {isSorted && sortState.direction === "desc" && <ArrowDown className="h-3 w-3 shrink-0" />}
            </button>
            <button
              onClick={() => onTogglePin(column.key)}
              className={cn(
                "shrink-0 rounded p-0.5 opacity-0 hover:bg-accent group-hover:opacity-100",
                isPinned && "opacity-100 text-primary"
              )}
              title={isPinned ? "Открепить столбец" : "Закрепить столбец"}
            >
              {isPinned ? <Pin className="h-3 w-3" /> : <PinOff className="h-3 w-3" />}
            </button>
            <button
              onClick={(e) => onFilterClick(column.key, e)}
              className={cn(
                "shrink-0 rounded p-0.5 opacity-0 hover:bg-accent group-hover:opacity-100",
                hasActiveFilter && "opacity-100 text-primary"
              )}
              title="Фильтр"
            >
              <Filter className="h-3 w-3" />
            </button>
          </div>
          <div
            onMouseDown={(e) => {
              e.stopPropagation();
              onResizeStart(column.key, e);
            }}
            className="absolute -right-[1px] top-0 h-full w-[3px] cursor-col-resize opacity-0 hover:opacity-100 hover:bg-primary"
          />
        </th>
      </ContextMenuTrigger>
      {canEditStructure && (
        <ContextMenuContent>
          <ContextMenuItem onClick={() => onRename?.(column.key)}>Переименовать</ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>Изменить тип</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {COLUMN_TYPES.map((t) => (
                <ContextMenuItem key={t} onClick={() => onChangeType?.(column.key, t)}>
                  {COLUMN_TYPE_LABELS[t]}
                  {column.type === t && " ✓"}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuItem onClick={() => onDuplicate?.(column.key)}>Дублировать</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={() => onDelete?.(column.key)}
            className="text-destructive focus:text-destructive"
          >
            Удалить столбец
          </ContextMenuItem>
        </ContextMenuContent>
      )}
    </ContextMenu>
  );
}
