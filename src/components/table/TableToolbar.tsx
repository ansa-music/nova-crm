import { useEffect, useRef, useState } from "react";
import {
  Bookmark,
  CalendarDays,
  UserRound,
  ClipboardList,
  Columns3,
  Copy,
  Download,
  Eye,
  Kanban,
  Keyboard,
  Layers,
  ListOrdered,
  MoreHorizontal,
  Palette,
  Plus,
  Redo2,
  Undo2,
  Rows3,
  Search,
  SlidersHorizontal,
  Table2,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
import { NOT_DONE_STATUS_FILTER } from "@/utils/columnOptions";
import { PAGE_SIZES, pageSizeLabel } from "@/components/table/TablePagination";
import { useUiStore } from "@/store/uiStore";
import { redo, undo, useUndoState } from "@/utils/undoStore";
import type { PageColumn, StatusOption } from "@/types";
import type { SavedTableView } from "@/utils/savedTableViews";
import { DATE_PRESET_LABELS, DATE_PRESET_ORDER, type DatePreset } from "@/utils/dateRanges";

interface TableToolbarProps {
  columns: PageColumn[];
  searchQuery: string;
  onSearchChange: (value: string) => void;
  /** Bumped by DataTable when Ctrl+F asks the search box to focus. */
  focusSearchToken?: number;
  groupByKey: string | null;
  onGroupByChange: (key: string | null) => void;
  onCollapseAllGroups?: () => void;
  onExpandAllGroups?: () => void;
  density: "compact" | "default" | "comfortable";
  onDensityChange: (density: "compact" | "default" | "comfortable") => void;
  onAddRow: () => void;
  onQuickOrder?: () => void;
  onExportCsv: () => void;
  onCopyTable?: () => void;
  canEdit: boolean;
  canEditStructure: boolean;
  onAddColumn: () => void;
  onOpenSchema?: () => void;
  onManageStatuses?: () => void;
  canManageStatuses?: boolean;
  onShowColumn?: (colKey: string) => void;
  onShowAllColumns?: () => void;
  onAutoSizeAll?: () => void;
  selectedCount: number;
  onDeleteSelected: () => void;
  hasStatusColumn: boolean;
  statusOptions?: StatusOption[];
  statusFilter?: string | null;
  onStatusFilterChange?: (value: string | null) => void;
  /** Row counts per status value (for chip badges). */
  statusCounts?: Record<string, number>;
  viewMode: "table" | "kanban";
  onViewModeChange: (mode: "table" | "kanban") => void;
  savedViews?: SavedTableView[];
  onSaveView?: () => void;
  onApplyView?: (view: SavedTableView) => void;
  onDeleteView?: (view: SavedTableView) => void;
  hasActiveFilters?: boolean;
  onResetFilters?: () => void;
  pageSize?: number;
  onPageSizeChange?: (size: number) => void;
  visibleCount?: number;
  totalCount?: number;
  dateFilter?: { colKey: string; preset: DatePreset } | null;
  onDateFilterChange?: (next: { colKey: string; preset: DatePreset } | null) => void;
  /** Show the «Мои» chip (a responsible column exists and the person matches an option). */
  canFilterMine?: boolean;
  mineOnly?: boolean;
  onMineOnlyChange?: (next: boolean) => void;
}

const DENSITY_LABELS: Record<TableToolbarProps["density"], string> = {
  compact: "Компактно",
  default: "Обычно",
  comfortable: "Свободно",
};

export function TableToolbar({
  columns,
  searchQuery,
  onSearchChange,
  focusSearchToken,
  groupByKey,
  onGroupByChange,
  onCollapseAllGroups,
  onExpandAllGroups,
  density,
  onDensityChange,
  onAddRow,
  onQuickOrder,
  onExportCsv,
  onCopyTable,
  canEdit,
  canEditStructure,
  onAddColumn,
  onOpenSchema,
  onManageStatuses,
  canManageStatuses,
  onShowColumn,
  onShowAllColumns,
  onAutoSizeAll,
  selectedCount: _selectedCount,
  onDeleteSelected: _onDeleteSelected,
  hasStatusColumn,
  statusOptions,
  statusFilter,
  onStatusFilterChange,
  statusCounts,
  viewMode,
  onViewModeChange,
  savedViews,
  onSaveView,
  onApplyView,
  onDeleteView,
  hasActiveFilters,
  onResetFilters,
  pageSize,
  onPageSizeChange,
  visibleCount,
  totalCount,
  dateFilter,
  onDateFilterChange,
  canFilterMine,
  mineOnly,
  onMineOnlyChange,
}: TableToolbarProps) {
  const [searchOpen, setSearchOpen] = useState(Boolean(searchQuery));
  const searchRef = useRef<HTMLInputElement>(null);
  const setShortcutsHelpOpen = useUiStore((s) => s.setShortcutsHelpOpen);
  const undoState = useUndoState();
  const hiddenColumns = columns.filter((c) => c.hidden);
  const hiddenColumnCount = hiddenColumns.length;
  const dateColumns = columns.filter((c) => c.type === "date" && !c.hidden);
  const activeDateColumn = dateFilter ? columns.find((c) => c.key === dateFilter.colKey) : undefined;

  const searchExpanded = searchOpen || Boolean(searchQuery);

  useEffect(() => {
    if (!focusSearchToken) return;
    setSearchOpen(true);
    const t = window.setTimeout(() => {
      searchRef.current?.focus();
      searchRef.current?.select();
    }, 20);
    return () => window.clearTimeout(t);
  }, [focusSearchToken]);

  const countLabel =
    typeof visibleCount === "number" && typeof totalCount === "number"
      ? visibleCount === totalCount
        ? `${totalCount}`
        : `${visibleCount}/${totalCount}`
      : null;

  return (
    <div className="table-toolbar z-10 flex h-12 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-primary/25 bg-background px-2 sm:h-auto sm:flex-wrap sm:gap-2 sm:overflow-visible sm:px-4 sm:py-2">
      <div
        className={cn(
          "relative min-w-0",
          searchExpanded ? "flex-1 sm:w-60 sm:flex-none" : "w-10 shrink-0 sm:w-60 sm:flex-none"
        )}
      >
        {!searchExpanded && (
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10 shrink-0 sm:hidden"
            onClick={() => setSearchOpen(true)}
            title="Поиск"
          >
            <Search className="h-4 w-4" />
          </Button>
        )}
        <div className={cn(!searchExpanded && "hidden sm:block")}>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Поиск по столу  (Ctrl+F)"
            className="h-9 rounded-md bg-background pl-8 pr-8 text-sm sm:h-8"
            autoFocus={searchOpen && !searchQuery}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => {
              if (!searchQuery) setSearchOpen(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                if (searchQuery) onSearchChange("");
                else (e.currentTarget as HTMLInputElement).blur();
              }
            }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                onSearchChange("");
                searchRef.current?.focus();
              }}
              className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Очистить поиск"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {hasStatusColumn && statusOptions && statusOptions.length > 0 && onStatusFilterChange && (
        <div className="flex min-w-0 max-w-full items-center gap-1 overflow-x-auto scrollbar-thin">
          <button
            type="button"
            onClick={() => onStatusFilterChange(null)}
            className={cn(
              "table-chip h-7 shrink-0 rounded-full border px-2.5 text-[11px] font-medium",
              !statusFilter
                ? "border-primary/40 bg-primary/12 text-primary"
                : "border-border bg-background text-muted-foreground hover:text-foreground"
            )}
          >
            Все
            {countLabel && !statusFilter && typeof totalCount === "number" ? (
              <span className="ml-1 opacity-70">{totalCount}</span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() =>
              onStatusFilterChange(statusFilter === NOT_DONE_STATUS_FILTER ? null : NOT_DONE_STATUS_FILTER)
            }
            className={cn(
              "table-chip h-7 shrink-0 rounded-full border px-2.5 text-[11px] font-medium",
              statusFilter === NOT_DONE_STATUS_FILTER
                ? "border-primary/40 bg-primary/12 text-primary"
                : "border-border bg-background text-muted-foreground hover:text-foreground"
            )}
          >
            Не готово
            {statusCounts && typeof statusCounts[NOT_DONE_STATUS_FILTER] === "number" ? (
              <span className="ml-1 opacity-70">{statusCounts[NOT_DONE_STATUS_FILTER]}</span>
            ) : null}
          </button>
          {statusOptions.map((opt) => {
            const n = statusCounts?.[opt.value];
            const active = statusFilter === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onStatusFilterChange(active ? null : opt.value)}
                className={cn(
                  "table-chip hidden h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[11px] font-medium sm:inline-flex",
                  active
                    ? "border-primary/40 bg-primary/12 text-primary"
                    : "border-border bg-background text-muted-foreground hover:text-foreground",
                  !active && n === 0 && "opacity-50"
                )}
                style={
                  active
                    ? {
                        backgroundColor: `hsl(${opt.color} / 0.16)`,
                        color: `hsl(${opt.color})`,
                        borderColor: `hsl(${opt.color} / 0.28)`,
                      }
                    : undefined
                }
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: `hsl(${opt.color})` }} />
                {opt.label}
                {typeof n === "number" && n > 0 ? <span className="opacity-70">{n}</span> : null}
              </button>
            );
          })}
        </div>
      )}

      {hasStatusColumn && (
        <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-border bg-background p-0.5">
          <Button
            variant={viewMode === "table" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 min-w-0 gap-1.5 rounded-full px-2.5"
            onClick={() => onViewModeChange("table")}
            title="Таблица"
          >
            <Table2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant={viewMode === "kanban" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 min-w-0 gap-1.5 rounded-full px-2.5"
            onClick={() => onViewModeChange("kanban")}
            title="Канбан"
          >
            <Kanban className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {canFilterMine && onMineOnlyChange && (
        <button
          type="button"
          onClick={() => onMineOnlyChange(!mineOnly)}
          className={cn(
            "table-chip inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[11px] font-medium",
            mineOnly
              ? "border-amber-400/40 bg-amber-400/15 text-amber-300"
              : "border-border bg-background text-muted-foreground hover:text-foreground"
          )}
          title="Показать только строки, где ответственный — вы"
        >
          <UserRound className="h-3 w-3" />
          Мои
        </button>
      )}

      {dateColumns.length > 0 && onDateFilterChange && viewMode === "table" && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "table-chip inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[11px] font-medium",
                dateFilter
                  ? "border-sky-400/40 bg-sky-400/15 text-sky-300"
                  : "border-border bg-background text-muted-foreground hover:text-foreground"
              )}
              title="Быстрый фильтр по дате"
            >
              <CalendarDays className="h-3 w-3" />
              {dateFilter ? DATE_PRESET_LABELS[dateFilter.preset] : "Период"}
              {dateFilter && dateColumns.length > 1 && activeDateColumn ? (
                <span className="opacity-70">· {activeDateColumn.label}</span>
              ) : null}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {dateColumns.length > 1 && (
              <>
                <DropdownMenuLabel>Столбец</DropdownMenuLabel>
                {dateColumns.map((c) => (
                  <DropdownMenuItem
                    key={c.id}
                    onClick={() => onDateFilterChange({ colKey: c.key, preset: dateFilter?.preset ?? "thisMonth" })}
                  >
                    <CalendarDays className="h-3.5 w-3.5" /> {c.label}
                    {(dateFilter?.colKey ?? dateColumns[0].key) === c.key && " ✓"}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuLabel>Период</DropdownMenuLabel>
            {DATE_PRESET_ORDER.map((preset) => (
              <DropdownMenuItem
                key={preset}
                onClick={() => onDateFilterChange({ colKey: dateFilter?.colKey ?? dateColumns[0].key, preset })}
              >
                {DATE_PRESET_LABELS[preset]}
                {dateFilter?.preset === preset && " ✓"}
              </DropdownMenuItem>
            ))}
            {dateFilter && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onDateFilterChange(null)}>
                  <X className="h-3.5 w-3.5" /> Все даты
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {hasActiveFilters && onResetFilters && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 shrink-0 gap-1 px-2 text-muted-foreground hover:text-foreground"
          onClick={onResetFilters}
          title="Сбросить поиск, фильтры, группировку и сортировку"
        >
          <X className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Сбросить</span>
        </Button>
      )}

      {canEditStructure && hiddenColumnCount > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-8 shrink-0 gap-1.5 border-primary/50 bg-primary/10 text-primary hover:bg-primary/15"
              title={`Скрытых столбцов: ${hiddenColumnCount} — нажмите, чтобы вернуть`}
            >
              <Eye className="h-3.5 w-3.5" />
              <span className="hidden xs:inline">Скрыто: {hiddenColumnCount}</span>
              <span className="xs:hidden">{hiddenColumnCount}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Скрытые столбцы</DropdownMenuLabel>
            {hiddenColumns.map((c) => (
              <DropdownMenuItem key={c.id} onClick={() => onShowColumn?.(c.key)}>
                <Eye className="h-3.5 w-3.5" /> {c.label || "Без названия"}
              </DropdownMenuItem>
            ))}
            {hiddenColumnCount > 1 && onShowAllColumns && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onShowAllColumns}>Показать все</DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <div className="hidden flex-1 sm:block" />

      {countLabel && (
        <span className="hidden shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground md:inline" title="Строк показано / всего">
          {countLabel} стр.
        </span>
      )}

      {canEdit && (
        <div className="hidden shrink-0 items-center gap-0.5 sm:flex">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={!undoState.canUndo}
            onClick={() => void undo()}
            title={undoState.canUndo ? `Отменить (Ctrl+Z) — ${undoState.undoCount} в очереди` : "Нечего отменять"}
          >
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={!undoState.canRedo}
            onClick={() => void redo()}
            title={undoState.canRedo ? "Вернуть (Ctrl+Y)" : "Нечего вернуть"}
          >
            <Redo2 className="h-4 w-4" />
          </Button>
        </div>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" className="relative h-10 w-10 shrink-0 sm:h-8 sm:w-8" title="Ещё">
            <MoreHorizontal className="h-4 w-4" />
            {hiddenColumnCount > 0 && !canEditStructure && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">
                {hiddenColumnCount}
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          {onSaveView && onApplyView && onDeleteView && (
            <>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Bookmark className="h-3.5 w-3.5" /> Виды{savedViews && savedViews.length ? ` (${savedViews.length})` : ""}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={onSaveView}>
                    <Plus className="h-3.5 w-3.5" /> Сохранить текущий вид
                  </DropdownMenuItem>
                  {savedViews && savedViews.length > 0 && <DropdownMenuSeparator />}
                  {savedViews?.map((view) => (
                    <DropdownMenuItem key={view.id} onClick={() => onApplyView(view)}>
                      <Bookmark className="h-3.5 w-3.5" /> {view.name}
                    </DropdownMenuItem>
                  ))}
                  {savedViews && savedViews.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>Удалить вид</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          {savedViews.map((view) => (
                            <DropdownMenuItem key={view.id} onClick={() => onDeleteView(view)}>
                              {view.name}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    </>
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
            </>
          )}
          {viewMode === "table" && (
            <>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Layers className="h-3.5 w-3.5" />
                  Группировка{groupByKey ? ": " + (columns.find((c) => c.key === groupByKey)?.label ?? "") : ""}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={() => onGroupByChange(null)}>
                    Без группировки{!groupByKey && " ✓"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {columns
                    .filter((c) => !c.hidden)
                    .map((c) => (
                      <DropdownMenuItem key={c.id} onClick={() => onGroupByChange(c.key)}>
                        {c.label}
                        {groupByKey === c.key && " ✓"}
                      </DropdownMenuItem>
                    ))}
                  {groupByKey && onCollapseAllGroups && onExpandAllGroups && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={onCollapseAllGroups}>Свернуть все группы</DropdownMenuItem>
                      <DropdownMenuItem onClick={onExpandAllGroups}>Развернуть все группы</DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Rows3 className="h-3.5 w-3.5" /> Плотность: {DENSITY_LABELS[density]}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {(Object.keys(DENSITY_LABELS) as TableToolbarProps["density"][]).map((d) => (
                    <DropdownMenuItem key={d} onClick={() => onDensityChange(d)}>
                      {DENSITY_LABELS[d]}
                      {density === d && " ✓"}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              {onPageSizeChange && typeof pageSize === "number" && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <ListOrdered className="h-3.5 w-3.5" /> Постранично: {pageSizeLabel(pageSize)}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {PAGE_SIZES.map((size) => (
                      <DropdownMenuItem key={String(size)} onClick={() => onPageSizeChange(size)}>
                        {pageSizeLabel(size)}
                        {pageSize === size && " ✓"}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              {onAutoSizeAll && (
                <DropdownMenuItem onClick={onAutoSizeAll}>
                  <Columns3 className="h-3.5 w-3.5" /> Подогнать ширину всех столбцов
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onClick={onExportCsv}>
            <Download className="h-3.5 w-3.5" /> Экспорт CSV
          </DropdownMenuItem>
          {onCopyTable && (
            <DropdownMenuItem onClick={onCopyTable}>
              <Copy className="h-3.5 w-3.5" /> Копировать таблицу (для Excel)
            </DropdownMenuItem>
          )}
          {canEditStructure && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onOpenSchema ?? onAddColumn}>
                <SlidersHorizontal className="h-3.5 w-3.5" /> Столбцы
                {hiddenColumnCount > 0 && ` (скрыто: ${hiddenColumnCount})`}
              </DropdownMenuItem>
              {canManageStatuses && (
                <DropdownMenuItem onClick={onManageStatuses}>
                  <Palette className="h-3.5 w-3.5" /> Статусы
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={onAddColumn}>
                <Columns3 className="h-3.5 w-3.5" /> Добавить столбец
              </DropdownMenuItem>
            </>
          )}
          {canEdit && (
            <>
              <DropdownMenuSeparator className="sm:hidden" />
              <DropdownMenuItem onClick={() => void undo()} disabled={!undoState.canUndo} className="sm:hidden">
                <Undo2 className="h-3.5 w-3.5" /> Отменить
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void redo()} disabled={!undoState.canRedo} className="sm:hidden">
                <Redo2 className="h-3.5 w-3.5" /> Вернуть
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setShortcutsHelpOpen(true)}>
            <Keyboard className="h-3.5 w-3.5" /> Горячие клавиши
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {canEdit && onQuickOrder && (
        <Button
          variant="outline"
          size="sm"
          className="h-10 shrink-0 gap-1.5 sm:h-8"
          onClick={onQuickOrder}
          title="Быстрый заказ в открытую вкладку"
        >
          <ClipboardList className="h-3.5 w-3.5" />
          <span className="hidden xs:inline">Заказ</span>
        </Button>
      )}

      {canEdit && (
        <Button
          size="sm"
          className="sticky right-0 z-20 ml-1 h-10 shrink-0 gap-1.5 shadow-[-8px_0_8px_-4px_hsl(0_0%_2%)] sm:static sm:ml-0 sm:h-8 sm:shadow-none"
          onClick={onAddRow}
          title="Добавить строку (Ctrl+Enter)"
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden xs:inline">Строка</span>
        </Button>
      )}
    </div>
  );
}
