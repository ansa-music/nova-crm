import { Download, Plus, Search, Rows3, Columns3, Table2, Kanban, MoreHorizontal, Palette, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/utils/cn";
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
  const extraMenu = (
    <>
      {viewMode === "table" && (
        <>
          {columns.map((c) => (
            <DropdownMenuItem key={c.id} onClick={() => onGroupByChange(c.key)}>
              Группировать: {c.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onClick={() => onGroupByChange(null)}>Без группировки</DropdownMenuItem>
          <DropdownMenuSeparator />
          {(Object.keys(DENSITY_LABELS) as TableToolbarProps["density"][]).map((d) => (
            <DropdownMenuItem key={d} onClick={() => onDensityChange(d)}>
              {DENSITY_LABELS[d]}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
        </>
      )}
      {hasStatusColumn && (
        <>
          <DropdownMenuItem onClick={() => onViewModeChange("table")}>Таблица</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onViewModeChange("kanban")}>Канбан</DropdownMenuItem>
          <DropdownMenuSeparator />
        </>
      )}
      <DropdownMenuItem onClick={onExportCsv}>
        <Download className="h-3.5 w-3.5" /> CSV
      </DropdownMenuItem>
      {canEditStructure && (
        <DropdownMenuItem onClick={onAddColumn}>
          <Columns3 className="h-3.5 w-3.5" /> Столбец
        </DropdownMenuItem>
      )}
    </>
  );

  return (
    <div className="z-10 flex h-12 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border bg-card px-2 sm:h-auto sm:flex-wrap sm:gap-2 sm:overflow-visible sm:px-4 sm:py-2">
      <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Поиск по таблице…"
          className="h-10 rounded-md bg-background pl-8 sm:h-8"
        />
      </div>

      {hasStatusColumn && statusOptions && statusOptions.length > 0 && onStatusFilterChange && (
        <div className="hidden min-w-0 max-w-full items-center gap-1 overflow-x-auto sm:flex">
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
          {statusOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onStatusFilterChange(statusFilter === opt.value ? null : opt.value)}
              className={cn(
                "h-7 shrink-0 rounded-full border px-2.5 text-[11px] font-medium",
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

      {viewMode === "table" && (
        <div className="hidden items-center gap-2 sm:flex">
          <Select value={groupByKey ?? "__none__"} onValueChange={(v) => onGroupByChange(v === "__none__" ? null : v)}>
            <SelectTrigger className="h-8 w-44 rounded-md">
              <SelectValue placeholder="Группировка" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Без группировки</SelectItem>
              {columns.map((c) => (
                <SelectItem key={c.id} value={c.key}>
                  По полю «{c.label}»
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 bg-background">
                <Rows3 className="h-3.5 w-3.5" /> {DENSITY_LABELS[density]}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {(Object.keys(DENSITY_LABELS) as TableToolbarProps["density"][]).map((d) => (
                <DropdownMenuItem key={d} onClick={() => onDensityChange(d)}>
                  {DENSITY_LABELS[d]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {hasStatusColumn && (
        <div className="hidden items-center gap-0.5 rounded-full border border-border bg-background p-0.5 sm:flex">
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

      <div className="hidden flex-1 sm:block" />

      <Button variant="outline" size="sm" className="hidden h-8 gap-1.5 bg-background sm:inline-flex" onClick={onExportCsv}>
        <Download className="h-3.5 w-3.5" /> CSV
      </Button>

      {canEditStructure && (
        <>
          <Button variant="outline" size="sm" className="hidden h-8 gap-1.5 bg-background sm:inline-flex" onClick={onOpenSchema ?? onAddColumn}>
            <SlidersHorizontal className="h-3.5 w-3.5" /> Столбцы
          </Button>
          {canManageStatuses && (
          <Button variant="outline" size="sm" className="hidden h-8 gap-1.5 bg-background sm:inline-flex" onClick={onManageStatuses}>
            <Palette className="h-3.5 w-3.5" /> Статусы
          </Button>
          )}
          <Button variant="outline" size="sm" className="hidden h-8 gap-1.5 bg-background sm:inline-flex" onClick={onAddColumn}>
            <Columns3 className="h-3.5 w-3.5" /> Столбец
          </Button>
        </>
      )}

      {canEditStructure && (
        <>
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10 shrink-0 sm:hidden"
            onClick={onOpenSchema ?? onAddColumn}
            title="Столбцы"
          >
            <SlidersHorizontal className="h-4 w-4" />
          </Button>
          {canManageStatuses && (
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10 shrink-0 sm:hidden"
            onClick={onManageStatuses}
            title="Статусы"
          >
            <Palette className="h-4 w-4" />
          </Button>
          )}
        </>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" className="h-10 w-10 shrink-0 sm:hidden" title="Ещё">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">{extraMenu}</DropdownMenuContent>
      </DropdownMenu>

      {canEdit && (
        <Button size="sm" className="h-10 shrink-0 gap-1.5 sm:h-8" onClick={onAddRow}>
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden xs:inline sm:inline">Строка</span>
        </Button>
      )}
    </div>
  );
}
