import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/utils/cn";

interface GroupHeaderRowProps {
  label: string;
  count: number;
  colSpan: number;
  collapsed: boolean;
  onToggle: () => void;
  color?: string;
}

export function GroupHeaderRow({ label, count, colSpan, collapsed, onToggle, color }: GroupHeaderRowProps) {
  return (
    <tr>
      <td colSpan={colSpan + 1} className="border-b border-border bg-muted/40 p-0">
        <button
          onClick={onToggle}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium hover:bg-muted/70"
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {color && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: `hsl(${color})` }} />}
          <span className={cn(!label && "italic text-muted-foreground")}>{label || "Без значения"}</span>
          <span className="text-xs font-normal text-muted-foreground">{count}</span>
        </button>
      </td>
    </tr>
  );
}
