import * as React from "react";
import { cn } from "@/utils/cn";

export type ChipTone = "neutral" | "primary" | "success" | "warning" | "danger";
export type ChipSize = "sm" | "md";

/**
 * Активное состояние по тону. Полные строки классов, а не шаблон — Tailwind
 * собирает только те утилиты, что видит в исходнике. `neutral` и `primary`
 * дают один и тот же акцент: у темы он единственный, и «нейтральный» чип в
 * активном состоянии всё равно должен подсвечиваться им.
 */
const ACTIVE_BY_TONE: Record<ChipTone, string> = {
  neutral: "border-primary/30 bg-primary/[0.12] text-primary",
  primary: "border-primary/30 bg-primary/[0.12] text-primary",
  success: "border-success/30 bg-success/[0.12] text-success",
  warning: "border-warning/30 bg-warning/[0.12] text-warning",
  danger: "border-destructive/30 bg-destructive/[0.12] text-destructive",
};

const SIZE_CLASS: Record<ChipSize, string> = {
  sm: "h-7 px-2 sm:h-7",
  md: "h-8 px-2.5 sm:h-8",
};

/**
 * Классы чипа без разметки — для мест, где уже есть свой `<button>`
 * (`pageChipClass` в PageHeader, сегменты в тулбарах). Тач-норму даёт тач-блок
 * index.css по классу `.chip`, поэтому `h-*` здесь только десктопная.
 */
export function chipClass(opts: { active?: boolean; tone?: ChipTone; size?: ChipSize; interactive?: boolean } = {}) {
  const { active = false, tone = "neutral", size = "md", interactive = true } = opts;
  return cn(
    "chip inline-flex shrink-0 select-none items-center gap-1.5 whitespace-nowrap rounded-md border text-[12px] font-medium leading-none transition-colors",
    SIZE_CLASS[size],
    active
      ? ACTIVE_BY_TONE[tone]
      : cn("border-border bg-transparent text-muted-foreground", interactive && "hover:bg-accent hover:text-foreground"),
    interactive && "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
  );
}

export interface ChipProps extends Omit<React.HTMLAttributes<HTMLElement>, "onClick"> {
  /** Тон активного состояния и точки. Idle у всех тонов одинаковый — серый. */
  tone?: ChipTone;
  /** `sm` — 28px, `md` — 32px на десктопе; на таче оба дорастают до 36px. */
  size?: ChipSize;
  /** Включённый фильтр/сегмент. Ставит `aria-pressed` у кнопки. */
  active?: boolean;
  onClick?: React.MouseEventHandler<HTMLElement>;
  /** Счётчик справа от подписи (моно, приглушённый). */
  count?: number | string;
  /** HSL-триплет «h s% l%» (формат `statusOptions.color`) — цветная точка слева. */
  dot?: string;
  /** `button` когда есть `onClick`, иначе `span`. Явно — чтобы переопределить. */
  as?: "button" | "span";
  disabled?: boolean;
}

/**
 * Чип — фильтр, сегмент или короткий признак («Только просмотр», «N новых»).
 * Плоский: рамка `border-border`, активный — тонированная заливка в тоне.
 * Кнопкой становится сам, когда есть `onClick`.
 */
export const Chip = React.forwardRef<HTMLElement, ChipProps>(
  ({ tone = "neutral", size = "md", active = false, onClick, count, dot, as, disabled, className, children, ...rest }, ref) => {
    const Tag = (as ?? (onClick ? "button" : "span")) as "button" | "span";
    const interactive = Tag === "button";
    const classes = cn(chipClass({ active, tone, size, interactive }), disabled && "pointer-events-none opacity-50", className);
    const content = (
      <>
        {dot && <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: `hsl(${dot})` }} />}
        {children}
        {count !== undefined && count !== null && (
          <span className="font-mono text-[11px] tabular-nums opacity-70">{count}</span>
        )}
      </>
    );
    if (Tag === "button") {
      return (
        <button
          ref={ref as React.Ref<HTMLButtonElement>}
          type="button"
          aria-pressed={onClick ? active : undefined}
          disabled={disabled}
          onClick={onClick}
          className={classes}
          {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}
        >
          {content}
        </button>
      );
    }
    return (
      <span ref={ref as React.Ref<HTMLSpanElement>} className={classes} {...rest}>
        {content}
      </span>
    );
  }
);
Chip.displayName = "Chip";
