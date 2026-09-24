import { AlertTriangle, Check, Hand, Loader2, Send, Store, UserPlus } from "lucide-react";
import { cn } from "@/utils/cn";

/**
 * Кнопка-действие в ячейке строки. Таблица сама про заказы ничего не знает:
 * что нарисовать, решает страница (`DataTable.cellAction`). Сейчас это стол
 * ОС — чип состояния в ячейке «Технарь» (`utils/osTechCell.ts`: «Выдать…»,
 * «Отдать», «Выбрать», «Не доехал», ✓ у технаря).
 */
export interface CellActionView {
  /**
   * Состояние, из которого метка (стол ОС: `OsTechCellKind`). По нему метки и
   * сравниваются: две разных метки с одной подписью — всё равно разные.
   */
  kind?: string;
  label: string;
  title: string;
  /**
   * Один акцент на стол (тема «один акцент, плоско»): `action` — действие,
   * `neutral` — ждём, `warning` — внимание, `success` — только значок.
   * `primary`/`info` — прежние имена тех же тонов.
   */
  tone: "action" | "neutral" | "warning" | "success" | "primary" | "info";
  icon?: "send" | "store" | "alert" | "hand" | "check" | "user";
  busy?: boolean;
  /** Только показ (✓, «едет»): не кнопка, нажатие уходит в саму ячейку. */
  passive?: boolean;
}

export function sameCellAction(a: CellActionView | null | undefined, b: CellActionView | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return (
    a.kind === b.kind &&
    a.label === b.label &&
    a.title === b.title &&
    a.tone === b.tone &&
    a.icon === b.icon &&
    Boolean(a.busy) === Boolean(b.busy) &&
    Boolean(a.passive) === Boolean(b.passive)
  );
}

const ICONS = { send: Send, store: Store, alert: AlertTriangle, hand: Hand, check: Check, user: UserPlus } as const;

function toneClass(tone: CellActionView["tone"]): string {
  switch (tone) {
    case "action":
    case "primary":
      return "border-primary/30 bg-primary/12 text-primary hover:bg-primary/20";
    case "warning":
      return "border-warning/40 bg-warning/12 text-warning hover:bg-warning/20";
    case "success":
      return "border-transparent bg-transparent px-1 text-success";
    default:
      return "border-border bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground";
  }
}

export function CellActionButton({
  view,
  coarsePointer,
  onRun,
  inline = false,
}: {
  view: CellActionView;
  coarsePointer?: boolean;
  onRun: () => void;
  /**
   * В потоке ячейки (рядом с подписью), а не поверх неё. Поверх — прежний
   * вид для обычных ячеек: там метка перекрывала текст, и в ячейке «Технарь»
   * она закрывала ровно имя технаря.
   */
  inline?: boolean;
}) {
  const Icon = view.busy ? Loader2 : view.icon ? ICONS[view.icon] : null;
  const className = cn(
    "inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 text-[11px] font-medium transition-colors disabled:opacity-70",
    coarsePointer ? "h-9 px-2.5 text-[12px]" : "h-6",
    toneClass(view.tone),
    // Поверх текста ячейки подложка непрозрачная, иначе текст просвечивал бы.
    !inline && "absolute right-1 top-1/2 z-[5] -translate-y-1/2 bg-background"
  );
  const content = (
    <>
      {Icon ? <Icon className={cn("h-3 w-3 shrink-0", coarsePointer && "h-3.5 w-3.5", view.busy && "animate-spin")} /> : null}
      {view.label ? <span className="max-w-[7rem] truncate">{view.label}</span> : null}
    </>
  );
  if (view.passive) {
    return (
      <span data-cell-action className={cn(className, "cursor-default hover:bg-transparent")} title={view.title} aria-label={view.title}>
        {content}
      </span>
    );
  }
  return (
    <button
      type="button"
      data-cell-action
      disabled={view.busy}
      title={view.title}
      aria-label={view.label ? `${view.label}: ${view.title}` : view.title}
      className={className}
      // Клик по кнопке не должен выделять ячейку и открывать выбор под ней.
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (!view.busy) onRun();
      }}
    >
      {content}
    </button>
  );
}
