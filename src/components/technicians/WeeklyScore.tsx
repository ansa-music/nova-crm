import { CalendarCheck2, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/utils/cn";
import { formatScore } from "@/types";
import { roundLabel, type WeeklyScore } from "@/services/weeklyRatingService";

/**
 * Оценка недели — цветом акцента и с календарём, чтобы не путать с оценкой
 * заказов (янтарная звезда): это два разных числа.
 */
export const WEEKLY_TONE = {
  chip: "border-primary/35 bg-primary/10 text-primary",
  meter: "bg-primary",
} as const;

export function weeklyTitle(score: WeeklyScore, who: "tech" | "os") {
  const from = who === "tech" ? "ОС" : "технари";
  return `Оценка недели (${roundLabel(score.round)}): ${formatScore(score.avg)} из 10 · оценили ${score.count} (${from}, анонимно)${
    score.avg4 !== null ? ` · за 4 оценки ${formatScore(score.avg4)}` : ""
  }`;
}

/** Маленький чип: «📅 8,4 ▲». */
export function WeeklyScoreChip({
  score,
  who,
  className,
  label,
}: {
  score: WeeklyScore | null;
  who: "tech" | "os";
  className?: string;
  /** Подпись перед числом («неделя»). */
  label?: string;
}) {
  if (!score) return null;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4", WEEKLY_TONE.chip, className)}
      title={weeklyTitle(score, who)}
    >
      <CalendarCheck2 className="h-3 w-3 shrink-0" />
      {label ? <span className="text-[10px] font-normal opacity-80">{label}</span> : null}
      <span className="font-mono tabular-nums">{formatScore(score.avg)}</span>
      {score.delta !== null && score.delta !== 0 ? (
        score.delta > 0 ? (
          <TrendingUp className="h-3 w-3 shrink-0 text-success" aria-label={`выше на ${formatScore(score.delta)}`} />
        ) : (
          <TrendingDown className="h-3 w-3 shrink-0 text-destructive" aria-label={`ниже на ${formatScore(-score.delta)}`} />
        )
      ) : null}
    </span>
  );
}

/** Столбики по неделям (старые слева): видно, растёт человек или падает. */
export function WeeklySparkline({ history, className }: { history: (number | null)[]; className?: string }) {
  const weeks = [...history].reverse();
  return (
    <span className={cn("inline-flex h-5 items-end gap-0.5", className)} aria-hidden>
      {weeks.map((v, i) => (
        <span
          key={i}
          className={cn("w-1.5 rounded-sm", v === null ? "h-0.5 bg-muted-foreground/30" : i === weeks.length - 1 ? WEEKLY_TONE.meter : "bg-primary/45")}
          style={v === null ? undefined : { height: `${Math.max(12, (v / 10) * 100)}%` }}
        />
      ))}
    </span>
  );
}
