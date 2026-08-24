import type { MouseEvent, PointerEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, Eye, EyeOff, Filter, GripVertical, MoreHorizontal, Palette, Pin, PinOff, Plus } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/utils/cn";
import { useWorkspace } from "@/hooks/useWorkspace";
import { usePermissions } from "@/hooks/usePermissions";
import { addCustomField } from "@/services/workspaceService";
import { toast } from "@/components/ui/sonner";
import { buildColumnTypeChoices, isOptionColumn } from "@/utils/columnOptions";
import type { ColumnType, PageColumn, SortState } from "@/types";

interface ColumnHeaderCellProps {
  column: PageColumn;
  sortState: SortState;
  onSort: (colKey: string) => void;
  onFilterClick: (colKey: string, e: MouseEvent) => void;
  hasActiveFilter: boolean;
  onResizeStart: (colKey: string, e: PointerEvent) => void;
  onAutoSize?: (colKey: string) => void;
  isPinned: boolean;
  onTogglePin: (colKey: string) => void;
  stickyLeft?: number;
  isLastSticky?: boolean;
  canReorder: boolean;
  canEditStructure?: boolean;
  /** Owner-only: shows "Изменить варианты" for status/responsible/custom columns. */
  canManageOptions?: boolean;
  onRename?: (colKey: string) => void;
  onChangeType?: (colKey: string, type: ColumnType, customFieldId?: string) => void;
  onManageOptions?: (colKey: string) => void;
  onDuplicate?: (colKey: string) => void;
  onDelete?: (colKey: string) => void;
  onToggleHidden?: (colKey: string) => void;
  onSelectColumn?: (colKey: string, extend: boolean) => void;
  isColumnSelected?: boolean;
  /** Phone: one ⋯ menu, no drag handle, no second ellipsis in the label. */
  compactChrome?: boolean;
}

export function ColumnHeaderCell({
  column,
  sortState,
  onSort,
  onFilterClick,
  hasActiveFilter,
  onResizeStart,
  onAutoSize,
  isPinned,
  onTogglePin,
  stickyLeft,
  isLastSticky,
  canReorder,
  canEditStructure,
  canManageOptions,
  onRename,
  onChangeType,
  onManageOptions,
  onDuplicate,
  onDelete,
  onToggleHidden,
  onSelectColumn,
  isColumnSelected,
  compactChrome,
}: ColumnHeaderCellProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: column.id,
    disabled: !canReorder,
  });

  const { activeWorkspace } = useWorkspace();
  const permissions = usePermissions();
  const canEditThisOptions =
    Boolean(canManageOptions) && isOptionColumn(column.type) && permissions.canManageStatusVariants;
  const pinLabel = isPinned ? "Открепить столбец" : "Закрепить столбец";
  const customFields = activeWorkspace?.customFields ?? [];
  const typeChoices = buildColumnTypeChoices(customFields);

  async function handleCreateCustomField() {
    const name = window.prompt("Название нового кастомного поля (например, «Приоритет»):")?.trim();
    if (!name || !activeWorkspace) return;
    try {
      const id = await addCustomField(activeWorkspace.id, customFields, name);
      onChangeType?.(column.key, "custom", id);
      toast.success(`Поле «${name}» создано`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось создать поле");
    }
  }

  const isSorted = sortState.colKey === column.key;
  const hasLabel = Boolean(column.label?.trim());
  const showColumnMenu = Boolean(canEditStructure) && hasLabel && !compactChrome;
  const pinInMenu = false;
  const filterInMenu = false;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <th
          ref={setNodeRef}
          style={{
            width: column.width,
            minWidth: column.width,
            top: 0,
            left: stickyLeft,
            transform: isDragging ? CSS.Transform.toString(transform) : undefined,
            transition: isDragging ? transition : undefined,
            opacity: isDragging ? 0.6 : 1,
          }}
          className={cn(
            "group sticky top-0 z-[21] border-b border-r border-border/50 bg-background px-1 text-left font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground",
            stickyLeft !== undefined && "table-sticky-col z-[31] bg-background",
            isLastSticky && "table-sticky-edge",
            isColumnSelected && "bg-primary/10"
          )}
        >
          <div className="flex h-11 min-w-0 items-center gap-0.5 overflow-hidden sm:h-9">
            {canReorder && !compactChrome && (
              <button
                {...attributes}
                {...listeners}
                className="cursor-grab touch-none select-none rounded p-1.5 opacity-0 hover:bg-accent group-hover:opacity-100 active:translate-y-px active:scale-[0.97] active:cursor-grabbing motion-reduce:active:translate-y-0 motion-reduce:active:scale-100 sm:p-0.5"
                title="Перетащить столбец"
              >
                <GripVertical className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey) {
                  e.preventDefault();
                  onSelectColumn?.(column.key, e.shiftKey);
                  return;
                }
                onSort(column.key);
              }}
              onMouseDown={(e) => {
                if (e.ctrlKey || e.metaKey) e.preventDefault();
              }}
              className="flex min-h-11 min-w-0 flex-1 items-center gap-1 overflow-hidden py-1.5 text-left hover:text-foreground active:translate-y-px active:scale-[0.99] motion-reduce:active:translate-y-0 motion-reduce:active:scale-100 sm:min-h-0 sm:py-0"
            >
              <span className={cn("min-w-0 flex-1 overflow-hidden whitespace-nowrap", !showColumnMenu && "truncate")}>{column.label}</span>
              {isSorted && sortState.direction === "desc" ? (
                <ArrowDown className="h-3.5 w-3.5 shrink-0 text-foreground" />
              ) : (
                <ArrowUp
                  className={cn(
                    "h-3.5 w-3.5 shrink-0",
                    isSorted ? "text-foreground" : "text-muted-foreground/55"
                  )}
                />
              )}
            </button>
            {hasLabel && (
            <button
              type="button"
              onClick={() => onTogglePin(column.key)}
              className={cn(
                "inline-flex shrink-0 items-center justify-center rounded select-none hover:bg-accent active:translate-y-px active:scale-[0.97] motion-reduce:active:translate-y-0 motion-reduce:active:scale-100",
                compactChrome ? "h-7 w-7" : "min-h-10 min-w-10 p-1.5 opacity-0 group-hover:opacity-100 sm:min-h-0 sm:min-w-0 sm:p-0.5",
                isPinned && "opacity-100 text-primary"
              )}
              title={isPinned ? "Открепить столбец" : "Закрепить столбец"}
            >
              {isPinned ? <Pin className="h-3 w-3" /> : <PinOff className="h-3 w-3" />}
            </button>
            )}
            {showColumnMenu && (
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground sm:min-h-0 sm:min-w-0 sm:p-0.5 sm:opacity-0 sm:group-hover:opacity-100"
                    title="Настройки столбца"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="z-[80]">
                  <DropdownMenuItem onClick={() => onTogglePin(column.key)}>{pinLabel}</DropdownMenuItem>
                  {filterInMenu && (
                    <DropdownMenuItem onClick={(e) => onFilterClick(column.key, e as unknown as MouseEvent)}>
                      Фильтр
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onRename?.(column.key)}>Переименовать</DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>Изменить тип</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {typeChoices.map((choice) => {
                        const isCurrent =
                          column.type === choice.type &&
                          (choice.type !== "custom" || column.customFieldId === choice.customFieldId);
                        return (
                          <DropdownMenuItem
                            key={choice.value}
                            onClick={() => onChangeType?.(column.key, choice.type, choice.customFieldId)}
                          >
                            {choice.label}
                            {isCurrent && " ✓"}
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  {canEditThisOptions && (
                    <DropdownMenuItem onClick={() => onManageOptions?.(column.key)}>
                      <Palette className="h-4 w-4" /> Изменить варианты
                    </DropdownMenuItem>
                  )}
                  {onToggleHidden && (
                    <DropdownMenuItem onClick={() => onToggleHidden(column.key)}>
                      {column.hidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                      {column.hidden ? "Показать столбец" : "Скрыть столбец"}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => onDuplicate?.(column.key)}>Дублировать</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => onDelete?.(column.key)}
                    className="text-destructive focus:text-destructive"
                  >
                    Удалить столбец
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {!compactChrome && hasLabel && (
            <button
              type="button"
              onClick={(e) => onFilterClick(column.key, e)}
              className={cn(
                "inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded p-1.5 select-none opacity-0 hover:bg-accent group-hover:opacity-100 active:translate-y-px active:scale-[0.97] motion-reduce:active:translate-y-0 motion-reduce:active:scale-100 sm:min-h-0 sm:min-w-0 sm:p-0.5",
                hasActiveFilter && "opacity-100 text-primary"
              )}
              title="Фильтр"
            >
              <Filter className="h-3 w-3" />
            </button>
            )}
          </div>
          <div
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              e.stopPropagation();
              onResizeStart(column.key, e);
            }}
            onDoubleClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onAutoSize?.(column.key);
            }}
            className="absolute -right-1.5 top-0 z-10 h-full w-4 cursor-col-resize touch-none sm:w-2.5"
            title="Ширина столбца — двойной клик подогнать"
          >
            <span className="absolute right-[3px] top-1.5 h-[calc(100%-12px)] w-px bg-border opacity-0 group-hover:opacity-100 hover:bg-primary" />
          </div>
        </th>
      </ContextMenuTrigger>
      <ContextMenuContent>
          <ContextMenuItem onClick={() => onSelectColumn?.(column.key, false)}>Выделить столбец</ContextMenuItem>
          <ContextMenuItem onClick={() => onTogglePin(column.key)}>{pinLabel}</ContextMenuItem>
          {canEditStructure && (
            <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => onRename?.(column.key)}>Переименовать</ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>Изменить тип</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {typeChoices.map((choice) => {
                const isCurrent =
                  column.type === choice.type &&
                  (choice.type !== "custom" || column.customFieldId === choice.customFieldId);
                return (
                  <ContextMenuItem
                    key={choice.value}
                    onClick={() => onChangeType?.(column.key, choice.type, choice.customFieldId)}
                  >
                    {choice.label}
                    {isCurrent && " ✓"}
                  </ContextMenuItem>
                );
              })}
              <ContextMenuSeparator />
              <ContextMenuItem onClick={handleCreateCustomField}>
                <Plus className="h-3.5 w-3.5" /> Новое кастомное поле…
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
          {canEditThisOptions && (
            <ContextMenuItem onClick={() => onManageOptions?.(column.key)}>
              <Palette className="h-4 w-4" /> Изменить варианты
            </ContextMenuItem>
          )}
          {onToggleHidden && (
            <ContextMenuItem onClick={() => onToggleHidden(column.key)}>
              {column.hidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              {column.hidden ? "Показать столбец" : "Скрыть столбец"}
            </ContextMenuItem>
          )}
          <ContextMenuItem onClick={() => onDuplicate?.(column.key)}>Дублировать</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={() => onDelete?.(column.key)}
            className="text-destructive focus:text-destructive"
          >
            Удалить столбец
          </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
    </ContextMenu>
  );
}
