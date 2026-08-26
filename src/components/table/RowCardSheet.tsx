import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { StatusBadge } from "@/components/table/StatusBadge";
import { DiskLinkChip } from "@/components/table/DiskLinkChip";
import { formatCurrency } from "@/utils/format";
import { formatDate } from "@/utils/date";
import { DEFAULT_STATUS_OPTIONS, isDoneStatusLabel, isOptionColumn } from "@/utils/columnOptions";
import { cn } from "@/utils/cn";
import { parseHttpUrl } from "@/utils/httpUrl";
import type { PageColumn, PageRow } from "@/types";


function isReworkStatusLabel(label: string): boolean {
  const l = label.toLowerCase();
  return l.includes("передел") || l.includes("rework") || l.includes("redo");
}

function headerTintForStatus(label: string): string {
  if (isReworkStatusLabel(label)) {
    return "bg-red-500/[0.13] shadow-[inset_0_0_32px_rgba(239,68,68,0.22)]";
  }
  if (isDoneStatusLabel(label)) {
    return "bg-emerald-500/[0.11] shadow-[inset_0_0_32px_rgba(16,185,129,0.18)]";
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
}

function isTitleColumn(col: PageColumn) {
  return col.type === "text" || col.type === "email" || col.type === "phone";
}

export function RowCardSheet({
  open,
  onOpenChange,
  columns,
  row,
}: RowCardSheetProps) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === "Escape") onOpenChange(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  const record = row;

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

  function renderValue(col: PageColumn) {
    if (!record) return null;
    const raw = record.cells[col.key];
    const stringValue = raw === null || raw === undefined ? "" : String(raw);
    if (isOptionColumn(col.type)) {
      return stringValue ? (
        <StatusBadge value={stringValue} options={col.statusOptions ?? []} showTick={col.type === "status"} className="w-fit" />
      ) : (
        <span className="text-sm text-muted-foreground">—</span>
      );
    }
    if (col.type === "url") {
      const href = parseHttpUrl(stringValue);
      return href ? <DiskLinkChip href={href.href} /> : <span className="text-sm text-muted-foreground">—</span>;
    }
    if (col.type === "currency" && stringValue) {
      return <span className="display text-xl tabular">{formatCurrency(Number(stringValue))}</span>;
    }
    if (col.type === "date" && stringValue) {
      return <span className="text-sm tabular">{formatDate(Number(stringValue), "d MMMM yyyy")}</span>;
    }
    return <span className="whitespace-pre-wrap text-sm">{stringValue || "—"}</span>;
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
          <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              key={record.id}
              layoutId={rowCardLayoutId(record.id)}
              role="dialog"
              aria-modal="true"
              className="hud-frame glass-float pointer-events-auto flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-md"
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
            >
              <div className={cn("border-b border-white/10 px-6 py-6 text-left", headerTint)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="eyebrow mb-2 text-primary">Человек</p>
                    <h2 className="hero text-[1.55rem]">{title}</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenChange(false)}
                    className="rounded-md p-2 text-muted-foreground transition-opacity hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                    <span className="sr-only">Закрыть</span>
                  </button>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {statusCol && renderValue(statusCol)}
                  {responsibleCol && (
                    <div className="flex items-center gap-2">
                      <span className="eyebrow">{responsibleCol.label}</span>
                      {renderValue(responsibleCol)}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-5 scrollbar-thin">
                {rest.length > 0 && (
                  <div>
                    <p className="eyebrow mb-3">Поля</p>
                    <div className="flex flex-col">
                      {rest.map((col) => (
                        <div key={col.id} className="flex items-start justify-between gap-4 border-t border-border/50 py-3">
                          <p className="shrink-0 pt-0.5 text-[12px] text-muted-foreground">{col.label}</p>
                          <div className="min-w-0 text-right">{renderValue(col)}</div>
                        </div>
                      ))}
                    </div>
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
