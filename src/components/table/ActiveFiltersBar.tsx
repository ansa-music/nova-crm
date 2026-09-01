import { ArrowDownAZ, ArrowUpAZ, CalendarDays, Filter, Layers, Search, UserRound, X } from "lucide-react";
import { cn } from "@/utils/cn";

export interface ActiveFilterChip {
  id: string;
  kind: "search" | "status" | "column" | "group" | "sort" | "date" | "mine";
  label: string;
  /** Extra hint such as the excluded values. */
  detail?: string;
  color?: string;
  onRemove: () => void;
  onClick?: () => void;
}

interface ActiveFiltersBarProps {
  chips: ActiveFilterChip[];
  visibleCount: number;
  totalCount: number;
  onClearAll: () => void;
}

const ICONS = {
  search: Search,
  status: Filter,
  column: Filter,
  group: Layers,
  sort: ArrowDownAZ,
  date: CalendarDays,
  mine: UserRound,
} as const;

/**
 * Everything that currently narrows or reorders the table, as removable
 * chips — so "why do I only see 12 rows?" always has a visible answer and
 * a one-tap fix. Renders nothing when the view is untouched.
 */
export function ActiveFiltersBar({ chips, visibleCount, totalCount, onClearAll }: ActiveFiltersBarProps) {
  if (chips.length === 0) return null;
  return (
    <div className="table-filter-bar flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border/60 px-2 py-1.5 scrollbar-thin sm:px-4">
      <span className="hidden shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground sm:inline">
        {visibleCount === totalCount ? `${totalCount} строк` : `${visibleCount} из ${totalCount}`}
      </span>
      {chips.map((chip) => {
        const Icon = chip.kind === "sort" && chip.detail === "desc" ? ArrowUpAZ : ICONS[chip.kind];
        return (
          <span
            key={chip.id}
            className={cn(
              "table-filter-chip inline-flex h-7 max-w-[260px] shrink-0 items-center gap-1 rounded-full border pl-2 pr-1 text-[11px] font-medium",
              chip.kind === "status" && chip.color ? "" : "border-primary/30 bg-primary/10 text-primary"
            )}
            style={
              chip.kind === "status" && chip.color
                ? { backgroundColor: `hsl(${chip.color} / 0.16)`, color: `hsl(${chip.color})`, borderColor: `hsl(${chip.color} / 0.3)` }
                : undefined
            }
          >
            <Icon className="h-3 w-3 shrink-0 opacity-80" />
            <button
              type="button"
              onClick={chip.onClick}
              className={cn("min-w-0 truncate", chip.onClick && "hover:underline")}
              title={chip.detail && chip.kind !== "sort" ? chip.detail : chip.label}
            >
              {chip.label}
            </button>
            <button
              type="button"
              onClick={chip.onRemove}
              className="ml-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full hover:bg-black/20"
              aria-label={`Убрать: ${chip.label}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        );
      })}
      <button
        type="button"
        onClick={onClearAll}
        className="ml-auto h-7 shrink-0 rounded-full px-2.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        Сбросить всё
      </button>
    </div>
  );
}
