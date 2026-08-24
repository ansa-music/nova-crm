import { Download, Plus, Search, Rows3, Columns3, Table2, Kanban } from "lucide-react";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PageColumn } from "@/types";

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
  selectedCount: number;
  onDeleteSelected: () => void;
  /** Only pages with a "Статус" column can switch to the kanban view — otherwise there's nothing to group by. */
  hasStatusColumn: boolean;
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
  selectedCount: _selectedCount,
  onDeleteSelected: _onDeleteSelected,
  hasStatusColumn,
  viewMode,
  onViewModeChange,
}: TableToolbarProps) {
  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border/70 bg-card/90 px-4 py-2">
      <div className="relative w-full sm:w-64">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Поиск по таблице…"
          className="h-10 rounded-md bg-background pl-8 sm:h-8"
        />
      </div>

      {viewMode === "table" && (
        <>
          <Select value={groupByKey ?? "__none__"} onValueChange={(v) => onGroupByChange(v === "__none__" ? null : v)}>
            <SelectTrigger className="h-10 w-44 rounded-md sm:h-8">
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
              <Button variant="outline" size="sm" className="h-10 gap-1.5 bg-background sm:h-8">
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
        </>
      )}

      {hasStatusColumn && (
        <div className="flex items-center gap-0.5 rounded-full border border-border bg-background p-0.5">
          <Button
            variant={viewMode === "table" ? "secondary" : "ghost"}
            size="sm"
            className="h-10 min-w-10 gap-1.5 rounded-full px-2.5 sm:h-7 sm:min-w-0"
            onClick={() => onViewModeChange("table")}
            title="Таблица"
          >
            <Table2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant={viewMode === "kanban" ? "secondary" : "ghost"}
            size="sm"
            className="h-10 min-w-10 gap-1.5 rounded-full px-2.5 sm:h-7 sm:min-w-0"
            onClick={() => onViewModeChange("kanban")}
            title="Канбан"
          >
            <Kanban className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      <div className="flex-1" />

      <Button variant="outline" size="sm" className="h-10 gap-1.5 bg-background sm:h-8" onClick={onExportCsv}>
        <Download className="h-3.5 w-3.5" /> CSV
      </Button>

      {canEditStructure && (
        <Button variant="outline" size="sm" className="h-10 gap-1.5 bg-background sm:h-8" onClick={onAddColumn}>
          <Columns3 className="h-3.5 w-3.5" /> Столбец
        </Button>
      )}

      {canEdit && (
        <Button size="sm" className="h-10 gap-1.5 sm:h-8" onClick={onAddRow}>
          <Plus className="h-3.5 w-3.5" /> Строка
        </Button>
      )}
    </div>
  );
}
