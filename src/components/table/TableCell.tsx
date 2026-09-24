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
  /** Почему ячейка закрыта (заказ ведёт ОС) — подсказка при наведении. */
  lockedReason?: string | null;
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
  /** Добавка слева от значения (способ оплаты у денежной ячейки стола ОС). */
  leading?: ReactNode;
  /** Кнопка «Карточка клиента» в столбце клиента; summary — «до 15 окт · 2 перс», null пока визитка пуста. */
  clientCard?: {
    summary: string | null;
    canEdit: boolean;
    onOpen: () => void;
    fromOrder?: boolean;
    /** Заказ только что приехал с биржи и подсветку ещё не сняли. */
    isNewOrder?: boolean;
  } | null;
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
  /**
   * Списочная ячейка открывает НЕ выпадашку, а внешний выбор (технарь на
   * столе ОС — полноэкранный список с поиском и занятостью).
   */
  onOpenPicker?: () => void;
  /**
   * Своя отрисовка значения вместо обычной (`DataTable.cellDisplay`): стол ОС
   * рисует в «Технаре» бейдж технаря и состояние выдачи. `undefined` —
   * обычная отрисовка, как у всех столов.
   */
  display?: ReactNode;
  /**
   * Высота строки (та же, что `<tr>` ставит в style): по ней ячейка решает,
   * сколько строк текста показать на десктопе. Без неё текст резался в одну
   * строку и при «Просторно», и после ручного ресайза строки — ресайз терял смысл.
   */
  rowHeight?: number;
}

/**
 * Сколько строк текста влезает в строку такой высоты на десктопе (13px,
 * leading-snug ≈ 17px): 34px — одна, 40–55 — две, от 56 — три. Тач сюда не
 * попадает — там строки выше и `max-sm:line-clamp-2` остаётся как был.
 */
function desktopTextClampClass(rowHeight: number | undefined): string {
  if (rowHeight === undefined || rowHeight < 40) return "sm:truncate";
  if (rowHeight < 56) return "sm:line-clamp-2 sm:whitespace-normal sm:break-words";
  return "sm:line-clamp-3 sm:whitespace-normal sm:break-words";
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
  lockedReason,
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
  leading,
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
  onOpenPicker,
  display,
  rowHeight,
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
    if (isOptionColumn(column.type) && onOpenPicker) {
      onOpenPicker();
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
      // В ячейке — «● Слово» без пилюли (variant plain); пилюли остаются в
      // пунктах выпадашки ниже, там они помогают отличать варианты. Серым
      // гасится только «Готово» у столбца-статуса: у ответственного, технаря
      // и кастомного списка подпись варианта ничего о «сделанности» не говорит.
      return (
        <StatusBadge
          value={stringValue}
          options={column.statusOptions ?? []}
          variant="plain"
          muteDone={column.type === "status"}
        />
      );
    }
    if (column.type === "currency" && stringValue) {
      return (
        <span className={cn("font-mono text-[12.5px] tabular-nums", isNegative && "font-medium text-destructive")}>
          {formatCurrencyCell(stringValue)}
        </span>
      );
    }
    if (column.type === "number" && stringValue) {
      const n = Number(String(stringValue).replace(/\s/g, "").replace(",", "."));
      const shown = Number.isFinite(n) ? formatNumber(n) : stringValue;
      return <span className={cn("font-mono text-[12.5px] tabular-nums", isNegative && "font-medium text-destructive")}>{shown}</span>;
    }
    if (column.type === "date" && stringValue) {
      return <span className="truncate text-[12.5px] text-muted-foreground">{formatOrderDate(Number(stringValue))}</span>;
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
          <span className="truncate font-mono text-[12px] tabular-nums">
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
          <span className="truncate text-[11px] leading-snug text-destructive/80" title="Нужна ссылка http(s)">
            не ссылка http(s)
          </span>
        );
      return (
        <span className="truncate text-xs text-muted-foreground/80 sm:text-[11px]">
          {canEdit ? "вставить ссылку" : "—"}
        </span>
      );
    }
    // Строка 34px на десктопе вмещает одну строку текста — вторая у clamp
    // резалась пополам; выше 40px (плотность «Просторно», ручной ресайз)
    // строк текста показываем столько, сколько влезает. На телефоне строки
    // выше, там две строки остаются.
    return (
      <span
        className={cn(
          "leading-snug",
          isExpanded
            ? "whitespace-normal break-words"
            : cn("max-sm:line-clamp-2 max-sm:whitespace-normal max-sm:break-words", desktopTextClampClass(rowHeight))
        )}
      >
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
      title={lockedReason ?? undefined}
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
      {isOptionColumn(column.type) && onOpenPicker ? (
        // Внешний выбор: [значение][чип действия] рядом, а не друг на друге —
        // чип поверх ячейки закрывал имя технаря (стол ОС, 24.09.2026).
        <div className={cn("flex h-full min-h-11 w-full min-w-0 items-center gap-1 sm:min-h-0", trailing ? "pr-1" : undefined)}>
          <button
            type="button"
            disabled={!canEdit}
            onClick={() => {
              if (canEdit) onOpenPicker();
            }}
            className="table-status-trigger flex h-full min-h-11 min-w-0 flex-1 items-center overflow-hidden px-2 text-left disabled:cursor-default sm:min-h-0"
          >
            {display !== undefined ? (
              display
            ) : stringValue ? (
              renderDisplay()
            ) : (
              <span className="text-xs text-muted-foreground/70">{canEdit ? "Выбрать…" : "—"}</span>
            )}
          </button>
          {trailing}
        </div>
      ) : isOptionColumn(column.type) ? (
        <Select
          value={stringValue || undefined}
          onValueChange={(v) => onStatusChange(v === "__clear__" ? "" : v)}
          onOpenChange={(open) => {
            if (!open) setShowInactiveOptions(false);
          }}
          disabled={!canEdit}
        >
          <SelectTrigger
            className="table-status-trigger h-full min-h-11 w-full min-w-0 max-w-full overflow-hidden rounded-none border-0 bg-transparent px-2 shadow-none focus:ring-0 sm:min-h-0 [&>svg]:hidden"
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
            <SelectValue placeholder="">{display !== undefined ? display : renderDisplay()}</SelectValue>
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
              className="flex h-full min-h-11 w-full items-center gap-1.5 px-2.5 text-left text-[13px] disabled:cursor-default sm:min-h-0"
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
            "h-full min-h-11 w-full border-0 bg-background px-2.5 text-[13px] outline-none ring-1 ring-inset ring-primary sm:min-h-0",
            isNumeric && "text-right font-mono tabular-nums",
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
            // Высоту на десктопе задаёт сама <tr> (34px в плотном столе), ячейке
            // свой минимум не нужен; на таче цель ≥44px остаётся.
            "flex h-full min-h-11 w-full items-center px-2.5 text-[13px] leading-snug sm:min-h-0",
            isNumeric && "justify-end font-mono tabular-nums",
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
          {leading && !showFull ? <span className="mr-auto flex min-w-0 shrink items-center pr-1.5">{leading}</span> : null}
          {showFull ? (
            <span className="whitespace-pre-wrap break-words text-[13px]">
              <HighlightText text={stringValue} query={searchQuery} />
            </span>
          ) : clientCard ? (
            // Имя клиента — в сжимаемой обёртке: без min-w-0 текст не уступал
            // место кнопке карточки, и в узкой ячейке (телефон) она
            // выталкивала имя за край — «имя клиента не видно» (Nurba).
            <span className="flex min-w-0 flex-1 items-center">{renderDisplay()}</span>
          ) : (
            renderDisplay()
          )}
          {clientCard && !showFull && (clientCard.summary || clientCard.canEdit) ? (
            <button
              type="button"
              data-client-card
              className={cn(
                // «Карточка клиента» — САМАЯ заметная кнопка строки (просьба
                // Nurba 25.09.2026: «чтобы сразу в глаза бросалось, 1 клик
                // открывает, сразу светится»): заливка акцентом и мягкое
                // кольцо-свечение, как у «Статистики» в шапке; видна всегда.
                // Один клик открывает карточку строки с визиткой наверху.
                "ml-auto inline-flex shrink-0 items-center gap-1 rounded-md border text-[10.5px] font-semibold tabular-nums transition-colors",
                // На таче — только значок 32×32: подпись «до 15 окт · 2 перс»
                // в узкой липкой ячейке съедала имя клиента; она есть в карточке.
                coarsePointer ? "h-8 w-8 justify-center px-0" : "h-6 max-w-[55%] px-1.5",
                // Янтарный — «только что приехал с «Заказов», подсветку ещё не
                // сняли»; фиолетовый — постоянная метка заказа с биржи.
                // Цвета специально не те, что у статусов.
                clientCard.summary && clientCard.isNewOrder
                  ? "border-warning/50 bg-warning/15 text-warning shadow-[0_0_0_3px_hsl(var(--warning)/0.14)] hover:bg-warning/25"
                  : clientCard.summary && clientCard.fromOrder
                  ? "border-violet-400/45 bg-violet-400/12 text-violet-200 shadow-[0_0_0_3px_hsl(263_70%_70%/0.16)] hover:bg-violet-400/20"
                  : "border-primary/45 bg-primary/12 text-primary shadow-[0_0_0_3px_hsl(var(--primary)/0.14)] hover:bg-primary/20"
              )}
              title={
                clientCard.fromOrder
                  ? `Заказ с «Заказов»${clientCard.summary ? ` · ${clientCard.summary}` : ""} — открыть карточку`
                  : clientCard.summary
                    ? `Карточка клиента: ${clientCard.summary}`
                    : "Карточка клиента — персы, минуты, дедлайн, пожелания"
              }
              aria-label="Карточка клиента"
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                clientCard.onOpen();
              }}
            >
              <IdCard className={cn("shrink-0", coarsePointer ? "h-4 w-4" : "h-3.5 w-3.5")} />
              {coarsePointer ? null : clientCard.summary ? (
                <span className="max-w-[7.5rem] truncate">{clientCard.summary}</span>
              ) : (
                <span>карточка</span>
              )}
            </button>
          ) : null}
        </div>
      )}
      {/* У внешнего выбора чип уже стоит в строке рядом со значением. */}
      {isOptionColumn(column.type) && onOpenPicker ? null : trailing}
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
