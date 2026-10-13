import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Archive, CalendarDays, CheckCheck, ChevronLeft, ChevronRight, Copy, Lightbulb, LightbulbOff, MoreHorizontal, Trash2, X } from "lucide-react";
import { StatusBadge } from "@/components/table/StatusBadge";
import { ClientCardSection } from "@/components/table/ClientCardSection";
import { splitOptionsByActivity } from "@/utils/columnOptions";
import { DiskLinkChip } from "@/components/table/DiskLinkChip";
import { DateCalendar } from "@/components/table/DateCalendar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatCurrencyCell, formatNumber } from "@/utils/format";
import { formatDate, formatOrderDate } from "@/utils/date";
import { DEFAULT_STATUS_OPTIONS, isDoneStatusLabel, isOptionColumn } from "@/utils/columnOptions";
import { normalizeNumericInput } from "@/utils/numberInput";
import { cn } from "@/utils/cn";
import { parseHttpUrl } from "@/utils/httpUrl";
import type { RowExtras } from "@/utils/rowExtras";
import type { PageColumn, PageRow } from "@/types";

function isReworkStatusLabel(label: string): boolean {
  const l = label.toLowerCase();
  return l.includes("передел") || l.includes("rework") || l.includes("redo");
}

function headerTintForStatus(label: string): string {
  if (isReworkStatusLabel(label)) {
    return "bg-destructive/[0.13] shadow-[inset_0_0_32px_hsl(var(--destructive)/0.22)]";
  }
  if (isDoneStatusLabel(label)) {
    return "bg-success/[0.11] shadow-[inset_0_0_32px_hsl(var(--success)/0.18)]";
  }
  return "";
}

export function rowCardLayoutId(rowId: string) {
  return `row-card-${rowId}`;
}

interface RowCardSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: PageColumn[];
  row: PageRow | null;
  /** Enables inline editing of every field. */
  canEdit?: boolean;
  /**
   * Замок ячейки — тот же, что в таблице (заказ ведёт ОС). Закрытое поле
   * показываем как есть, без редактора: иначе человек выбирает статус и
   * ловит отказ уже после выбора.
   */
  cellLock?: (row: PageRow, colKey: string) => string | null;
  onCellChange?: (rowId: string, colKey: string, value: string) => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  /** 1-based position in the current view, for the "3 / 40" badge. */
  position?: { index: number; total: number } | null;
  onMarkDone?: (rowId: string) => void;
  onDuplicate?: (rowId: string) => void;
  onDelete?: (rowId: string) => void;
  /** Подсветка строки вкл/выкл — та же, что в таблице (нужна и на телефоне, где стол — карточками). */
  onToggleHighlight?: (rowId: string) => void;
  /** Можно ли зажечь подсветку; false — только снять (стол ОС). */
  canHighlight?: boolean;
  /**
   * «Визитка клиента» — верхняя секция карточки (персы, минуты, дедлайн,
   * ссылка, пожелания), пишется сама. Нет — у стола нет столбца клиента.
   */
  clientCard?: {
    initialOf: (row: PageRow) => RowExtras;
    canEditOf: (row: PageRow) => boolean;
    onSave: (rowId: string, next: RowExtras | null) => Promise<void>;
    /** Стол строки — визитке для кнопки «Чат в Telegram». */
    pageId?: string;
    /**
     * «NOVA Studio»: у стола есть столбец срока — срок строки живёт в нём, и
     * поле «Дедлайн сдачи» визитка не показывает. Значение, не объект, —
     * сравнение остаётся по значению.
     */
    hasDeadlineColumn?: boolean;
    /** Пояснение у «Пожеланий» в визитке. */
    noteHint?: string;
  };
  /** Доп. панель над полями — сейчас это «Выдача» на столе ОС. */
  extraPanel?: React.ReactNode;
  /**
   * Столбцы, которых нет в «Полях» (их показывает `extraPanel`): на столе ОС —
   * «Технарь», иначе в карточке было два способа выбрать технаря, и второй —
   * голая выпадашка ников без занятости.
   */
  hiddenFieldKeys?: readonly string[];
  /** Подпись «перенесён из «16–30 сен»» у строки, переехавшей из прошлого периода. */
  carriedLabel?: (row: PageRow) => string | null;
}

function isTitleColumn(col: PageColumn) {
  return col.type === "text" || col.type === "email" || col.type === "phone";
}

export function RowCardSheet({
  open,
  onOpenChange,
  columns,
  row,
  canEdit = false,
  cellLock,
  onCellChange,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  position,
  onMarkDone,
  onDuplicate,
  onDelete,
  onToggleHighlight,
  canHighlight = false,
  clientCard,
  extraPanel,
  hiddenFieldKeys,
  carriedLabel,
}: RowCardSheetProps) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [dateOpenKey, setDateOpenKey] = useState<string | null>(null);
  // Какое поле карточки раскрыло свои неактуальные варианты. Ключом, а не
  // флагом: полей с вариантами в карточке несколько, и раскрытие одного
  // не должно раскрывать остальные.
  const [inactiveOpenKey, setInactiveOpenKey] = useState<string | null>(null);
  /**
   * Разделы карточки для чипов-переходов (телефон). Карточка ОС — это
   * «Визитка», «Выдача», «Касса» и «Поля» на 1800 px прокрутки: до «Кассы»
   * приходилось листать три экрана. Раздел помечает себя сам
   * (`data-card-section="Имя"`), карточка только собирает метки из своей
   * прокрутки — панели стола ОС и технаря приходят готовыми узлами.
   */
  const scrollRef = useRef<HTMLDivElement>(null);
  const [sections, setSections] = useState<string[]>([]);
  const rowId = row?.id ?? null;
  useEffect(() => {
    const el = scrollRef.current;
    if (!open || !el) {
      setSections([]);
      return;
    }
    const read = () => {
      const names = [...el.querySelectorAll<HTMLElement>("[data-card-section]")].map((n) => n.dataset.cardSection ?? "").filter(Boolean);
      setSections((prev) => (prev.join("|") === names.join("|") ? prev : names));
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(el, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [open, rowId]);

  function jumpTo(name: string) {
    const el = scrollRef.current;
    const target = el ? [...el.querySelectorAll<HTMLElement>("[data-card-section]")].find((n) => n.dataset.cardSection === name) : null;
    if (!el || !target) return;
    el.scrollTo({ top: target.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 8, behavior: "smooth" });
  }

  useEffect(() => {
    if (!open) {
      setEditingKey(null);
      setDateOpenKey(null);
    }
  }, [open]);

  useEffect(() => {
    setEditingKey(null);
    setDateOpenKey(null);
  }, [row?.id]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      // Попперы Radix (окно даты, выпадашки) порталятся в <body>, у них нет
      // предка [role=dialog] — прежний селектор их не узнавал, и стрелка в окне
      // даты листала карточку на соседнюю строку.
      const inField = Boolean(
        target?.closest("input, textarea, [contenteditable=true], [role=listbox], [role=menu], [data-radix-popper-content-wrapper]")
      );
      if (e.code === "Escape") {
        // An open inline Status/Ответственный/custom-field Select (or any
        // other Radix popper) must get first crack at Escape — it closes
        // itself but doesn't stopPropagation, so without this check the
        // event falls through and closes the whole card out from under the
        // user instead of just dismissing the dropdown they were in.
        // Mirrors the identical guard in DataTable.tsx's own Escape handler.
        if (document.querySelector("[data-radix-popper-content-wrapper], [role=listbox], [data-radix-select-content]")) return;
        if (editingKey) {
          setEditingKey(null);
          return;
        }
        if (dateOpenKey) {
          setDateOpenKey(null);
          return;
        }
        onOpenChange(false);
        return;
      }
      if (inField) return;
      // Открытый поппер владеет стрелками, как уже владеет Escape.
      if (document.querySelector("[data-radix-popper-content-wrapper], [data-radix-select-content]")) return;
      if (e.code === "ArrowLeft" && hasPrev && onPrev) {
        e.preventDefault();
        onPrev();
      } else if (e.code === "ArrowRight" && hasNext && onNext) {
        e.preventDefault();
        onNext();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange, editingKey, dateOpenKey, hasPrev, hasNext, onPrev, onNext]);

  const record = row;
  const editableRow = canEdit && Boolean(onCellChange);
  /** Правится ли КОНКРЕТНОЕ поле (замок стоит на ячейке, а не на строке). */
  const canEditCell = (col: PageColumn) => editableRow && !(record && cellLock?.(record, col.key));

  const titleCol = columns.find(isTitleColumn) ?? columns[0];
  const rawTitle = record && titleCol ? record.cells[titleCol.key] : null;
  const title =
    rawTitle === null || rawTitle === undefined || String(rawTitle).trim() === ""
      ? "Без названия"
      : String(rawTitle);

  const statusCol = columns.find((c) => c.type === "status");
  const responsibleCol = columns.find((c) => c.type === "responsible");
  const statusOptions = statusCol?.statusOptions?.length ? statusCol.statusOptions : DEFAULT_STATUS_OPTIONS;
  const rawStatus = record && statusCol ? String(record.cells[statusCol.key] ?? "") : "";
  const statusLabel = statusOptions.find((o) => o.value === rawStatus)?.label ?? rawStatus;
  const headerTint = headerTintForStatus(statusLabel);
  const identityKeys = new Set([titleCol?.key, statusCol?.key, responsibleCol?.key].filter(Boolean) as string[]);
  const rest = columns.filter((c) => !identityKeys.has(c.key) && !hiddenFieldKeys?.includes(c.key));
  const isDone = isDoneStatusLabel(statusLabel);
  const hasActions = editableRow && Boolean(onMarkDone || onDuplicate || onDelete || onToggleHighlight);
  const canMarkDone = hasActions && Boolean(onMarkDone && statusCol) && !isDone;
  const canToggleHighlight = Boolean(onToggleHighlight) && Boolean(record?.highlight || canHighlight);

  function commitDraft(col: PageColumn) {
    if (!record || !onCellChange) return;
    setEditingKey(null);
    const oldValue = String(record.cells[col.key] ?? "");
    let next = draft;
    if (col.type === "number" || col.type === "currency") next = normalizeNumericInput(draft);
    else next = draft.trim();
    if (next !== oldValue) onCellChange(record.id, col.key, next);
  }

  function beginEdit(col: PageColumn) {
    if (!canEditCell(col) || !record) return;
    setDraft(String(record.cells[col.key] ?? ""));
    setEditingKey(col.key);
  }

  function renderValue(col: PageColumn, opts: { inline?: boolean } = {}) {
    if (!record) return null;
    const raw = record.cells[col.key];
    const stringValue = raw === null || raw === undefined ? "" : String(raw);

    if (isOptionColumn(col.type)) {
      if (!canEditCell(col)) {
        return stringValue ? (
          <StatusBadge value={stringValue} options={col.statusOptions ?? []} showTick={col.type === "status"} className="w-fit" />
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        );
      }
      const optionSplit = splitOptionsByActivity(col.statusOptions ?? [], [stringValue]);
      return (
        <Select
          value={stringValue || undefined}
          onValueChange={(v) => onCellChange?.(record.id, col.key, v === "__clear__" ? "" : v)}
          onOpenChange={(open) => {
            if (!open) setInactiveOpenKey((prev) => (prev === col.key ? null : prev));
          }}
        >
          <SelectTrigger className={cn("h-9 w-auto min-w-[8rem] max-w-full [@media(pointer:coarse)]:h-11", opts.inline && "h-8")}>
            <SelectValue placeholder="—">
              {stringValue ? (
                // «● Слово» без пилюли: пилюля на таче выше самой кнопки (44 px) и вылезала за рамку.
                <StatusBadge value={stringValue} options={col.statusOptions ?? []} showTick={col.type === "status"} variant="plain" />
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {optionSplit.active.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                <StatusBadge value={opt.value} options={col.statusOptions ?? []} showTick={col.type === "status"} />
              </SelectItem>
            ))}
            {optionSplit.inactive.length > 0 && inactiveOpenKey !== col.key && (
              <button
                type="button"
                onPointerDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setInactiveOpenKey(col.key);
                }}
                className="mt-1 flex w-full items-center gap-1.5 rounded-sm border-t border-border/60 px-2 pb-1 pt-2 text-left text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                <Archive className="h-3 w-3 shrink-0" />
                {col.type === "responsible" ? "Неактуальные ОС" : "Неактуальные"} · {optionSplit.inactive.length}
              </button>
            )}
            {inactiveOpenKey === col.key &&
              optionSplit.inactive.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="opacity-70">
                  <StatusBadge value={opt.value} options={col.statusOptions ?? []} showTick={col.type === "status"} />
                </SelectItem>
              ))}
            <SelectItem value="__clear__" className="text-muted-foreground">
              Очистить
            </SelectItem>
          </SelectContent>
        </Select>
      );
    }

    if (col.type === "date") {
      const text = stringValue ? formatDate(Number(stringValue), "d MMMM yyyy") : "";
      if (!canEditCell(col)) return <span className="text-sm tabular">{text || "—"}</span>;
      return (
        <Popover open={dateOpenKey === col.key} onOpenChange={(o) => setDateOpenKey(o ? col.key : null)}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-sm hover:bg-accent [@media(pointer:coarse)]:h-11"
            >
              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
              <span className={cn("tabular", !text && "text-muted-foreground")}>{text || "Выбрать дату"}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2" align="end">
            <DateCalendar
              value={stringValue ? Number(stringValue) : null}
              onChange={(millis) => {
                onCellChange?.(record.id, col.key, String(millis));
                setDateOpenKey(null);
              }}
              onClear={() => {
                onCellChange?.(record.id, col.key, "");
                setDateOpenKey(null);
              }}
            />
          </PopoverContent>
        </Popover>
      );
    }

    if (editingKey === col.key) {
      const isNumeric = col.type === "number" || col.type === "currency";
      const multiline = col.type === "text" && (draft.length > 60 || draft.includes("\n"));
      const common = {
        value: draft,
        autoFocus: true,
        onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
        onBlur: () => commitDraft(col),
        onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter" && (!multiline || e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            commitDraft(col);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setEditingKey(null);
          }
        },
        className: cn(
          "w-full rounded-lg border border-primary bg-background px-3 py-1.5 text-sm outline-none shadow-[0_0_8px_hsl(var(--primary)/0.35)] [@media(pointer:coarse)]:py-2.5",
          isNumeric && "text-right tabular-nums"
        ),
      };
      return multiline ? <textarea rows={3} {...common} /> : <input type="text" inputMode={isNumeric ? "decimal" : col.type === "phone" ? "tel" : col.type === "email" ? "email" : col.type === "url" ? "url" : "text"} {...common} />;
    }

    const display = (() => {
      if (col.type === "url") {
        const href = parseHttpUrl(stringValue);
        return href ? <DiskLinkChip href={href.href} /> : <span className="text-sm text-muted-foreground">{stringValue || "—"}</span>;
      }
      if (col.type === "currency" && stringValue) {
        return <span className="display text-xl tabular">{formatCurrencyCell(stringValue)}</span>;
      }
      if (col.type === "number" && stringValue) {
        const n = Number(stringValue);
        return <span className="text-sm tabular">{Number.isFinite(n) ? formatNumber(n) : stringValue}</span>;
      }
      if (col.type === "phone" && stringValue) {
        return (
          <a href={`tel:${stringValue.replace(/[^\d+]/g, "")}`} className="text-sm tabular text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
            {stringValue}
          </a>
        );
      }
      if (col.type === "email" && stringValue) {
        return (
          <a href={`mailto:${stringValue.trim()}`} className="text-sm text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
            {stringValue}
          </a>
        );
      }
      return <span className="whitespace-pre-wrap break-words text-sm">{stringValue || "—"}</span>;
    })();

    if (!canEditCell(col)) return display;
    return (
      <button
        type="button"
        onClick={() => beginEdit(col)}
        className="row-card-editable -my-1 max-w-full rounded-md py-1 text-right hover:bg-primary/10 sm:-mx-2 sm:px-2"
        title="Нажмите, чтобы изменить"
      >
        {display}
      </button>
    );
  }

  return (
    <AnimatePresence>
      {open && record && (
        <>
          <motion.button
            type="button"
            aria-label="Закрыть"
            key="row-card-backdrop"
            className="fixed inset-0 z-50 bg-black/70 max-lg:backdrop-blur-none lg:bg-background/70 lg:backdrop-blur-[10px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => onOpenChange(false)}
          />
          {/* Телефон — карточка на весь экран: с полями по краям сверху и снизу
              торчал каркас стола, а прокрутке оставалось 420 px из 812. */}
          <div className="nova-vv-fit pointer-events-none fixed inset-0 z-50 flex items-center justify-center sm:p-4">
            <motion.div
              key={record.id}
              layoutId={rowCardLayoutId(record.id)}
              role="dialog"
              aria-modal="true"
              className="nova-vv-card hud-frame glass-float pointer-events-auto flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-md max-sm:h-full max-sm:max-h-none max-sm:rounded-none max-sm:border-0"
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
            >
              <div className={cn("shrink-0 border-b border-white/10 px-4 py-3 text-left sm:px-6 sm:py-5", headerTint)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="eyebrow mb-1 flex items-center gap-2 text-primary sm:mb-2">
                      Карточка клиента
                      {position && (
                        <span className="rounded-full bg-primary/12 px-1.5 py-0.5 font-mono text-[10px] tabular text-primary">
                          {position.index} / {position.total}
                        </span>
                      )}
                    </p>
                    {row && carriedLabel?.(row) ? (
                      <p className="mb-1.5 inline-flex items-center gap-1.5 rounded-md border border-sky-400/40 bg-sky-400/10 px-1.5 py-0.5 text-[11px] text-sky-200">
                        Перенесён из «{carriedLabel(row)}»
                      </p>
                    ) : null}
                    {editingKey === titleCol?.key && titleCol ? (
                      <div className="mt-1">{renderValue(titleCol)}</div>
                    ) : (
                      <h2
                        className={cn("hero break-words text-[1.25rem] sm:text-[1.55rem]", titleCol && canEditCell(titleCol) && "cursor-text rounded-md hover:bg-primary/8")}
                        onClick={() => titleCol && beginEdit(titleCol)}
                        title={titleCol && canEditCell(titleCol) ? "Нажмите, чтобы изменить" : undefined}
                      >
                        {title}
                      </h2>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    {(onPrev || onNext) && (
                      <>
                        <Button variant="ghost" size="icon" className="h-8 w-8" disabled={!hasPrev} onClick={onPrev} aria-label="Предыдущая строка" title="Предыдущая (←)">
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" disabled={!hasNext} onClick={onNext} aria-label="Следующая строка" title="Следующая (→)">
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => onOpenChange(false)}
                      className="flex items-center justify-center rounded-md p-2 text-muted-foreground transition-opacity hover:text-foreground [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
                    >
                      <X className="h-4 w-4" />
                      <span className="sr-only">Закрыть</span>
                    </button>
                  </div>
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 sm:mt-4">
                  {statusCol && (
                    <div className="flex items-center gap-2">
                      {/* На телефоне подпись не нужна: статус узнаётся по точке и
                          слову, а с подписью «Статус» и «ОС» не помещались в строку. */}
                      <span className="eyebrow max-sm:hidden">{statusCol.label}</span>
                      {renderValue(statusCol, { inline: true })}
                    </div>
                  )}
                  {responsibleCol && (
                    <div className="flex items-center gap-2">
                      <span className="eyebrow">{responsibleCol.label}</span>
                      {renderValue(responsibleCol, { inline: true })}
                    </div>
                  )}
                </div>
              </div>
              {sections.length > 1 && (
                <div data-card-jump className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-white/10 px-4 py-2 sm:hidden">
                  {sections.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => jumpTo(name)}
                      className="inline-flex h-9 shrink-0 items-center rounded-full border border-border px-3 text-[13px] font-medium text-muted-foreground active:bg-primary/12 active:text-primary"
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}
              <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 py-3 scrollbar-thin sm:px-6 sm:py-4">
                {/* Визитка — первой: ради неё карточку и открывают (что просил
                    клиент), поля таблицы ниже. */}
                {clientCard ? (
                  <div className="mb-4">
                    <ClientCardSection
                      rowId={record.id}
                      initial={clientCard.initialOf(record)}
                      canEdit={editableRow && clientCard.canEditOf(record)}
                      onSave={(next) => clientCard.onSave(record.id, next)}
                      pageId={clientCard.pageId}
                      hasDeadlineColumn={clientCard.hasDeadlineColumn}
                      noteHint={clientCard.noteHint}
                    />
                  </div>
                ) : null}
                {extraPanel ? <div className="mb-4">{extraPanel}</div> : null}
                {rest.length > 0 && (
                  <div data-card-section="Поля">
                    <p className="eyebrow mb-2">Поля</p>
                    <div className="flex flex-col">
                      {rest.map((col) => {
                        // Вся строка поля кликабельна (просьба Nurba 25.09.2026:
                        // «всю зону кликабельной»): правка начиналась только с
                        // узкого «—» справа, и в пустое поле было не попасть.
                        // Списки и даты открывают свои выпадашки сами, им
                        // строка-кнопка не нужна; ссылки внутри останавливают
                        // всплытие и открываются как раньше.
                        const rowEditable = canEditCell(col) && !isOptionColumn(col.type) && col.type !== "date" && editingKey !== col.key;
                        return (
                          <div
                            key={col.id}
                            role={rowEditable ? "button" : undefined}
                            tabIndex={rowEditable ? 0 : undefined}
                            onClick={rowEditable ? () => beginEdit(col) : undefined}
                            onKeyDown={
                              rowEditable
                                ? (e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      beginEdit(col);
                                    }
                                  }
                                : undefined
                            }
                            title={rowEditable ? "Нажмите, чтобы изменить" : undefined}
                            className={cn(
                              "flex items-start justify-between gap-4 border-t border-border/50 py-2.5 [@media(pointer:coarse)]:min-h-12 [@media(pointer:coarse)]:items-center",
                              rowEditable && "-mx-2 cursor-text rounded-md px-2 transition-colors hover:bg-primary/[0.06] focus-visible:bg-primary/[0.06] focus-visible:outline-none"
                            )}
                          >
                            <p className="shrink-0 pt-1 text-[12px] text-muted-foreground [@media(pointer:coarse)]:pt-0 [@media(pointer:coarse)]:text-[13px]">{col.label}</p>
                            <div className="min-w-0 max-w-[70%] text-right">{renderValue(col)}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                <p className="mt-4 border-t border-border/50 pt-3 text-[11px] text-muted-foreground">
                  Создано {formatOrderDate(record.createdAt)}
                  {record.updatedAt && record.updatedAt !== record.createdAt ? ` · изменено ${formatDate(record.updatedAt)}` : ""}
                </p>
              </div>
              {/* Подвал. Компьютер — как был: действия в ряд, есть только у того,
                  кто правит. Телефон — всегда: «Закрыть» под большим пальцем
                  (крестик наверху экрана), главное действие во всю ширину и
                  остальное в «⋯» — четыре кнопки в два ряда съедали 100 px. */}
              <div
                className={cn(
                  "flex shrink-0 flex-wrap items-center gap-2 border-t border-white/10 px-4 py-3 max-sm:flex-nowrap max-sm:pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:px-6",
                  !hasActions && "sm:hidden"
                )}
              >
                <Button variant="outline" className={cn("h-11 shrink-0 px-4 sm:hidden", !canMarkDone && "flex-1")} onClick={() => onOpenChange(false)}>
                  Закрыть
                </Button>
                {canMarkDone && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 text-success hover:text-success max-sm:h-11 max-sm:min-w-0 max-sm:flex-1"
                    onClick={() => onMarkDone?.(record.id)}
                  >
                    <CheckCheck className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">Отметить «Готово»</span>
                  </Button>
                )}
                {hasActions && (
                  <div className="hidden sm:contents">
                    {onDuplicate && (
                      <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={() => onDuplicate(record.id)}>
                        <Copy className="h-3.5 w-3.5" /> Дублировать
                      </Button>
                    )}
                    {canToggleHighlight && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn("h-8 gap-1.5", record.highlight && "text-warning hover:text-warning")}
                        onClick={() => onToggleHighlight?.(record.id)}
                      >
                        {record.highlight ? <LightbulbOff className="h-3.5 w-3.5" /> : <Lightbulb className="h-3.5 w-3.5" />}
                        {record.highlight ? "Снять подсветку" : "Подсветить как новый"}
                      </Button>
                    )}
                    <div className="flex-1" />
                    {onDelete && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1.5 text-destructive hover:text-destructive"
                        onClick={() => {
                          onDelete(record.id);
                          onOpenChange(false);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Удалить
                      </Button>
                    )}
                  </div>
                )}
                {hasActions && (onDuplicate || canToggleHighlight || onDelete) && (
                  <div className="ml-auto sm:hidden">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="icon" className="h-11 w-11" aria-label="Ещё действия">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" side="top">
                        {onDuplicate && (
                          <DropdownMenuItem className="min-h-11" onClick={() => onDuplicate(record.id)}>
                            <Copy className="h-4 w-4" /> Дублировать
                          </DropdownMenuItem>
                        )}
                        {canToggleHighlight && (
                          <DropdownMenuItem className="min-h-11" onClick={() => onToggleHighlight?.(record.id)}>
                            {record.highlight ? <LightbulbOff className="h-4 w-4" /> : <Lightbulb className="h-4 w-4" />}
                            {record.highlight ? "Снять подсветку" : "Подсветить как новый"}
                          </DropdownMenuItem>
                        )}
                        {onDelete && (
                          <>
                            {(onDuplicate || canToggleHighlight) && <DropdownMenuSeparator />}
                            <DropdownMenuItem
                              className="min-h-11 text-destructive focus:text-destructive"
                              onClick={() => {
                                onDelete(record.id);
                                onOpenChange(false);
                              }}
                            >
                              <Trash2 className="h-4 w-4" /> Удалить
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
