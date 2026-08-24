import { useEffect, useRef, useState, type ReactNode } from "react";
import { CalendarDays } from "lucide-react";
import { StatusBadge } from "@/components/table/StatusBadge";
import { DiskLinkChip } from "@/components/table/DiskLinkChip";
import { DateCalendar } from "@/components/table/DateCalendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatCurrency, formatNumber } from "@/utils/format";
import { formatOrderDate } from "@/utils/date";
import { isOptionColumn } from "@/utils/columnOptions";
import { parseHttpUrl } from "@/utils/httpUrl";
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
  onStartEdit: () => void;
  onEditValueChange: (value: string) => void;
  onCommitEdit: (direction?: "down" | "right" | "left" | "none") => void;
  onCancelEdit: () => void;
  onStatusChange: (value: string) => void;
  onMarkDone?: () => void;
  onUndoLast?: () => void;
  stickyLeft?: number;
  isLastSticky?: boolean;
  isExpanded?: boolean;
  trailing?: ReactNode;
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
  onStartEdit,
  onEditValueChange,
  onCommitEdit,
  onCancelEdit,
  onStatusChange,
  onMarkDone,
  onUndoLast,
  stickyLeft,
  isLastSticky,
  isExpanded,
  trailing,
}: TableCellProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    if (!isActive) setExpanded(false);
  }, [isActive]);

  const isNumeric = column.type === "number" || column.type === "currency";
  const stringValue = value === null || value === undefined ? "" : String(value);
  const isNegative = isNumeric && stringValue !== "" && Number(stringValue) < 0;
  const diskUrl = column.type === "url" ? parseHttpUrl(stringValue) : null;
  const showFull = expanded || Boolean(isExpanded);

  function renderDisplay() {
    if (isOptionColumn(column.type)) {
      return <StatusBadge value={stringValue} options={column.statusOptions ?? []} showTick={column.type === "status"} />;
    }
    if (column.type === "currency" && stringValue) {
      return <span className={cn("tabular-nums", isNegative && "font-medium text-destructive")}>{formatCurrency(Number(stringValue))}</span>;
    }
    if (column.type === "number" && stringValue) {
      const n = Number(String(stringValue).replace(/\s/g, "").replace(",", "."));
      const shown = Number.isFinite(n) ? formatNumber(n) : stringValue;
      return <span className={cn("tabular-nums", isNegative && "font-medium text-destructive")}>{shown}</span>;
    }
    if (column.type === "date" && stringValue) {
      return <span className="truncate">{formatOrderDate(Number(stringValue))}</span>;
    }
    if (column.type === "url") {
      if (diskUrl) {
        return (
          <span className="flex min-w-0 items-center gap-1.5">
            <DiskLinkChip href={diskUrl.href} />
            {canEdit && (
              <button
                type="button"
                className="shrink-0 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                onClick={(e) => {
                  e.stopPropagation();
                  onStartEdit();
                }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                правка
              </button>
            )}
          </span>
        );
      }
      if (stringValue)
        return (
          <span className="line-clamp-2 text-[11px] leading-snug text-destructive/80" title="Нужна ссылка http(s)">
            не ссылка http(s)
          </span>
        );
      return (
        <span className="truncate text-xs text-muted-foreground/80 sm:text-[11px]">
          {canEdit ? "вставить ссылку" : "—"}
        </span>
      );
    }
    return (
      <span className={cn(isExpanded ? "whitespace-normal break-words leading-snug" : "line-clamp-2 whitespace-normal break-words leading-snug")}>
        {stringValue}
      </span>
    );
  }

  return (
    <td
      className={cn(
        "relative min-w-0 overflow-hidden select-none border-b border-r border-border/35 p-0 align-middle",
        stickyLeft !== undefined && "table-sticky-col sticky z-[22] isolate bg-background",
        isLastSticky && "table-sticky-edge",
        isInRange && !isEditing && "bg-primary/[0.07]",
        isActive && !isEditing && "z-10 shadow-[inset_0_0_0_2px_hsl(var(--primary)/0.7)]"
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
      onDoubleClick={onStartEdit}
      data-col={column.key}
    >
      {isOptionColumn(column.type) ? (
        <Select
          value={stringValue || undefined}
          onValueChange={(v) => onStatusChange(v === "__clear__" ? "" : v)}
          disabled={!canEdit}
        >
          <SelectTrigger
            className="table-status-trigger h-full min-h-11 w-full min-w-0 max-w-full overflow-hidden rounded-none border-0 bg-transparent px-2 shadow-none focus:ring-0 sm:min-h-[32px] [&>svg]:hidden"
            onDoubleClick={(e) => {
              if (!canEdit || column.type !== "status" || !onMarkDone) return;
              e.preventDefault();
              e.stopPropagation();
              onMarkDone();
            }}
            onTouchEnd={
              canEdit && column.type === "status" && onMarkDone
                ? (e) => {
                    const now = Date.now();
                    const last = (e.currentTarget as HTMLElement & { _lastTap?: number })._lastTap ?? 0;
                    (e.currentTarget as HTMLElement & { _lastTap?: number })._lastTap = now;
                    if (now - last < 320) {
                      e.preventDefault();
                      onMarkDone();
                    }
                  }
                : undefined
            }
          >
            <SelectValue placeholder="">{renderDisplay()}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(column.statusOptions ?? []).map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                <StatusBadge value={opt.value} options={column.statusOptions ?? []} showTick={column.type === "status"} />
              </SelectItem>
            ))}
            <SelectItem value="__clear__" className="text-muted-foreground">
              Очистить
            </SelectItem>
          </SelectContent>
        </Select>
      ) : column.type === "date" ? (
        <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={!canEdit}
              className="flex h-full min-h-11 w-full items-center gap-1.5 px-2.5 text-left text-sm disabled:cursor-default sm:min-h-[32px]"
            >
              <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {stringValue ? renderDisplay() : <span className="text-muted-foreground">—</span>}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2" align="start">
            <DateCalendar
              value={stringValue ? Number(stringValue) : null}
              onChange={(millis) => {
                onStatusChange(String(millis));
                setDatePickerOpen(false);
              }}
              onClear={() => {
                onStatusChange("");
                setDatePickerOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
      ) : isEditing ? (
        <span className="relative block h-full">
        <input
          ref={inputRef}
          type="text"
          inputMode={column.type === "url" ? "url" : isNumeric ? "decimal" : "text"}
          enterKeyHint={column.type === "url" ? "done" : undefined}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          value={editValue}
          placeholder={column.type === "url" ? "https://…" : undefined}
          onChange={(e) => onEditValueChange(e.target.value)}
          onBlur={() => onCommitEdit("none")}
          onPaste={
            column.type === "url"
              ? (e) => {
                  if (e.clipboardData.files && e.clipboardData.files.length > 0) {
                    e.preventDefault();
                  }
                  const pasted =
                    e.clipboardData.getData("text/plain") || e.clipboardData.getData("text/uri-list");
                  if (pasted) {
                    e.preventDefault();
                    onEditValueChange(pasted.trim());
                  }
                }
              : undefined
          }
          onDrop={
            column.type === "url"
              ? (e) => {
                  e.preventDefault();
                  const uri = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text");
                  if (uri) onEditValueChange(uri.trim());
                }
              : undefined
          }
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.key === "Process") return;
            if (e.key === "Enter") {
              e.preventDefault();
              onCommitEdit("down");
            } else if (e.key === "Tab") {
              e.preventDefault();
              onCommitEdit(e.shiftKey ? "left" : "right");
            } else if (e.key === "Escape") {
              e.preventDefault();
              if (datePickerOpen) { setDatePickerOpen(false); return; }
              onCancelEdit();
            } else if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") {
              e.preventDefault();
              e.stopPropagation();
              if (editValue !== stringValue) {
                onEditValueChange(stringValue);
              } else {
                onCancelEdit();
                onUndoLast?.();
              }
            }
          }}
          className={cn(
            "h-full min-h-11 w-full border-0 bg-background px-2.5 text-sm outline-none ring-1 ring-inset ring-primary sm:min-h-0",
            isNumeric && "text-right tabular-nums",
            column.type === "url" && editValue.trim() && !parseHttpUrl(editValue) && "pb-3"
          )}
        />
        {column.type === "url" && editValue.trim() && !parseHttpUrl(editValue) && (
          <span className="pointer-events-none absolute bottom-0.5 left-2 right-2 truncate text-[10px] text-destructive">
            Нужна ссылка http(s)
          </span>
        )}
        </span>
      ) : (
        <div
          className={cn(
            "flex h-full min-h-11 w-full items-center px-2.5 text-sm leading-snug sm:min-h-[32px]",
            isNumeric && "justify-end tabular-nums",
            showFull && "absolute inset-0 z-30 items-start bg-card py-1.5 shadow-md"
          )}
          title={column.type === "url" ? (diskUrl?.href ?? "") : stringValue}
          onClick={() => {
            if (!isActive) return;
            if (stringValue.length > 36) setExpanded((v) => !v);
          }}
        >
          {showFull ? <span className="whitespace-pre-wrap break-words text-sm">{stringValue}</span> : renderDisplay()}
        </div>
      )}
      {trailing}
    </td>
  );
}
