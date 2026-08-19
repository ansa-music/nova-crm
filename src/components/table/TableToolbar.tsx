import { Download, Plus, Search, Rows3, Columns3 } from "lucide-react";
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
  selectedCount,
  onDeleteSelected,
}: TableToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card/60 px-4 py-2.5">
      <div className="relative w-full sm:w-64">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Поиск по таблице…"
          className="h-8 rounded-md bg-background pl-8 shadow-none"
        />
      </div>

      <Select value={groupByKey ?? "__none__"} onValueChange={(v) => onGroupByChange(v === "__none__" ? null : v)}>
        <SelectTrigger className="h-8 w-44">
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

      <div className="flex-1" />

      {selectedCount > 0 && (
        <Button variant="destructive" size="sm" className="h-8" onClick={onDeleteSelected}>
          Удалить выбранные ({selectedCount})
        </Button>
      )}

      <Button variant="outline" size="sm" className="h-8 gap-1.5 bg-background" onClick={onExportCsv}>
        <Download className="h-3.5 w-3.5" /> CSV
      </Button>

      {canEditStructure && (
        <Button variant="outline" size="sm" className="h-8 gap-1.5 bg-background" onClick={onAddColumn}>
          <Columns3 className="h-3.5 w-3.5" /> Столбец
        </Button>
      )}

      {canEdit && (
        <Button size="sm" className="h-8 gap-1.5" onClick={onAddRow}>
          <Plus className="h-3.5 w-3.5" /> Строка
        </Button>
      )}
    </div>
  );
}
