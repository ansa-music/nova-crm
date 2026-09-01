import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/utils/cn";

export interface FilterValueEntry {
  /** Raw stored cell value — what the filter set is keyed on. */
  value: string;
  /** What the person sees (option label, formatted date, raw text). */
  label: string;
  /** How many rows (in the unfiltered set) carry this value. */
  count: number;
  /** Swatch for option columns. */
  color?: string;
}

interface FilterPopoverProps {
  x: number;
  y: number;
  columnLabel: string;
  values: FilterValueEntry[];
  excluded: Set<string>;
  onToggleValue: (value: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onInvert: () => void;
  onOnlyValue: (value: string) => void;
  onClose: () => void;
}

export function FilterPopover({
  x,
  y,
  columnLabel,
  values,
  excluded,
  onToggleValue,
  onSelectAll,
  onSelectNone,
  onInvert,
  onOnlyValue,
  onClose,
}: FilterPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey, true);
    const t = window.setTimeout(() => searchRef.current?.focus(), 30);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey, true);
      window.clearTimeout(t);
    };
  }, [onClose]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return values;
    return values.filter((v) => (v.label || "(пусто)").toLowerCase().includes(q));
  }, [values, query]);

  const activeCount = values.length - excluded.size;
  const hasFilter = excluded.size > 0;

  return (
    <div
      ref={ref}
      style={{ top: y, left: x }}
      className="glass-float animate-glass-pop fixed z-[60] flex w-64 flex-col rounded-md text-popover-foreground"
      role="dialog"
      aria-label={`Фильтр: ${columnLabel}`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div className="min-w-0">
          <p className="eyebrow truncate">Фильтр</p>
          <p className="truncate text-[13px] font-medium">{columnLabel}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Закрыть"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {values.length > 6 && (
        <div className="relative px-2 pt-2">
          <Search className="pointer-events-none absolute left-4 top-1/2 mt-1 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Найти значение"
            className="h-8 w-full rounded-md border border-primary/20 bg-white/[0.03] pl-8 pr-2 text-xs outline-none placeholder:text-muted-foreground focus:border-primary"
          />
        </div>
      )}

      <div className="flex items-center gap-1 px-2 pt-2 text-[11px]">
        <button type="button" onClick={onSelectAll} className="rounded px-1.5 py-0.5 text-primary hover:bg-primary/10">
          Все
        </button>
        <button type="button" onClick={onSelectNone} className="rounded px-1.5 py-0.5 text-primary hover:bg-primary/10">
          Ничего
        </button>
        <button type="button" onClick={onInvert} className="rounded px-1.5 py-0.5 text-primary hover:bg-primary/10">
          Инвертировать
        </button>
        <span className="ml-auto tabular-nums text-muted-foreground">
          {activeCount}/{values.length}
        </span>
      </div>

      <div className="mt-1 max-h-60 overflow-y-auto border-t border-border/60 px-1 py-1 scrollbar-thin">
        {shown.length === 0 && <div className="px-2 py-3 text-xs text-muted-foreground">Нет значений</div>}
        {shown.map((entry) => {
          const checked = !excluded.has(entry.value);
          return (
            <div
              key={entry.value || "__empty__"}
              className="group/filter flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-accent"
            >
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggleValue(entry.value)}
                  className="h-3.5 w-3.5 shrink-0 accent-[hsl(var(--primary))]"
                />
                {entry.color && (
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: `hsl(${entry.color})` }} />
                )}
                <span className={cn("min-w-0 flex-1 truncate", !entry.label && "italic text-muted-foreground")}>
                  {entry.label || "(пусто)"}
                </span>
              </label>
              <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground group-hover/filter:hidden">
                {entry.count}
              </span>
              <button
                type="button"
                onClick={() => onOnlyValue(entry.value)}
                className="hidden shrink-0 rounded px-1 text-[10px] text-primary hover:bg-primary/10 group-hover/filter:inline"
                title="Показать только это значение"
              >
                только
              </button>
            </div>
          );
        })}
      </div>

      {hasFilter && (
        <div className="border-t border-border/60 px-2 py-1.5">
          <button
            type="button"
            onClick={() => {
              onSelectAll();
              onClose();
            }}
            className="w-full rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Сбросить фильтр столбца
          </button>
        </div>
      )}
    </div>
  );
}
