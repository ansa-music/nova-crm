import { PackageCheck, Star } from "lucide-react";
import { StarRating, type RatingTone } from "@/components/technicians/StarRating";
import { cn } from "@/utils/cn";

export type RatingKind = "overall" | "orders";

/**
 * Две шкалы показываются всегда вместе и всегда в одном порядке — общая
 * слева, по заказам справа. Пустую не прячем: «оценок нет» — это тоже
 * ответ, а исчезающая плашка заставляет гадать, то ли оценок нет, то ли
 * шкала не про этого человека.
 */
const KIND: Record<RatingKind, { label: string; hint: string; tone: RatingTone; accent: string; box: string }> = {
  overall: {
    label: "Общая",
    hint: "Одна оценка от каждого ОС — про работу с технарём в целом",
    tone: "amber",
    accent: "text-amber-300",
    box: "border-amber-400/25 bg-amber-400/[0.06]",
  },
  orders: {
    label: "По заказам",
    hint: "Среднее по оценкам отдельных заказов",
    tone: "violet",
    accent: "text-violet-300",
    box: "border-violet-400/25 bg-violet-400/[0.06]",
  },
};

function countWord(n: number, kind: RatingKind) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const one = kind === "orders" ? "заказ" : "оценка";
  const few = kind === "orders" ? "заказа" : "оценки";
  const many = kind === "orders" ? "заказов" : "оценок";
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Одна из двух шкал: иконка, само число, звёзды и сколько оценок за ним стоит. */
export function RatingScore({
  kind,
  average,
  count,
  className,
}: {
  kind: RatingKind;
  average: number | null;
  count: number;
  className?: string;
}) {
  const meta = KIND[kind];
  const Icon = kind === "orders" ? PackageCheck : Star;
  const empty = average === null || count === 0;
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 flex-col gap-1 rounded-xl border px-2.5 py-2",
        empty ? "border-border/60 bg-muted/20" : meta.box,
        className
      )}
      title={meta.hint}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <Icon className={cn("h-3.5 w-3.5 shrink-0", empty ? "text-muted-foreground" : meta.accent)} />
        <span className="truncate text-[11px] font-medium text-muted-foreground">{meta.label}</span>
        <span className={cn("ml-auto shrink-0 font-mono text-sm font-semibold tabular-nums", empty && "text-muted-foreground")}>
          {empty ? "—" : average.toFixed(1)}
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-1.5">
        <StarRating value={empty ? 0 : average} size="sm" tone={meta.tone} label={meta.label} />
        <span className="ml-auto shrink-0 truncate text-[10px] text-muted-foreground">
          {empty ? "нет" : `${count} ${countWord(count, kind)}`}
        </span>
      </div>
    </div>
  );
}

/** Обе шкалы рядом — единственный способ, которым они показываются. */
export function RatingScorePair({
  overall,
  orders,
  className,
}: {
  overall: { average: number | null; count: number };
  orders: { average: number | null; count: number };
  className?: string;
}) {
  return (
    <div className={cn("flex items-stretch gap-1.5", className)}>
      <RatingScore kind="overall" average={overall.average} count={overall.count} />
      <RatingScore kind="orders" average={orders.average} count={orders.count} />
    </div>
  );
}
