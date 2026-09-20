import { useState } from "react";
import { Star } from "lucide-react";
import { TECH_RATING_MAX } from "@/types";
import { cn } from "@/utils/cn";

const STARS = Array.from({ length: TECH_RATING_MAX }, (_, i) => i + 1);

/**
 * Две шкалы живут рядом и их постоянно путают, если обе жёлтые: общая
 * оценка технаря — янтарная, оценка за конкретный заказ — фиолетовая.
 * Цвет здесь единственное различие, форма у обеих одна (звёзды), потому
 * что менять ещё и форму значит заставлять заново догадываться, что
 * значат 5 чего-то другого.
 */
export type RatingTone = "amber" | "violet";

const TONE: Record<RatingTone, { fill: string; empty: string }> = {
  amber: { fill: "fill-amber-400 text-amber-400", empty: "text-muted-foreground/40" },
  violet: { fill: "fill-violet-400 text-violet-400", empty: "text-muted-foreground/40" },
};

/** 1–5 stars. Without `onChange` it only displays `value` (fractions round to the nearest half star). */
export function StarRating({
  value,
  onChange,
  disabled,
  size = "md",
  label = "Оценка",
  tone = "amber",
}: {
  value: number | null;
  onChange?: (stars: number) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  label?: string;
  tone?: RatingTone;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const interactive = Boolean(onChange) && !disabled;
  const shown = interactive && hover !== null ? hover : value ?? 0;
  const iconClass = size === "sm" ? "h-3.5 w-3.5" : "h-5 w-5";
  const colors = TONE[tone];

  if (!onChange) {
    return (
      <span className="inline-flex items-center gap-px" aria-label={value ? `${label}: ${value.toFixed(1)} из ${TECH_RATING_MAX}` : label}>
        {STARS.map((n) => {
          const fill = Math.max(0, Math.min(1, Math.round((shown - (n - 1)) * 2) / 2));
          return (
            <span key={n} className={cn("relative inline-block", iconClass)}>
              <Star className={cn("absolute inset-0", colors.empty, iconClass)} />
              {fill > 0 && (
                <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
                  <Star className={cn(colors.fill, iconClass)} />
                </span>
              )}
            </span>
          );
        })}
      </span>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("inline-flex items-center", disabled && "opacity-45")}
      onMouseLeave={() => setHover(null)}
    >
      {STARS.map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} из ${TECH_RATING_MAX}`}
          disabled={disabled}
          onMouseEnter={() => setHover(n)}
          onFocus={() => setHover(n)}
          onBlur={() => setHover(null)}
          onClick={() => onChange(n)}
          className={cn(
            "rounded-md p-1 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            // Тач-размер только у кликабельных звёзд: этим же компонентом
            // оценки просто ПОКАЗЫВАЮТ (итоги месяца), и там 44px на звезду
            // разорвали бы узкую колонку.
            interactive && "flex h-11 w-11 items-center justify-center hover:scale-110 active:scale-95 sm:h-auto sm:w-auto",
            disabled && "cursor-not-allowed"
          )}
        >
          <Star
            className={cn(
              iconClass,
              "transition-colors",
              n <= shown ? colors.fill : colors.empty
            )}
          />
        </button>
      ))}
    </div>
  );
}
