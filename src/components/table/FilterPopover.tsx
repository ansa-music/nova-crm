import { useEffect, useRef } from "react";

interface FilterPopoverProps {
  x: number;
  y: number;
  values: string[];
  excluded: Set<string>;
  onToggleValue: (value: string) => void;
  onSelectAll: () => void;
  onClose: () => void;
}

export function FilterPopover({ x, y, values, excluded, onToggleValue, onSelectAll, onClose }: FilterPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{ top: y, left: x }}
      className="fixed z-50 w-56 rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-popover"
    >
      <button onClick={onSelectAll} className="mb-1 text-xs text-primary hover:underline">
        Выбрать все
      </button>
      <div className="max-h-52 overflow-y-auto border-t border-border pt-1 scrollbar-thin">
        {values.length === 0 && <div className="px-1 py-2 text-xs text-muted-foreground">Нет значений</div>}
        {values.map((value) => {
          const checked = !excluded.has(value);
          return (
            <label key={value || "__empty__"} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-accent">
              <input type="checkbox" checked={checked} onChange={() => onToggleValue(value)} className="h-3.5 w-3.5" />
              <span className="truncate">{value || "(пусто)"}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
