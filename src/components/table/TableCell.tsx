import { useEffect, useRef } from "react";
import { StatusBadge } from "@/components/table/StatusBadge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency } from "@/utils/format";
import { cn } from "@/utils/cn";
import type { PageColumn } from "@/types";

interface TableCellProps {
  column: PageColumn;
  value: string | number | null;
  isActive: boolean;
  isInRange: boolean;
  isEditing: boolean;
  editValue: string;
  canEdit: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseEnter: () => void;
  onDoubleClick: () => void;
  onEditValueChange: (value: string) => void;
  onCommitEdit: (direction?: "down" | "right" | "none") => void;
  onCancelEdit: () => void;
  onStatusChange: (value: string) => void;
  stickyLeft?: number;
}

export function TableCell({
  column,
  value,
  isActive,
  isInRange,
  isEditing,
  editValue,
  canEdit,
  onMouseDown,
  onMouseEnter,
  onDoubleClick,
  onEditValueChange,
  onCommitEdit,
  onCancelEdit,
  onStatusChange,
  stickyLeft,
}: TableCellProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const isNumeric = column.type === "number" || column.type === "currency";
  const stringValue = value === null || value === undefined ? "" : String(value);

  function renderDisplay() {
    if (column.type === "status") {
      return <StatusBadge value={stringValue} options={column.statusOptions ?? []} />;
    }
    if (column.type === "currency" && stringValue) {
      return <span className="tabular-nums">{formatCurrency(Number(stringValue))}</span>;
    }
    return <span className="truncate">{stringValue}</span>;
  }

  return (
    <td
      className={cn(
        "relative select-none border-b border-r border-border/70 p-0 align-middle transition-colors",
        stickyLeft !== undefined && "sticky z-[15] bg-background",
        isInRange && !isEditing && "bg-primary/[0.07]",
        isActive && !isEditing && "outline outline-2 outline-primary -outline-offset-1 z-10"
      )}
      style={{
        width: column.width,
        minWidth: column.width,
        maxWidth: column.width,
        height: "100%",
        left: stickyLeft,
      }}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      onDoubleClick={onDoubleClick}
      data-col={column.key}
    >
      {column.type === "status" ? (
        <Select
          value={stringValue || undefined}
          onValueChange={(v) => onStatusChange(v === "__clear__" ? "" : v)}
          disabled={!canEdit}
        >
          <SelectTrigger className="h-full w-full rounded-none border-0 bg-transparent px-2 shadow-none focus:ring-0">
            <SelectValue placeholder="">{renderDisplay()}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(column.statusOptions ?? []).map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                <StatusBadge value={opt.value} options={column.statusOptions ?? []} />
              </SelectItem>
            ))}
            <SelectItem value="__clear__" className="text-muted-foreground">
              Очистить
            </SelectItem>
          </SelectContent>
        </Select>
      ) : isEditing ? (
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => onEditValueChange(e.target.value)}
          onBlur={() => onCommitEdit("none")}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onCommitEdit("down");
            } else if (e.key === "Tab") {
              e.preventDefault();
              onCommitEdit("right");
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancelEdit();
            }
          }}
          className={cn(
            "h-full w-full border-0 bg-background px-2.5 text-sm outline-none ring-2 ring-primary",
            isNumeric && "text-right tabular-nums"
          )}
        />
      ) : (
        <div
          className={cn(
            "flex h-full w-full items-center px-2.5 text-sm leading-none",
            isNumeric && "justify-end tabular-nums"
          )}
          title={stringValue}
        >
          {renderDisplay()}
        </div>
      )}
    </td>
  );
}
