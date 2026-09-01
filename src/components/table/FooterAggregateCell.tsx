import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AGGREGATE_LABELS, type AggregateKind, type AggregateResult } from "@/utils/columnAggregates";
import { cn } from "@/utils/cn";
import type { PageColumn } from "@/types";

interface FooterAggregateCellProps {
  column: PageColumn;
  kind: AggregateKind;
  result: AggregateResult | null;
  choices: AggregateKind[];
  onChange: (kind: AggregateKind) => void;
  stickyLeft?: number;
  isLastSticky?: boolean;
  isFirst?: boolean;
}

/**
 * One footer cell. Click → pick what this column summarises; the choice
 * sticks per view in localStorage. Shows "Итого" as a hint in the first
 * column when nothing is selected there, and a quiet "+" affordance on
 * hover everywhere else so the feature is discoverable.
 */
export function FooterAggregateCell({
  column,
  kind,
  result,
  choices,
  onChange,
  stickyLeft,
  isLastSticky,
  isFirst,
}: FooterAggregateCellProps) {
  const isNumeric = column.type === "number" || column.type === "currency";
  return (
    <td
      className={cn(
        "table-footer-cell group/footer overflow-visible whitespace-normal border-r border-border/35 p-0 text-sm leading-tight tabular-nums",
        stickyLeft !== undefined ? "table-sticky-col sticky z-[25] bg-background" : "bg-background",
        isLastSticky && "table-sticky-edge"
      )}
      style={{ width: column.width, minWidth: column.width, left: stickyLeft }}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex h-full min-h-[38px] w-full items-center gap-1 px-2 py-1.5 text-left outline-none hover:bg-primary/8 focus-visible:bg-primary/8",
              isNumeric ? "justify-end" : "justify-start"
            )}
            title={result?.title ?? "Выбрать, что показывать в итоге столбца"}
          >
            {result ? (
              <span className="flex min-w-0 flex-col items-end">
                <span className="text-[9px] font-medium uppercase tracking-[0.12em] text-muted-foreground/80">
                  {AGGREGATE_LABELS[result.kind]}
                </span>
                <span className="block max-w-full truncate text-[13px] font-semibold">{result.text}</span>
              </span>
            ) : isFirst ? (
              <span className="text-[12px] text-muted-foreground">Итого</span>
            ) : (
              <span className="text-[11px] text-muted-foreground/0 group-hover/footer:text-muted-foreground">Σ</span>
            )}
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 group-hover/footer:opacity-100" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={isNumeric ? "end" : "start"} className="w-48">
          <DropdownMenuLabel className="truncate">{column.label}</DropdownMenuLabel>
          {choices.map((c) => (
            <DropdownMenuItem key={c} onClick={() => onChange(c)}>
              {AGGREGATE_LABELS[c]}
              {kind === c && <span className="ml-auto text-primary">✓</span>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </td>
  );
}
