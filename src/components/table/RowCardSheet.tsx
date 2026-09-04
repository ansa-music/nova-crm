import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarDays, CheckCheck, ChevronLeft, ChevronRight, Copy, Trash2, X } from "lucide-react";
import { StatusBadge } from "@/components/table/StatusBadge";
import { DiskLinkChip } from "@/components/table/DiskLinkChip";
import { DateCalendar } from "@/components/table/DateCalendar";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatCurrencyCell, formatNumber } from "@/utils/format";
import { formatDate, formatOrderDate } from "@/utils/date";
import { DEFAULT_STATUS_OPTIONS, isDoneStatusLabel, isOptionColumn } from "@/utils/columnOptions";
import { normalizeNumericInput } from "@/utils/numberInput";
import { cn } from "@/utils/cn";
import { parseHttpUrl } from "@/utils/httpUrl";
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
  onCellChange,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  position,
  onMarkDone,
  onDuplicate,
  onDelete,
}: RowCardSheetProps) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [dateOpenKey, setDateOpenKey] = useState<string | null>(null);

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
      const inField = Boolean(target?.closest("input, textarea, [contenteditable=true], [role=listbox], [role=dialog] [data-radix-popper-content-wrapper]"));
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
  const editable = canEdit && Boolean(onCellChange);

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
  const rest = columns.filter((c) => !identityKeys.has(c.key));
  const isDone = isDoneStatusLabel(statusLabel);

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
    if (!editable || !record) return;
    setDraft(String(record.cells[col.key] ?? ""));
    setEditingKey(col.key);
  }

  function renderValue(col: PageColumn, opts: { inline?: boolean } = {}) {
    if (!record) return null;
    const raw = record.cells[col.key];
    const stringValue = raw === null || raw === undefined ? "" : String(raw);

    if (isOptionColumn(col.type)) {
      if (!editable) {
        return stringValue ? (
          <StatusBadge value={stringValue} options={col.statusOptions ?? []} showTick={col.type === "status"} className="w-fit" />
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        );
      }
      return (
        <Select value={stringValue || undefined} onValueChange={(v) => onCellChange?.(record.id, col.key, v === "__clear__" ? "" : v)}>
          <SelectTrigger className={cn("h-9 w-auto min-w-[8rem] max-w-full border-primary/20 bg-white/[0.03]", opts.inline && "h-8")}>
            <SelectValue placeholder="—">
              {stringValue ? (
                <StatusBadge value={stringValue} options={col.statusOptions ?? []} showTick={col.type === "status"} />
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(col.statusOptions ?? []).map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
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
      if (!editable) return <span className="text-sm tabular">{text || "—"}</span>;
      return (
        <Popover open={dateOpenKey === col.key} onOpenChange={(o) => setDateOpenKey(o ? col.key : null)}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-primary/20 bg-white/[0.03] px-3 text-sm hover:border-primary/50"
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
          "w-full rounded-lg border border-primary bg-background px-3 py-1.5 text-sm outline-none shadow-[0_0_8px_hsl(var(--primary)/0.35)]",
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

    if (!editable) return display;
    return (
      <button
        type="button"
        onClick={() => beginEdit(col)}
        className="row-card-editable -mx-2 -my-1 max-w-full rounded-md px-2 py-1 text-right hover:bg-primary/10"
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
          <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
            <motion.div
              key={record.id}
              layoutId={rowCardLayoutId(record.id)}
              role="dialog"
              aria-modal="true"
              className="hud-frame glass-float pointer-events-auto flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-md"
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
            >
              <div className={cn("border-b border-white/10 px-5 py-5 text-left sm:px-6", headerTint)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="eyebrow mb-2 flex items-center gap-2 text-primary">
                      Карточка
                      {position && (
                        <span className="rounded-full bg-primary/12 px-1.5 py-0.5 font-mono text-[10px] tabular text-primary">
                          {position.index} / {position.total}
                        </span>
                      )}
                    </p>
                    {editingKey === titleCol?.key && titleCol ? (
                      <div className="mt-1">{renderValue(titleCol)}</div>
                    ) : (
                      <h2
                        className={cn("hero break-words text-[1.4rem] sm:text-[1.55rem]", editable && "cursor-text rounded-md hover:bg-primary/8")}
                        onClick={() => titleCol && beginEdit(titleCol)}
                        title={editable ? "Нажмите, чтобы изменить" : undefined}
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
                      className="rounded-md p-2 text-muted-foreground transition-opacity hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                      <span className="sr-only">Закрыть</span>
                    </button>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  {statusCol && (
                    <div className="flex items-center gap-2">
                      <span className="eyebrow">{statusCol.label}</span>
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
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4 scrollbar-thin sm:px-6">
                {rest.length > 0 && (
                  <div>
                    <p className="eyebrow mb-2">Поля</p>
                    <div className="flex flex-col">
                      {rest.map((col) => (
                        <div key={col.id} className="flex items-start justify-between gap-4 border-t border-border/50 py-2.5">
                          <p className="shrink-0 pt-1 text-[12px] text-muted-foreground">{col.label}</p>
                          <div className="min-w-0 max-w-[70%] text-right">{renderValue(col)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <p className="mt-4 border-t border-border/50 pt-3 text-[11px] text-muted-foreground">
                  Создано {formatOrderDate(record.createdAt)}
                  {record.updatedAt && record.updatedAt !== record.createdAt ? ` · изменено ${formatDate(record.updatedAt)}` : ""}
                </p>
              </div>
              {editable && (onMarkDone || onDuplicate || onDelete) && (
                <div className="flex flex-wrap items-center gap-2 border-t border-white/10 px-5 py-3 sm:px-6">
                  {onMarkDone && statusCol && !isDone && (
                    <Button variant="outline" size="sm" className="h-8 gap-1.5 text-success hover:text-success" onClick={() => onMarkDone(record.id)}>
                      <CheckCheck className="h-3.5 w-3.5" /> Отметить «Готово»
                    </Button>
                  )}
                  {onDuplicate && (
                    <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={() => onDuplicate(record.id)}>
                      <Copy className="h-3.5 w-3.5" /> Дублировать
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
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
