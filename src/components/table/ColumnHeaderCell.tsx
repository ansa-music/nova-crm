import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowDownAZ,
  ArrowUp,
  ArrowUpAZ,
  Eye,
  EyeOff,
  Filter,
  GripVertical,
  Layers,
  MoreHorizontal,
  MousePointerSquareDashed,
  Palette,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Trash2,
  X,
} from "lucide-react";
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
  DropdownMenuLabel,
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
import { ColumnTypeIcon, columnTypeLabel } from "@/components/table/ColumnTypeIcon";
import { promptDialog } from "@/utils/appDialog";
import type { ColumnType, PageColumn, SortState } from "@/types";

interface ColumnHeaderCellProps {
  column: PageColumn;
  sortState: SortState;
  onSort: (colKey: string) => void;
  /** Explicit direction from the menu (null clears). */
  onSortDirection?: (colKey: string, direction: "asc" | "desc" | null) => void;
  onFilterClick: (colKey: string, e: MouseEvent) => void;
  hasActiveFilter: boolean;
  onClearFilter?: (colKey: string) => void;
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
  /** Inline rename commit (double-click on the label). Falls back to onRename when absent. */
  onRenameCommit?: (colKey: string, label: string) => void;
  onChangeType?: (colKey: string, type: ColumnType, customFieldId?: string) => void;
  onManageOptions?: (colKey: string) => void;
  onDuplicate?: (colKey: string) => void;
  onDelete?: (colKey: string) => void;
  onToggleHidden?: (colKey: string) => void;
  onSelectColumn?: (colKey: string, extend: boolean) => void;
  isColumnSelected?: boolean;
  isGrouped?: boolean;
  onGroupBy?: (colKey: string | null) => void;
  onInsertColumnAfter?: (colKey: string) => void;
  /** Phone: one ⋯ menu, no drag handle, no second ellipsis in the label. */
  compactChrome?: boolean;
  /** Pre-computed footer hint shown in the header tooltip (e.g. "Заполнено 12/40"). */
  hint?: string;
}

export function ColumnHeaderCell({
  column,
  sortState,
  onSort,
  onSortDirection,
  onFilterClick,
  hasActiveFilter,
  onClearFilter,
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
  onRenameCommit,
  onChangeType,
  onManageOptions,
  onDuplicate,
  onDelete,
  onToggleHidden,
  onSelectColumn,
  isColumnSelected,
  isGrouped,
  onGroupBy,
  onInsertColumnAfter,
  compactChrome,
  hint,
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
  const customName = column.type === "custom" ? customFields.find((f) => f.id === column.customFieldId)?.name : undefined;

  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(column.label);
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) {
      setDraft(column.label);
      const t = window.setTimeout(() => {
        renameRef.current?.focus();
        renameRef.current?.select();
      }, 10);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [renaming, column.label]);

  function commitRename() {
    const next = draft.trim();
    setRenaming(false);
    if (!next || next === column.label) return;
    if (onRenameCommit) onRenameCommit(column.key, next);
    else onRename?.(column.key);
  }

  function startRename() {
    if (!canEditStructure) return;
    if (onRenameCommit) setRenaming(true);
    else onRename?.(column.key);
  }

  async function handleCreateCustomField() {
    const name = (await promptDialog({ title: "Новое кастомное поле", label: "Название", placeholder: "Например, Приоритет", maxLength: 40, confirmLabel: "Создать" }))?.trim();
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
  const headerTitle = [
    column.label,
    columnTypeLabel(column.type, customName),
    hint,
    isSorted ? (sortState.direction === "asc" ? "сортировка ↑" : "сортировка ↓") : null,
    hasActiveFilter ? "фильтр активен" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const typeSubmenu = (Item: typeof DropdownMenuItem, Sub: typeof DropdownMenuSub, SubTrigger: typeof DropdownMenuSubTrigger, SubContent: typeof DropdownMenuSubContent, Sep: typeof DropdownMenuSeparator) => (
    <Sub>
      <SubTrigger>
        <ColumnTypeIcon type={column.type} className="h-3.5 w-3.5" /> Тип: {columnTypeLabel(column.type, customName)}
      </SubTrigger>
      <SubContent>
        {typeChoices.map((choice) => {
          const isCurrent =
            column.type === choice.type && (choice.type !== "custom" || column.customFieldId === choice.customFieldId);
          return (
            <Item key={choice.value} onClick={() => onChangeType?.(column.key, choice.type, choice.customFieldId)}>
              <ColumnTypeIcon type={choice.type} className="h-3.5 w-3.5" />
              {choice.label}
              {isCurrent && " ✓"}
            </Item>
          );
        })}
        <Sep />
        <Item onClick={handleCreateCustomField}>
          <Plus className="h-3.5 w-3.5" /> Новое кастомное поле…
        </Item>
      </SubContent>
    </Sub>
  );

  const sortSubmenu = (Item: typeof DropdownMenuItem, Sub: typeof DropdownMenuSub, SubTrigger: typeof DropdownMenuSubTrigger, SubContent: typeof DropdownMenuSubContent) =>
    onSortDirection ? (
      <Sub>
        <SubTrigger>
          {isSorted && sortState.direction === "desc" ? <ArrowUpAZ className="h-3.5 w-3.5" /> : <ArrowDownAZ className="h-3.5 w-3.5" />}
          Сортировка{isSorted ? (sortState.direction === "asc" ? ": по возрастанию" : ": по убыванию") : ""}
        </SubTrigger>
        <SubContent>
          <Item onClick={() => onSortDirection(column.key, "asc")}>
            <ArrowUp className="h-3.5 w-3.5" /> По возрастанию {isSorted && sortState.direction === "asc" && "✓"}
          </Item>
          <Item onClick={() => onSortDirection(column.key, "desc")}>
            <ArrowDown className="h-3.5 w-3.5" /> По убыванию {isSorted && sortState.direction === "desc" && "✓"}
          </Item>
          <Item onClick={() => onSortDirection(column.key, null)} disabled={!isSorted}>
            <X className="h-3.5 w-3.5" /> Без сортировки
          </Item>
        </SubContent>
      </Sub>
    ) : null;

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
            "table-header-cell group sticky top-0 z-[21] border-b border-r border-border/50 bg-background px-1 text-left font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground",
            stickyLeft !== undefined && "table-sticky-col z-[31] bg-background",
            isLastSticky && "table-sticky-edge",
            isColumnSelected && "table-header-selected",
            (isSorted || hasActiveFilter || isGrouped) && "table-header-flagged"
          )}
          title={renaming ? undefined : headerTitle}
          data-col={column.key}
        >
          <div className="flex h-11 min-w-0 items-center gap-0.5 overflow-hidden sm:h-9">
            {canReorder && !compactChrome && (
              <button
                {...attributes}
                {...listeners}
                className="cursor-grab touch-none select-none rounded p-1.5 opacity-0 hover:bg-accent group-hover:opacity-100 active:cursor-grabbing sm:p-0.5"
                title="Перетащить столбец"
              >
                <GripVertical className="h-3.5 w-3.5" />
              </button>
            )}
            {renaming ? (
              <input
                ref={renameRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    commitRename();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setRenaming(false);
                  }
                }}
                onMouseDown={(e) => e.stopPropagation()}
                maxLength={60}
                className="h-7 min-w-0 flex-1 rounded border border-primary bg-background px-1.5 font-sans text-[12px] normal-case tracking-normal text-foreground outline-none"
              />
            ) : (
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
                onDoubleClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  startRename();
                }}
                onMouseDown={(e) => {
                  if (e.ctrlKey || e.metaKey) e.preventDefault();
                }}
                className="flex min-h-11 min-w-0 flex-1 items-center gap-1 overflow-hidden py-1.5 text-left hover:text-foreground sm:min-h-0 sm:py-0"
              >
                <ColumnTypeIcon type={column.type} className="h-3 w-3" />
                <span className={cn("min-w-0 flex-1 overflow-hidden whitespace-nowrap", !showColumnMenu && "truncate")}>
                  {column.label}
                </span>
                {isGrouped && <Layers className="h-3 w-3 shrink-0 text-primary" aria-label="Группировка" />}
                {isSorted && sortState.direction === "desc" ? (
                  <ArrowDown className="h-3.5 w-3.5 shrink-0 text-primary" />
                ) : isSorted ? (
                  <ArrowUp className="h-3.5 w-3.5 shrink-0 text-primary" />
                ) : null}
              </button>
            )}
            {hasLabel && !renaming && (
              <button
                type="button"
                onClick={() => onTogglePin(column.key)}
                className={cn(
                  "inline-flex shrink-0 items-center justify-center rounded select-none hover:bg-accent",
                  compactChrome ? "h-7 w-7" : "min-h-10 min-w-10 p-1.5 opacity-40 group-hover:opacity-100 sm:min-h-0 sm:min-w-0 sm:p-0.5",
                  isPinned && "opacity-100 text-primary"
                )}
                title={pinLabel}
              >
                {isPinned ? <Pin className="h-3 w-3" /> : <PinOff className="h-3 w-3" />}
              </button>
            )}
            {showColumnMenu && !renaming && (
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground sm:min-h-0 sm:min-w-0 sm:p-0.5 sm:opacity-40 sm:group-hover:opacity-100"
                    title="Настройки столбца"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="z-[80] w-60">
                  <DropdownMenuLabel className="flex items-center gap-1.5 normal-case tracking-normal">
                    <ColumnTypeIcon type={column.type} className="h-3.5 w-3.5" />
                    <span className="truncate">{column.label}</span>
                  </DropdownMenuLabel>
                  {sortSubmenu(DropdownMenuItem, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent)}
                  <DropdownMenuItem onClick={(e) => onFilterClick(column.key, e as unknown as MouseEvent)}>
                    <Filter className="h-3.5 w-3.5" /> Фильтр по значениям…
                  </DropdownMenuItem>
                  {hasActiveFilter && onClearFilter && (
                    <DropdownMenuItem onClick={() => onClearFilter(column.key)}>
                      <X className="h-3.5 w-3.5" /> Снять фильтр
                    </DropdownMenuItem>
                  )}
                  {onGroupBy && (
                    <DropdownMenuItem onClick={() => onGroupBy(isGrouped ? null : column.key)}>
                      <Layers className="h-3.5 w-3.5" /> {isGrouped ? "Убрать группировку" : "Группировать по столбцу"}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => onSelectColumn?.(column.key, false)}>
                    <MousePointerSquareDashed className="h-3.5 w-3.5" /> Выделить столбец
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onTogglePin(column.key)}>
                    {isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />} {pinLabel}
                  </DropdownMenuItem>
                  {onAutoSize && (
                    <DropdownMenuItem onClick={() => onAutoSize(column.key)}>
                      <MousePointerSquareDashed className="h-3.5 w-3.5 rotate-90" /> Подогнать ширину
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={startRename}>
                    <Pencil className="h-3.5 w-3.5" /> Переименовать
                  </DropdownMenuItem>
                  {typeSubmenu(DropdownMenuItem, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuSeparator)}
                  {canEditThisOptions && (
                    <DropdownMenuItem onClick={() => onManageOptions?.(column.key)}>
                      <Palette className="h-3.5 w-3.5" /> Изменить варианты
                    </DropdownMenuItem>
                  )}
                  {onToggleHidden && (
                    <DropdownMenuItem onClick={() => onToggleHidden(column.key)}>
                      {column.hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                      {column.hidden ? "Показать столбец" : "Скрыть столбец"}
                    </DropdownMenuItem>
                  )}
                  {onInsertColumnAfter && (
                    <DropdownMenuItem onClick={() => onInsertColumnAfter(column.key)}>
                      <Plus className="h-3.5 w-3.5" /> Добавить столбец справа
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => onDuplicate?.(column.key)}>Дублировать</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onDelete?.(column.key)} className="text-destructive focus:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" /> Удалить столбец
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {!compactChrome && hasLabel && !renaming && (
              <button
                type="button"
                onClick={(e) => onFilterClick(column.key, e)}
                className={cn(
                  "inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded p-1.5 select-none opacity-40 hover:bg-accent group-hover:opacity-100 sm:min-h-0 sm:min-w-0 sm:p-0.5",
                  hasActiveFilter && "opacity-100 text-primary"
                )}
                title={hasActiveFilter ? "Фильтр активен — изменить" : "Фильтр"}
              >
                <Filter className={cn("h-3 w-3", hasActiveFilter && "fill-current")} />
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
            className="table-col-resizer absolute -right-1.5 top-0 z-10 h-full w-4 cursor-col-resize touch-none sm:w-2.5"
            title="Ширина столбца — двойной клик подогнать"
          >
            <span className="table-col-resizer-line absolute right-[3px] top-1.5 h-[calc(100%-12px)] w-px bg-border opacity-0 group-hover:opacity-100" />
          </div>
        </th>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        {sortSubmenu(ContextMenuItem as unknown as typeof DropdownMenuItem, ContextMenuSub as unknown as typeof DropdownMenuSub, ContextMenuSubTrigger as unknown as typeof DropdownMenuSubTrigger, ContextMenuSubContent as unknown as typeof DropdownMenuSubContent)}
        <ContextMenuItem onClick={(e) => onFilterClick(column.key, e as unknown as MouseEvent)}>
          <Filter className="h-3.5 w-3.5" /> Фильтр по значениям…
        </ContextMenuItem>
        {hasActiveFilter && onClearFilter && (
          <ContextMenuItem onClick={() => onClearFilter(column.key)}>
            <X className="h-3.5 w-3.5" /> Снять фильтр
          </ContextMenuItem>
        )}
        {onGroupBy && (
          <ContextMenuItem onClick={() => onGroupBy(isGrouped ? null : column.key)}>
            <Layers className="h-3.5 w-3.5" /> {isGrouped ? "Убрать группировку" : "Группировать по столбцу"}
          </ContextMenuItem>
        )}
        <ContextMenuItem onClick={() => onSelectColumn?.(column.key, false)}>
          <MousePointerSquareDashed className="h-3.5 w-3.5" /> Выделить столбец
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onTogglePin(column.key)}>
          {isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />} {pinLabel}
        </ContextMenuItem>
        {onAutoSize && <ContextMenuItem onClick={() => onAutoSize(column.key)}>Подогнать ширину</ContextMenuItem>}
        {canEditStructure && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={startRename}>
              <Pencil className="h-3.5 w-3.5" /> Переименовать
            </ContextMenuItem>
            {typeSubmenu(
              ContextMenuItem as unknown as typeof DropdownMenuItem,
              ContextMenuSub as unknown as typeof DropdownMenuSub,
              ContextMenuSubTrigger as unknown as typeof DropdownMenuSubTrigger,
              ContextMenuSubContent as unknown as typeof DropdownMenuSubContent,
              ContextMenuSeparator as unknown as typeof DropdownMenuSeparator
            )}
            {canEditThisOptions && (
              <ContextMenuItem onClick={() => onManageOptions?.(column.key)}>
                <Palette className="h-3.5 w-3.5" /> Изменить варианты
              </ContextMenuItem>
            )}
            {onToggleHidden && (
              <ContextMenuItem onClick={() => onToggleHidden(column.key)}>
                {column.hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                {column.hidden ? "Показать столбец" : "Скрыть столбец"}
              </ContextMenuItem>
            )}
            {onInsertColumnAfter && (
              <ContextMenuItem onClick={() => onInsertColumnAfter(column.key)}>
                <Plus className="h-3.5 w-3.5" /> Добавить столбец справа
              </ContextMenuItem>
            )}
            <ContextMenuItem onClick={() => onDuplicate?.(column.key)}>Дублировать</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => onDelete?.(column.key)} className="text-destructive focus:text-destructive">
              <Trash2 className="h-3.5 w-3.5" /> Удалить столбец
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
