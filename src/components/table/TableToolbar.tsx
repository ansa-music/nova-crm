import { useEffect, useRef, useState } from "react";
import {
  ArrowDownUp,
  ArrowDownNarrowWide,
  ArrowUpNarrowWide,
  Bookmark,
  CalendarDays,
  GripVertical,
  Check,
  ChevronDown,
  ClipboardList,
  UserRound,
  Columns3,
  Copy,
  Download,
  Eye,
  Kanban,
  LayoutList,
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
import type { PageColumn, StatusOption, TableViewMode } from "@/types";
import type { SortState } from "@/types/table";
import { ROW_ORDER_MODE_LABELS, type RowOrderMode } from "@/utils/rowEntryOrder";
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
  /** Порядок строк без сортировки по столбцу (по времени внесения или вручную). */
  orderMode?: RowOrderMode;
  onOrderModeChange?: (mode: RowOrderMode) => void;
  /** На вкладке есть ручной порядок (перетаскивали / вставляли строки). */
  canManualOrder?: boolean;
  /** Сортировка по столбцу (перебивает порядок). */
  sortState?: SortState;
  onSortColumn?: (colKey: string, direction: "asc" | "desc" | null) => void;
  density: "compact" | "default" | "comfortable";
  onDensityChange: (density: "compact" | "default" | "comfortable") => void;
  onAddRow: () => void;
  /** Заказы заводит только ОС — кнопку «Строка» технарю не показываем. */
  canAddRows?: boolean;
  /** Быстрый заказ; передаётся, когда он вообще доступен (пункт в «⋯»). */
  onQuickOrder?: () => void;
  /**
   * Рисовать кнопку «Заказ» в строке тулбара. В обычном режиме её рисует
   * шапка стола; на весь экран / иммерсивно шапки нет — кнопка нужна здесь.
   */
  quickOrderButton?: boolean;
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
  hasStatusColumn: boolean;
  statusOptions?: StatusOption[];
  statusFilter?: string | null;
  onStatusFilterChange?: (value: string | null) => void;
  /** Row counts per status value (for chip badges). */
  statusCounts?: Record<string, number>;
  viewMode: TableViewMode;
  onViewModeChange: (mode: TableViewMode) => void;
  /** Сколько строк приехало заказами и ещё подсвечено. */
  highlightCount?: number;
  onClearHighlights?: () => void;
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

const VIEW_MODE_LABELS: Record<TableViewMode, string> = {
  table: "Таблица",
  cards: "Карточки",
  kanban: "Канбан",
};

/**
 * Чип тулбара по макету «C — плотный»: плоская рамка цвета границы, без
 * заливки, один акцент на активном. Никаких цветных рамок по статусу —
 * цвет статуса живёт в самой таблице.
 */
const CHIP_CLASS =
  "table-chip inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 text-[12.5px] leading-none transition-colors sm:h-8";
const CHIP_IDLE = "border-border bg-transparent text-foreground/80 hover:text-foreground";
const CHIP_ACTIVE = "border-primary/30 bg-primary/12 text-primary";
// Активная кнопка сегмента видов: тот же тон, что у активного чипа, без рамки
// (рамку даёт сам сегмент). hover тоже акцентный — ghost иначе гасил бы её в серый.
const SEGMENT_ACTIVE = "bg-primary/12 text-primary hover:bg-primary/12 hover:text-primary";

export function TableToolbar({
  columns,
  searchQuery,
  onSearchChange,
  focusSearchToken,
  groupByKey,
  onGroupByChange,
  onCollapseAllGroups,
  onExpandAllGroups,
  orderMode,
  onOrderModeChange,
  canManualOrder = false,
  sortState,
  onSortColumn,
  density,
  onDensityChange,
  onAddRow,
  canAddRows = true,
  onQuickOrder,
  quickOrderButton = false,
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
  hasStatusColumn,
  statusOptions,
  statusFilter,
  onStatusFilterChange,
  statusCounts,
  viewMode,
  onViewModeChange,
  highlightCount = 0,
  onClearHighlights,
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
  const allStatusOptions = statusOptions ?? [];
  const [searchOpen, setSearchOpen] = useState(Boolean(searchQuery));
  const searchRef = useRef<HTMLInputElement>(null);
  const setShortcutsHelpOpen = useUiStore((s) => s.setShortcutsHelpOpen);
  const undoState = useUndoState();
  const hiddenColumns = columns.filter((c) => c.hidden);
  const hiddenColumnCount = hiddenColumns.length;
  const dateColumns = columns.filter((c) => c.type === "date" && !c.hidden);
  const activeDateColumn = dateFilter ? columns.find((c) => c.key === dateFilter.colKey) : undefined;
  const groupableColumns = columns.filter((c) => !c.hidden);
  const groupColumn = groupByKey ? columns.find((c) => c.key === groupByKey) : undefined;
  const showStatusChips = hasStatusColumn && allStatusOptions.length > 0 && Boolean(onStatusFilterChange);
  const sortColumn = sortState?.colKey && sortState.direction ? columns.find((c) => c.key === sortState.colKey) : undefined;
  // Подпись чипа порядка: столбец со стрелкой, иначе «Новые снизу / сверху / Вручную».
  const orderLabel = sortColumn
    ? `${sortColumn.label} ${sortState?.direction === "asc" ? "↑" : "↓"}`
    : orderMode
      ? ROW_ORDER_MODE_LABELS[orderMode]
      : "";
  const sortDirectionHint = (col: PageColumn, dir: "asc" | "desc") => {
    if (col.type === "date") return dir === "asc" ? "старые сверху" : "новые сверху";
    if (col.type === "number" || col.type === "currency") return dir === "asc" ? "меньше сверху" : "больше сверху";
    return dir === "asc" ? "А → Я" : "Я → А";
  };

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
    <div className="table-toolbar z-10 flex h-12 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border bg-background px-2 scrollbar-thin sm:h-10 sm:gap-2 sm:px-4">
      <div
        className={cn(
          "relative min-w-0",
          searchExpanded ? "flex-1 sm:w-[260px] sm:flex-none" : "w-10 shrink-0 sm:w-[260px] sm:flex-none"
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
            placeholder="Поиск  Ctrl+F"
            className="h-9 rounded-md border-border bg-transparent pl-8 pr-8 text-[12.5px] sm:h-8"
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

      {/* «Все N» и «Не готово N» — единственные чипы статусов на виду; чипы по
          отдельным статусам уехали в «⋯ → Статус», иначе на столе с шестью
          статусами они занимали половину строки. */}
      {showStatusChips && onStatusFilterChange && (
        <>
          <button
            type="button"
            onClick={() => onStatusFilterChange(null)}
            className={cn(CHIP_CLASS, CHIP_IDLE)}
            title="Показать все заказы"
          >
            Все
            {typeof totalCount === "number" ? <span className="opacity-60">{totalCount}</span> : null}
          </button>
          <button
            type="button"
            onClick={() =>
              onStatusFilterChange(statusFilter === NOT_DONE_STATUS_FILTER ? null : NOT_DONE_STATUS_FILTER)
            }
            className={cn(CHIP_CLASS, statusFilter === NOT_DONE_STATUS_FILTER ? CHIP_ACTIVE : CHIP_IDLE)}
            title="Только заказы, которые ещё не готовы"
          >
            Не готово
            {statusCounts && typeof statusCounts[NOT_DONE_STATUS_FILTER] === "number" ? (
              <span className="opacity-60">{statusCounts[NOT_DONE_STATUS_FILTER]}</span>
            ) : null}
          </button>
        </>
      )}

      {dateColumns.length > 0 && onDateFilterChange && viewMode === "table" && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(CHIP_CLASS, dateFilter ? CHIP_ACTIVE : CHIP_IDLE)}
              title="Быстрый фильтр по дате"
            >
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

      {/* Группировка — видимый чип: по умолчанию стол сгруппирован по статусу,
          и человек должен видеть, чем именно, и уметь переключить в один клик. */}
      {viewMode === "table" && groupableColumns.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={cn(CHIP_CLASS, CHIP_IDLE)} title="Группировать строки по столбцу">
              <span className="hidden sm:inline">Группировать: </span>
              <Layers className="h-3.5 w-3.5 sm:hidden" />
              <span className="max-w-[140px] truncate">{groupColumn?.label ?? "нет"}</span>
              <ChevronDown className="h-3 w-3 opacity-60" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem onClick={() => onGroupByChange(null)}>
              Без группировки{!groupByKey && " ✓"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {groupableColumns.map((c) => (
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
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Порядок строк — видимый чип (просьба Nurba 26.09.2026): по умолчанию
          «по времени внесения, новые снизу»; можно «новые сверху», ручной
          порядок и сортировку по любому столбцу. */}
      {orderMode && onOrderModeChange && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(CHIP_CLASS, sortColumn || orderMode !== "entry-asc" ? CHIP_ACTIVE : CHIP_IDLE)}
              title="Порядок строк"
            >
              <span className="hidden sm:inline">Порядок: </span>
              <ArrowDownUp className="h-3.5 w-3.5 sm:hidden" />
              <span className="max-w-[140px] truncate">{orderLabel}</span>
              <ChevronDown className="h-3 w-3 opacity-60" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel>По времени внесения в таблицу</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => onOrderModeChange("entry-asc")}>
              <ArrowDownNarrowWide className="h-3.5 w-3.5" />
              <span className="flex-1">Новые снизу</span>
              {!sortColumn && orderMode === "entry-asc" && <Check className="h-3.5 w-3.5" />}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onOrderModeChange("entry-desc")}>
              <ArrowUpNarrowWide className="h-3.5 w-3.5" />
              <span className="flex-1">Новые сверху</span>
              {!sortColumn && orderMode === "entry-desc" && <Check className="h-3.5 w-3.5" />}
            </DropdownMenuItem>
            {canManualOrder && (
              <DropdownMenuItem onClick={() => onOrderModeChange("manual")}>
                <GripVertical className="h-3.5 w-3.5" />
                <span className="flex-1">Как расставили вручную</span>
                {!sortColumn && orderMode === "manual" && <Check className="h-3.5 w-3.5" />}
              </DropdownMenuItem>
            )}
            <p className="px-2 pb-1.5 pt-0.5 text-[11px] leading-snug text-muted-foreground">
              Время, когда строку заполнили, а не дата в столбце.
            </p>
            {onSortColumn && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <ListOrdered className="h-3.5 w-3.5" />
                    <span className="flex-1">По столбцу</span>
                    {sortColumn ? <span className="max-w-[90px] truncate text-xs text-muted-foreground">{sortColumn.label}</span> : null}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-[60vh] w-60 overflow-y-auto">
                    {columns
                      .filter((c) => !c.hidden)
                      .map((c) => {
                        const active = sortColumn?.key === c.key ? sortState?.direction : null;
                        return (
                          <div key={c.id} className="flex items-center gap-1 px-1 py-0.5">
                            <span className={cn("min-w-0 flex-1 truncate px-1 text-[13px]", active && "font-medium text-primary")}>
                              {c.label}
                            </span>
                            {(["asc", "desc"] as const).map((dir) => (
                              <DropdownMenuItem
                                key={dir}
                                className={cn("h-7 shrink-0 justify-center px-2 text-xs", active === dir && "bg-primary/12 text-primary")}
                                title={sortDirectionHint(c, dir)}
                                onClick={() => onSortColumn(c.key, dir)}
                              >
                                {dir === "asc" ? "↑" : "↓"}
                              </DropdownMenuItem>
                            ))}
                          </div>
                        );
                      })}
                    {sortColumn && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => onSortColumn(sortColumn.key, null)}>
                          <X className="h-3.5 w-3.5" /> Без сортировки по столбцу
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* На телефоне чип «Мои» остаётся на виду, на десктопе он в «⋯». */}
      {canFilterMine && onMineOnlyChange && (
        <button
          type="button"
          onClick={() => onMineOnlyChange(!mineOnly)}
          className={cn(CHIP_CLASS, mineOnly ? CHIP_ACTIVE : CHIP_IDLE, "sm:hidden")}
          title="Показать только строки, где ответственный — вы"
        >
          <UserRound className="h-3 w-3" />
          Мои
        </button>
      )}

      {/* Канбану нужен столбец-статус, таблице и карточкам — нет. На телефоне
          сегмент видов нужен под пальцем, на десктопе он в «⋯». Активный вид —
          акцентной подложкой, а не variant="secondary": тот теперь bg-muted и на
          чёрном почти не отличим от ghost. */}
      <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-border p-0.5 sm:hidden">
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={viewMode === "table"}
          className={cn("h-7 min-w-0 gap-1.5 rounded-sm px-2.5", viewMode === "table" && SEGMENT_ACTIVE)}
          onClick={() => onViewModeChange("table")}
          title="Таблица"
        >
          <Table2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={viewMode === "cards"}
          className={cn("h-7 min-w-0 gap-1.5 rounded-sm px-2.5", viewMode === "cards" && SEGMENT_ACTIVE)}
          onClick={() => onViewModeChange("cards")}
          title="Карточки"
        >
          <LayoutList className="h-3.5 w-3.5" />
        </Button>
        {hasStatusColumn && (
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={viewMode === "kanban"}
            className={cn("h-7 min-w-0 gap-1.5 rounded-sm px-2.5", viewMode === "kanban" && SEGMENT_ACTIVE)}
            onClick={() => onViewModeChange("kanban")}
            title="Канбан"
          >
            <Kanban className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {hasActiveFilters && onResetFilters && (
        <Button
          variant="ghost"
          size="sm"
          className="h-9 shrink-0 gap-1 px-2 text-muted-foreground hover:text-foreground sm:h-8"
          onClick={onResetFilters}
          title="Сбросить поиск, фильтры, группировку и сортировку"
        >
          <X className="h-3.5 w-3.5" />
          <span className="hidden md:inline">Сбросить</span>
        </Button>
      )}

      <div className="hidden flex-1 sm:block" />

      {/* Подсветку новых заказов снимает только сам технарь — до этого чип
          висит и показывает, сколько строк приехало с «Заказов». Янтарный
          текст без заливки: один акцент на экране — бирюзовый. */}
      {highlightCount > 0 && onClearHighlights && (
        <button
          type="button"
          onClick={onClearHighlights}
          className="inline-flex h-9 shrink-0 items-center whitespace-nowrap px-1 text-[12px] text-warning hover:underline sm:h-8"
          title="Снять подсветку с новых заказов"
        >
          {highlightCount} {highlightCount === 1 ? "новый" : "новых"} · снять
        </button>
      )}

      {canEdit && onQuickOrder && quickOrderButton && (
        <button
          type="button"
          onClick={onQuickOrder}
          className={cn(CHIP_CLASS, CHIP_IDLE)}
          title="Быстрый заказ в открытую вкладку"
        >
          <ClipboardList className="h-3.5 w-3.5" />
          <span className="hidden xs:inline">Заказ</span>
        </button>
      )}

      {canEdit && canAddRows && (
        <Button
          variant="ghost"
          size="sm"
          className="sticky right-0 z-20 ml-1 h-10 shrink-0 gap-1.5 bg-background text-muted-foreground shadow-[-8px_0_8px_-4px_hsl(0_0%_2%)] hover:text-foreground sm:static sm:ml-0 sm:h-8 sm:bg-transparent sm:shadow-none"
          onClick={onAddRow}
          title="Добавить строку: сначала заполняется первая пустая, иначе новая в конце (Ctrl+Enter — под выделенной)"
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden xs:inline">Строка</span>
        </Button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" className="relative h-10 w-10 shrink-0 border-border sm:h-8 sm:w-8" title="Ещё">
            <MoreHorizontal className="h-4 w-4" />
            {hiddenColumnCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">
                {hiddenColumnCount}
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          {/* Сегмент видов на десктопе живёт здесь (на телефоне — в строке). */}
          <DropdownMenuLabel className="hidden sm:block">Вид</DropdownMenuLabel>
          {(["table", "cards", "kanban"] as TableViewMode[])
            .filter((mode) => mode !== "kanban" || hasStatusColumn)
            .map((mode) => (
              <DropdownMenuItem key={mode} onClick={() => onViewModeChange(mode)} className="hidden sm:flex">
                {mode === "table" ? (
                  <Table2 className="h-3.5 w-3.5" />
                ) : mode === "cards" ? (
                  <LayoutList className="h-3.5 w-3.5" />
                ) : (
                  <Kanban className="h-3.5 w-3.5" />
                )}
                {VIEW_MODE_LABELS[mode]}
                {viewMode === mode && <Check className="ml-auto h-3.5 w-3.5 opacity-70" />}
              </DropdownMenuItem>
            ))}
          <DropdownMenuSeparator className="hidden sm:block" />

          {showStatusChips && onStatusFilterChange && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Palette className="h-3.5 w-3.5" />
                Статус
                {statusFilter && statusFilter !== NOT_DONE_STATUS_FILTER
                  ? ": " + (allStatusOptions.find((o) => o.value === statusFilter)?.label ?? statusFilter)
                  : ""}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-56">
                <DropdownMenuItem onClick={() => onStatusFilterChange(null)}>
                  Все{!statusFilter && <Check className="ml-auto h-3.5 w-3.5 opacity-70" />}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {allStatusOptions.map((opt) => {
                  const n = statusCounts?.[opt.value];
                  const active = statusFilter === opt.value;
                  return (
                    <DropdownMenuItem key={opt.value} onClick={() => onStatusFilterChange(active ? null : opt.value)}>
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: `hsl(${opt.color})` }} />
                      <span className="truncate">{opt.label}</span>
                      {typeof n === "number" && n > 0 ? <span className="ml-auto opacity-60">{n}</span> : null}
                      {active && <Check className={cn("h-3.5 w-3.5 opacity-70", !(typeof n === "number" && n > 0) && "ml-auto")} />}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}

          {canFilterMine && onMineOnlyChange && (
            <DropdownMenuItem onClick={() => onMineOnlyChange(!mineOnly)} className="hidden sm:flex">
              <UserRound className="h-3.5 w-3.5" /> Мои
              {mineOnly && <Check className="ml-auto h-3.5 w-3.5 opacity-70" />}
            </DropdownMenuItem>
          )}

          {onSaveView && onApplyView && onDeleteView && (
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
          )}

          {viewMode === "table" && (
            <>
              <DropdownMenuSeparator />
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
            </>
          )}

          {/* Скрытые столбцы: раньше цветная кнопка в строке, теперь подменю —
              единственная цветная рамка в тулбаре должна быть у активного чипа. */}
          {hiddenColumnCount > 0 && onShowColumn && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Eye className="h-3.5 w-3.5" /> Скрыто столбцов: {hiddenColumnCount}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {hiddenColumns.map((c) => (
                  <DropdownMenuItem key={c.id} onClick={() => onShowColumn(c.key)}>
                    <Eye className="h-3.5 w-3.5" /> {c.label || "Без названия"}
                  </DropdownMenuItem>
                ))}
                {hiddenColumnCount > 1 && onShowAllColumns && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={onShowAllColumns}>Показать все</DropdownMenuItem>
                  </>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}

          {/* Резервный вход в быстрый заказ: кнопка живёт в шапке стола, а
              шапка на весь экран скрыта — из меню заказ доступен всегда. */}
          {canEdit && onQuickOrder && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onQuickOrder}>
                <ClipboardList className="h-3.5 w-3.5" /> Быстрый заказ
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
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
          {/* Отменить/вернуть — здесь на всех экранах; хоткеи Ctrl+Z/Ctrl+Y
              живут в GlobalUndoHotkeys и от кнопок не зависят. */}
          {canEdit && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void undo()} disabled={!undoState.canUndo}>
                <Undo2 className="h-3.5 w-3.5" /> Отменить
                {undoState.canUndo && undoState.undoCount > 0 ? (
                  <span className="ml-auto text-[10px] opacity-60">{undoState.undoCount}</span>
                ) : null}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void redo()} disabled={!undoState.canRedo}>
                <Redo2 className="h-3.5 w-3.5" /> Вернуть
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setShortcutsHelpOpen(true)}>
            <Keyboard className="h-3.5 w-3.5" /> Горячие клавиши
          </DropdownMenuItem>
          {countLabel && (
            <DropdownMenuLabel className="font-mono text-[10px] font-normal uppercase tracking-[0.12em] text-muted-foreground">
              {countLabel} стр.
            </DropdownMenuLabel>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
