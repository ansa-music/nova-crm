import { useState } from "react";
import { Loader2, Star, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/utils/cn";
import { formatScore, ORDER_RATING_MAX } from "@/types";

const SCORES = Array.from({ length: ORDER_RATING_MAX }, (_, i) => i + 1);

/**
 * Оценка заказа, 1–10 (одна система с 25.09.2026). Цвет оценок — янтарный
 * со звездой, чтобы не путать с акцентом (активный пункт, выделение).
 */
export const SCORE_TONE = {
  text: "text-amber-300",
  chip: "border-amber-400/40 bg-amber-400/12 text-amber-200",
  fill: "bg-amber-400 text-amber-950 border-amber-400",
  soft: "border-amber-400/30 bg-amber-400/15 text-amber-200",
  meter: "bg-amber-400",
} as const;

/** Подпись к баллу — чтобы «6» не читалось по-разному у разных ОС. */
export function scoreHint(score: number): string {
  if (score >= 9) return "отлично";
  if (score >= 7) return "хорошо";
  if (score >= 5) return "нормально";
  if (score >= 3) return "слабо";
  return "плохо";
}

/**
 * Десять кнопок в ряд (на узком — два ряда по пять). Кнопки до выбранной
 * подсвечены — уровень виден так же, как у звёзд; повторное нажатие на
 * выбранную снимает оценку.
 */
export function ScorePicker({
  value,
  onChange,
  disabled,
  label = "Оценка",
}: {
  value: number | null;
  onChange: (score: number | null) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="radiogroup"
        aria-label={label}
        className={cn("grid grid-cols-5 gap-1 xs:grid-cols-10", disabled && "opacity-50")}
        onMouseLeave={() => setHover(null)}
      >
        {SCORES.map((n) => {
          const on = n <= shown;
          const picked = value === n;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={picked}
              aria-label={`${n} из ${ORDER_RATING_MAX}`}
              disabled={disabled}
              onMouseEnter={() => setHover(n)}
              onFocus={() => setHover(n)}
              onBlur={() => setHover(null)}
              onClick={() => onChange(picked ? null : n)}
              className={cn(
                "flex h-10 min-w-0 items-center justify-center rounded-md border font-mono text-[13px] font-semibold tabular-nums transition-colors sm:h-8",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                on ? (picked || hover !== null ? SCORE_TONE.fill : SCORE_TONE.soft) : "border-border bg-background text-muted-foreground hover:bg-accent",
                disabled && "cursor-not-allowed"
              )}
            >
              {n}
            </button>
          );
        })}
      </div>
      <p className="h-4 text-[11px] leading-4 text-muted-foreground">
        {shown > 0 ? (
          <>
            <span className={cn("font-mono font-semibold tabular-nums", SCORE_TONE.text)}>
              {shown} из {ORDER_RATING_MAX}
            </span>{" "}
            · {scoreHint(shown)}
            {value !== null && hover === value ? " · нажмите ещё раз, чтобы снять" : ""}
          </>
        ) : (
          "1 — плохо, 10 — отлично"
        )}
      </p>
    </div>
  );
}

/**
 * Кнопка «Оценить» / «★ 8» у заказа в списке: по нажатию — окошко с
 * десятью баллами. В строке списка десять кнопок не помещаются рядом с
 * названием заказа (на телефоне тем более), поэтому выбор — за кликом.
 */
export function ScoreRateButton({
  value,
  onRate,
  disabled,
  label,
  className,
}: {
  value: number | null;
  onRate: (score: number | null) => Promise<void> | void;
  disabled?: boolean;
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  async function pick(score: number | null) {
    setSaving(true);
    try {
      await onRate(score);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Popover open={open} onOpenChange={(next) => !saving && setOpen(next)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={value ? `${label}: ${value} из ${ORDER_RATING_MAX} — изменить` : `${label}: оценить`}
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-1 rounded-md border px-2 text-[12px] font-medium transition-colors [@media(pointer:coarse)]:h-9",
            value
              ? SCORE_TONE.chip
              : "border-dashed border-amber-400/50 text-amber-200 hover:bg-amber-400/10",
            disabled && "cursor-not-allowed opacity-50",
            className
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Star className={cn("h-3.5 w-3.5", value && "fill-current")} />}
          {value ? (
            <span className="font-mono tabular-nums">
              {value}
              <span className="text-[10px] opacity-70">/10</span>
            </span>
          ) : (
            "Оценить"
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,22rem)] p-3" onClick={(e) => e.stopPropagation()}>
        <p className="mb-2 truncate text-[12px] font-medium">{label}</p>
        <ScorePicker value={value} onChange={(score) => void pick(score)} disabled={saving} label={label} />
        {value !== null && (
          <button
            type="button"
            disabled={saving}
            onClick={() => void pick(null)}
            className="mt-1 inline-flex h-8 items-center gap-1 rounded-md px-2 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
            Снять оценку
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Средний балл полоской и числом: «8,5 /10 · 12 заказов». */
export function ScoreMeter({
  average,
  count,
  size = "md",
  className,
}: {
  average: number | null;
  count: number;
  size?: "sm" | "md";
  className?: string;
}) {
  if (average === null || count === 0) {
    return <span className={cn("text-[11px] text-muted-foreground/70", className)}>оценок нет</span>;
  }
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <span className={cn("relative h-1.5 overflow-hidden rounded-full bg-muted", size === "sm" ? "w-12" : "w-20")} aria-hidden>
        <span className={cn("absolute inset-y-0 left-0 rounded-full", SCORE_TONE.meter)} style={{ width: `${(average / ORDER_RATING_MAX) * 100}%` }} />
      </span>
      <span className={cn("shrink-0 font-mono font-semibold tabular-nums", size === "sm" ? "text-xs" : "text-base leading-none")}>
        {formatScore(average)}
        <span className="text-[10px] font-normal text-muted-foreground">/10</span>
      </span>
    </span>
  );
}

/** Маленький чип для визитки: «★ 8,5». */
export function ScoreChip({ average, title }: { average: number | null; title?: string }) {
  if (average === null) return null;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4", SCORE_TONE.chip)}
      title={title ?? "Средняя оценка за заказы, из 10"}
    >
      <Star className="h-3 w-3 shrink-0 fill-current" />
      <span className="font-mono tabular-nums">{formatScore(average)}</span>
    </span>
  );
}
