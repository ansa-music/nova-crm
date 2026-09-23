import { AlertTriangle, Loader2, Send, Store } from "lucide-react";
import { cn } from "@/utils/cn";

/**
 * Кнопка-действие поверх ячейки строки. Таблица сама про заказы ничего не
 * знает: что нарисовать, решает страница (`DataTable.cellAction`). Сейчас это
 * стол ОС — «В работу» (заказ уходит на «Заказы» с данными строки), метка
 * «на «Заказах»» и «не доехало до технаря».
 */
export interface CellActionView {
  label: string;
  title: string;
  tone: "primary" | "info" | "warning";
  icon?: "send" | "store" | "alert";
  busy?: boolean;
}

export function sameCellAction(a: CellActionView | null | undefined, b: CellActionView | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.label === b.label && a.title === b.title && a.tone === b.tone && a.icon === b.icon && Boolean(a.busy) === Boolean(b.busy);
}

export function CellActionButton({
  view,
  coarsePointer,
  onRun,
}: {
  view: CellActionView;
  coarsePointer?: boolean;
  onRun: () => void;
}) {
  const Icon = view.busy ? Loader2 : view.icon === "store" ? Store : view.icon === "alert" ? AlertTriangle : Send;
  return (
    <button
      type="button"
      data-cell-action
      disabled={view.busy}
      title={view.title}
      aria-label={view.title}
      className={cn(
        "absolute right-1 top-1/2 z-[5] inline-flex -translate-y-1/2 items-center gap-1 rounded-full border px-2 text-[11px] font-medium shadow-sm transition-colors disabled:opacity-70",
        coarsePointer ? "h-9" : "h-6",
        view.tone === "primary" && "border-primary/60 bg-primary text-primary-foreground hover:bg-primary/90",
        view.tone === "info" && "border-sky-400/50 bg-sky-400/15 text-sky-200 hover:bg-sky-400/25",
        view.tone === "warning" && "border-warning/60 bg-warning/20 text-warning hover:bg-warning/30"
      )}
      // Клик по кнопке не должен выделять ячейку и открывать выбор под ней.
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (!view.busy) onRun();
      }}
    >
      <Icon className={cn("h-3 w-3 shrink-0", view.busy && "animate-spin")} />
      <span className="max-w-[7rem] truncate">{view.label}</span>
    </button>
  );
}
