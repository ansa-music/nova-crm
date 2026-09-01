import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/utils/cn";

interface GroupHeaderRowProps {
  label: string;
  count: number;
  colSpan: number;
  collapsed: boolean;
  onToggle: () => void;
  color?: string;
  /** Pre-formatted currency total for the group, if the table has a money column. */
  sumText?: string | null;
  /** Pre-formatted «Готово» share of that total. */
  doneText?: string | null;
}

export function GroupHeaderRow({ label, count, colSpan, collapsed, onToggle, color, sumText, doneText }: GroupHeaderRowProps) {
  return (
    <tr className="table-group-row">
      <td colSpan={colSpan + 1} className="table-group-cell border-b border-border p-0">
        <button
          type="button"
          onClick={onToggle}
          className="table-group-toggle flex items-center gap-2 px-3 py-2 text-left text-sm font-medium"
          style={color ? ({ "--group-color": color } as React.CSSProperties) : undefined}
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
          {color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: `hsl(${color})` }} />}
          <span className={cn("min-w-0 truncate", !label && "italic text-muted-foreground")}>{label || "Без значения"}</span>
          <span className="tabular shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {count}
          </span>
          {sumText && (
            <span className="ml-auto flex shrink-0 items-center gap-2 pl-3 text-[12px] font-normal tabular-nums text-muted-foreground">
              <span title="Сумма по группе">{sumText}</span>
              {doneText && (
                <span className="text-success" title="Из них «Готово»">
                  ✓ {doneText}
                </span>
              )}
            </span>
          )}
        </button>
      </td>
    </tr>
  );
}
