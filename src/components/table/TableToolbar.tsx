import { useState } from "react";
import { Download, Plus, Search, Rows3, Columns3, Table2, Kanban, MoreHorizontal, Palette, SlidersHorizontal, Eye } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
import { NOT_DONE_STATUS_FILTER } from "@/utils/columnOptions";
import type { PageColumn, StatusOption } from "@/types";

interface TableToolbarProps {
  columns: PageColumn[];
  searchQuery: string;
  onSearchChange: (value: string) => void;
  groupByKey: string | null;
  onGroupByChange: (key: string | null) => void;
  density: "compact" | "default" | "comfortable";
  onDensityChange: (density: "compact" | "default" | "comfortable") => void;
  onAddRow: () => void;
  onExportCsv: () => void;
  canEdit: boolean;
  canEditStructure: boolean;
  onAddColumn: () => void;
  onOpenSchema?: () => void;
  onManageStatuses?: () => void;
  canManageStatuses?: boolean;
  selectedCount: number;
  onDeleteSelected: () => void;
  hasStatusColumn: boolean;
  statusOptions?: StatusOption[];
  statusFilter?: string | null;
  onStatusFilterChange?: (value: string | null) => void;
  viewMode: "table" | "kanban";
  onViewModeChange: (mode: "table" | "kanban") => void;
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
  groupByKey,
  onGroupByChange,
  density,
  onDensityChange,
  onAddRow,
  onExportCsv,
  canEdit,
  canEditStructure,
  onAddColumn,
  onOpenSchema,
  onManageStatuses,
  canManageStatuses,
  selectedCount: _selectedCount,
  onDeleteSelected: _onDeleteSelected,
  hasStatusColumn,
  statusOptions,
  statusFilter,
  onStatusFilterChange,
  viewMode,
  onViewModeChange,
}: TableToolbarProps) {
  const [searchOpen, setSearchOpen] = useState(Boolean(searchQuery));
  // A hidden column disappears from the table entirely — its own header
  // (and the "Показать столбец" toggle on it) goes with it — so the ONLY
  // way back is this menu's "Столбцы" entry. Badge the trigger whenever
  // something's hidden, otherwise it's undiscoverable.
  const hiddenColumnCount = columns.filter((c) => c.hidden).length;

  const searchExpanded = searchOpen || Boolean(searchQuery);

  return (
    <div className="z-10 flex h-12 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-primary/25 bg-background px-2 sm:h-auto sm:flex-wrap sm:gap-2 sm:overflow-visible sm:px-4 sm:py-2">
      <div
        className={cn(
          "relative min-w-0",
          searchExpanded ? "flex-1 sm:w-56 sm:flex-none" : "w-10 shrink-0 sm:w-56 sm:flex-none"
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
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Поиск"
            className="h-9 rounded-md bg-background pl-8 text-sm sm:h-8"
            autoFocus={searchOpen && !searchQuery}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => {
              if (!searchQuery) setSearchOpen(false);
            }}
          />
        </div>
      </div>

      {hasStatusColumn && statusOptions && statusOptions.length > 0 && onStatusFilterChange && (
        <div className="flex min-w-0 max-w-full items-center gap-1 overflow-x-auto">
          <button
            type="button"
            onClick={() => onStatusFilterChange(null)}
            className={cn(
              "h-7 shrink-0 rounded-full border px-2.5 text-[11px] font-medium",
              !statusFilter
                ? "border-primary/40 bg-primary/12 text-primary"
                : "border-border bg-background text-muted-foreground hover:text-foreground"
            )}
          >
            Все
          </button>
          <button
            type="button"
            onClick={() =>
              onStatusFilterChange(statusFilter === NOT_DONE_STATUS_FILTER ? null : NOT_DONE_STATUS_FILTER)
            }
            className={cn(
              "h-7 shrink-0 rounded-full border px-2.5 text-[11px] font-medium",
              statusFilter === NOT_DONE_STATUS_FILTER
                ? "border-primary/40 bg-primary/12 text-primary"
                : "border-border bg-background text-muted-foreground hover:text-foreground"
            )}
          >
            Не готово
          </button>
          {statusOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onStatusFilterChange(statusFilter === opt.value ? null : opt.value)}
              className={cn(
                "hidden h-7 shrink-0 rounded-full border px-2.5 text-[11px] font-medium sm:inline-flex",
                statusFilter === opt.value
                  ? "border-primary/40 bg-primary/12 text-primary"
                  : "border-border bg-background text-muted-foreground hover:text-foreground"
              )}
              style={
                statusFilter === opt.value
                  ? {
                      backgroundColor: `hsl(${opt.color} / 0.16)`,
                      color: `hsl(${opt.color})`,
                      borderColor: `hsl(${opt.color} / 0.28)`,
                    }
                  : undefined
              }
            >
              {opt.label}
            </button>
          ))}
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

      {/* Hiding a column removes its own header — and the "Показать столбец"
          toggle on it — from the table entirely, so burying the way back in
          a menu made it effectively unrecoverable in practice. This button
          only exists when something IS hidden, so it adds no clutter the
          rest of the time, but the moment it matters it's a single visible,
          impossible-to-miss button — not one more line in "Ещё". */}
      {canEditStructure && hiddenColumnCount > 0 && (
        <Button
          variant="outline"
          size="sm"
          className="h-8 shrink-0 gap-1.5 border-primary/50 bg-primary/10 text-primary hover:bg-primary/15"
          onClick={onOpenSchema ?? onAddColumn}
          title={`Скрытых столбцов: ${hiddenColumnCount} — нажмите, чтобы вернуть`}
        >
          <Eye className="h-3.5 w-3.5" />
          <span className="hidden xs:inline">Скрыто: {hiddenColumnCount}</span>
          <span className="xs:hidden">{hiddenColumnCount}</span>
        </Button>
      )}

      <div className="hidden flex-1 sm:block" />

      {/* Everything else — grouping, plotность, CSV, столбцы, статусы —
          lives behind one menu on every screen size. Nine always-visible
          buttons made the toolbar noisy and, on narrow screens, pushed the
          one button people actually reach for (Строка) out of view. One
          entry point, same features, none of them lost. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" className="relative h-10 w-10 shrink-0 sm:h-8 sm:w-8" title="Ещё">
            <MoreHorizontal className="h-4 w-4" />
            {hiddenColumnCount > 0 && (
              <span
                className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground"
                title={`Скрытых столбцов: ${hiddenColumnCount}`}
              >
                {hiddenColumnCount}
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {viewMode === "table" && (
            <>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Группировка{groupByKey ? ": " + (columns.find((c) => c.key === groupByKey)?.label ?? "") : ""}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={() => onGroupByChange(null)}>Без группировки</DropdownMenuItem>
                  {columns.map((c) => (
                    <DropdownMenuItem key={c.id} onClick={() => onGroupByChange(c.key)}>
                      {c.label}
                      {groupByKey === c.key && " ✓"}
                    </DropdownMenuItem>
                  ))}
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
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onClick={onExportCsv}>
            <Download className="h-3.5 w-3.5" /> CSV
          </DropdownMenuItem>
          {canEditStructure && (
            <>
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
        </DropdownMenuContent>
      </DropdownMenu>

      {canEdit && (
        // Sticky to the scroll container's right edge: on a phone this toolbar
        // scrolls horizontally (status chips before it), so without this the
        // single most-used button could sit off-screen with no visual hint to
        // scroll for it. Sticky keeps it reachable at any scroll position;
        // sm:static drops the pinning once the toolbar wraps instead of
        // scrolling.
        <Button
          size="sm"
          className="sticky right-0 z-20 ml-1 h-10 shrink-0 gap-1.5 shadow-[-8px_0_8px_-4px_hsl(222_55%_6%)] sm:static sm:ml-0 sm:h-8 sm:shadow-none"
          onClick={onAddRow}
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden xs:inline sm:inline">Строка</span>
        </Button>
      )}
    </div>
  );
}
