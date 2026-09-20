import { useEffect, useRef, useState, type ReactNode } from "react";
import { Archive, CalendarDays, CopyCheck, IdCard, Mail, Phone } from "lucide-react";
import { StatusBadge } from "@/components/table/StatusBadge";
import { HighlightText } from "@/components/table/HighlightText";
import { DiskLinkChip } from "@/components/table/DiskLinkChip";
import { DateCalendar } from "@/components/table/DateCalendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatCurrencyCell, formatNumber } from "@/utils/format";
import { formatOrderDate } from "@/utils/date";
import { isOptionColumn, splitOptionsByActivity } from "@/utils/columnOptions";
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
  onClick?: () => void;
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
  /** «Визитка клиента» button in the client column; summary is null while the card is empty. */
  clientCard?: { summary: string | null; canEdit: boolean; onOpen: () => void; fromOrder?: boolean } | null;
  coarsePointer?: boolean;
  /** Current table search — matching substrings get highlighted. */
  searchQuery?: string;
  /** Row is a dropdown/calendar "picker" cell and the grid asked it to open (Enter/Space). */
  openRequest?: number;
  /** Show the drag-to-fill handle (bottom-right square of the selection). */
  showFillHandle?: boolean;
  onFillStart?: (colKey: string, e: React.PointerEvent) => void;
  /** Cell is inside the live drag-to-fill preview range. */
  isInFill?: boolean;
  /** Same phone/email exists in another row — shows a small badge. */
  isDuplicate?: boolean;
  onFindDuplicates?: () => void;
  /** Muted hint shown in an empty text-like cell (a blank row's first column). */
  placeholder?: string;
}

/** Digits-only tel: href; keeps a leading + for international numbers. */
function telHref(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.replace(/\D/g, "").length < 5) return null;
  return `tel:${digits}`;
}

function looksLikeEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim());
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
  onClick,
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
  clientCard,
  coarsePointer,
  searchQuery = "",
  openRequest,
  showFillHandle,
  onFillStart,
  isInFill,
  isDuplicate,
  onFindDuplicates,
  placeholder,
}: TableCellProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const tdRef = useRef<HTMLTableCellElement>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  // Неактуальные варианты (ушедшие ОС) раскрываются кнопкой внизу списка и
  // сворачиваются обратно при закрытии выпадашки.
  const [showInactiveOptions, setShowInactiveOptions] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      const input = inputRef.current;
      input.focus();
      // Editing started by typing a character: keep it and put the caret
      // after it — selecting it made the very next keystroke replace it.
      if (editValue !== stringValue) {
        const end = input.value.length;
        input.setSelectionRange(end, end);
      } else {
        input.select();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing]);

  useEffect(() => {
    if (!isActive) setExpanded(false);
  }, [isActive]);

  // Keyboard "open picker": DataTable bumps `openRequest` on Enter/Space for
  // the active status/date cell. Radix Select opens on click when its
  // pointerType ref is not "mouse" (it starts as "touch"), and the date
  // popover trigger is a plain button, so a synthetic click does the job
  // for both without reaching into Radix internals.
  useEffect(() => {
    if (!openRequest || !isActive || !canEdit) return;
    const td = tdRef.current;
    if (!td) return;
    if (column.type === "date") {
      setDatePickerOpen(true);
      return;
    }
    if (isOptionColumn(column.type)) {
      const trigger = td.querySelector<HTMLElement>(".table-status-trigger");
      if (!trigger) return;
      // Radix Select opens on Enter/Space keydown regardless of which
      // pointer type was last used on it (a plain .click() is ignored after
      // a mouse interaction). The grid's own listener skips untrusted
      // events, so this can't re-trigger itself.
      trigger.focus();
      trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest]);

  // When a picker closes, hand keyboard focus back to the grid (not the
  // trigger button) — otherwise the next ArrowDown would reopen the picker
  // instead of moving the selection.
  function refocusGrid(e: Event) {
    e.preventDefault();
    tdRef.current?.closest<HTMLElement>(".table-grid-scroll")?.focus({ preventScroll: true });
  }

  const isNumeric = column.type === "number" || column.type === "currency";
  const stringValue = value === null || value === undefined ? "" : String(value);
  const duplicateBadge = isDuplicate ? (
    <button
      type="button"
      className="table-dup-badge ml-auto inline-flex h-4 shrink-0 items-center gap-0.5 rounded-full border border-warning/40 bg-warning/12 px-1 text-[9px] font-medium uppercase tracking-wide text-warning"
      title="Такое же значение есть в других строках — нажмите, чтобы показать их"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onFindDuplicates?.();
      }}
    >
      <CopyCheck className="h-2.5 w-2.5" /> дубль
    </button>
  ) : null;
  const isNegative = isNumeric && stringValue !== "" && Number(stringValue) < 0;
  // Выбранное значение остаётся в основном списке, даже став неактуальным:
  // иначе человек открывает выпадашку и не видит в ней то, что уже стоит.
  const optionSplit = splitOptionsByActivity(column.statusOptions ?? [], [stringValue]);
  const inactiveLabel = column.type === "responsible" ? "Неактуальные ОС" : "Неактуальные";
  const diskUrl = column.type === "url" ? parseHttpUrl(stringValue) : null;
  const showFull = expanded || Boolean(isExpanded);

  function renderDisplay() {
    if (placeholder && !stringValue && !isOptionColumn(column.type) && column.type !== "date") {
      return <span className="truncate text-[12px] italic text-muted-foreground/55">{placeholder}</span>;
    }
    if (isOptionColumn(column.type)) {
      return <StatusBadge value={stringValue} options={column.statusOptions ?? []} showTick={column.type === "status"} />;
    }
    if (column.type === "currency" && stringValue) {
      return <span className={cn("tabular-nums", isNegative && "font-medium text-destructive")}>{formatCurrencyCell(stringValue)}</span>;
    }
    if (column.type === "number" && stringValue) {
      const n = Number(String(stringValue).replace(/\s/g, "").replace(",", "."));
      const shown = Number.isFinite(n) ? formatNumber(n) : stringValue;
      return <span className={cn("tabular-nums", isNegative && "font-medium text-destructive")}>{shown}</span>;
    }
    if (column.type === "date" && stringValue) {
      return <span className="truncate">{formatOrderDate(Number(stringValue))}</span>;
    }
    if (column.type === "phone" && stringValue) {
      const href = telHref(stringValue);
      return (
        <span className="flex min-w-0 items-center gap-1.5">
          {href ? (
            <a
              href={href}
              className="table-contact-link shrink-0 text-muted-foreground hover:text-primary"
              title="Позвонить"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <Phone className="h-3 w-3" />
            </a>
          ) : null}
          <span className="truncate tabular-nums">
            <HighlightText text={stringValue} query={searchQuery} />
          </span>
          {duplicateBadge}
        </span>
      );
    }
    if (column.type === "email" && stringValue) {
      const ok = looksLikeEmail(stringValue);
      return (
        <span className="flex min-w-0 items-center gap-1.5">
          {ok ? (
            <a
              href={`mailto:${stringValue.trim()}`}
              className="table-contact-link shrink-0 text-muted-foreground hover:text-primary"
              title="Написать письмо"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <Mail className="h-3 w-3" />
            </a>
          ) : null}
          <span className={cn("truncate", !ok && "text-warning")} title={ok ? undefined : "Не похоже на email"}>
            <HighlightText text={stringValue} query={searchQuery} />
          </span>
          {duplicateBadge}
        </span>
      );
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
        <HighlightText text={stringValue} query={searchQuery} />
      </span>
    );
  }

  return (
    <td
      ref={tdRef}
      className={cn(
        "table-cell relative min-w-0 overflow-hidden select-none border-b border-r border-border/35 p-0 align-middle",
        stickyLeft !== undefined && "table-sticky-col sticky z-[22] isolate bg-background",
        isLastSticky && "table-sticky-edge",
        isInRange && !isEditing && "table-cell-range",
        isActive && !isEditing && "table-cell-active z-10",
        isEditing && "table-cell-editing z-20",
        isInFill && "table-cell-fill"
      )}
      style={{
        width: column.width,
        minWidth: column.width,
        maxWidth: column.width,
        height: "100%",
        left: stickyLeft,
      }}
      onMouseDown={onMouseDown}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onPointerDown={(e) => {
        // Radix Select cancels the mouse pointerdown on its trigger, so the
        // browser never sends mousedown and the cell was never selected —
        // arrows then started from the previously selected cell.
        if (e.pointerType === "mouse" && isOptionColumn(column.type)) onMouseDown(e);
      }}
      onDoubleClick={onStartEdit}
      data-col={column.key}
    >
      {isOptionColumn(column.type) ? (
        <Select
          value={stringValue || undefined}
          onValueChange={(v) => onStatusChange(v === "__clear__" ? "" : v)}
          onOpenChange={(open) => {
            if (!open) setShowInactiveOptions(false);
          }}
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
          <SelectContent onCloseAutoFocus={refocusGrid}>
            {optionSplit.active.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                <StatusBadge value={opt.value} options={column.statusOptions ?? []} showTick={column.type === "status"} />
              </SelectItem>
            ))}
            {optionSplit.inactive.length > 0 && !showInactiveOptions && (
              <button
                type="button"
                // Не SelectItem: выбор варианта закрыл бы выпадашку, и до
                // ушедшего ОС пришлось бы открывать её заново.
                onPointerDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowInactiveOptions(true);
                }}
                className="mt-1 flex w-full items-center gap-1.5 rounded-sm border-t border-border/60 px-2 pb-1 pt-2 text-left text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                <Archive className="h-3 w-3 shrink-0" />
                {inactiveLabel} · {optionSplit.inactive.length}
              </button>
            )}
            {showInactiveOptions &&
              optionSplit.inactive.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="opacity-70">
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
          <PopoverContent className="w-auto p-2" align="start" onCloseAutoFocus={refocusGrid}>
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
              onCommitEdit(e.shiftKey ? "none" : "down");
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
            // An editor opens the full text in the input on this same click
            // (DataTable.handleCellClick); only read-only viewers expand.
            if (!isActive || canEdit) return;
            if (stringValue.length > 36) setExpanded((v) => !v);
          }}
        >
          {showFull ? (
            <span className="whitespace-pre-wrap break-words text-sm">
              <HighlightText text={stringValue} query={searchQuery} />
            </span>
          ) : (
            renderDisplay()
          )}
          {clientCard && !showFull && (clientCard.summary || clientCard.canEdit) ? (
            <button
              type="button"
              data-client-card
              className={cn(
                "ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border pl-1.5 pr-2 text-[10px] font-medium tabular-nums transition-colors",
                coarsePointer ? "h-8" : "h-6",
                // Фиолетовый — «это приехало с «Заказов», а не заведено руками».
                // Метка постоянная, в отличие от подсветки новой строки, и
                // цвет специально не тот, что у обычной визитки и статусов.
                clientCard.summary && clientCard.fromOrder
                  ? "border-violet-400/55 bg-violet-400/15 text-violet-200 hover:bg-violet-400/25"
                  : clientCard.summary
                  ? "border-primary/45 bg-primary/12 text-primary hover:bg-primary/20"
                  : cn(
                      coarsePointer ? "w-8" : "w-6",
                      "justify-center border-dashed border-border px-0 text-muted-foreground hover:border-primary/50 hover:text-primary",
                      "opacity-50 group-hover/row:opacity-100 focus-visible:opacity-100"
                    )
              )}
              title={
                clientCard.fromOrder
                  ? `Заказ с «Заказов»${clientCard.summary ? ` · ${clientCard.summary}` : ""}`
                  : clientCard.summary
                    ? `Визитка клиента: ${clientCard.summary}`
                    : "Визитка клиента — персы, минуты, пожелания"
              }
              aria-label="Визитка клиента"
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                clientCard.onOpen();
              }}
            >
              <IdCard className="h-3.5 w-3.5 shrink-0" />
              {clientCard.summary ? <span className="max-w-[7.5rem] truncate">{clientCard.summary}</span> : null}
            </button>
          ) : null}
        </div>
      )}
      {trailing}
      {showFillHandle && canEdit && !isEditing && onFillStart && (
        <span
          className="table-fill-handle"
          title="Потяните вниз, чтобы заполнить"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            onFillStart(column.key, e);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        />
      )}
    </td>
  );
}
