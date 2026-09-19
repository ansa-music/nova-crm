import { PackageCheck, Star } from "lucide-react";
import { StarRating, type RatingTone } from "@/components/technicians/StarRating";
import { cn } from "@/utils/cn";

export type RatingKind = "overall" | "orders";

const KIND: Record<RatingKind, { label: string; hint: string; tone: RatingTone; accent: string; box: string }> = {
  overall: {
    label: "Общая",
    hint: "Одна оценка от каждого ОС — про работу с технарём в целом",
    tone: "amber",
    accent: "text-amber-300",
    box: "border-amber-400/25 bg-amber-400/[0.07]",
  },
  orders: {
    label: "По заказам",
    hint: "Среднее по оценкам отдельных заказов",
    tone: "violet",
    accent: "text-violet-300",
    box: "border-violet-400/25 bg-violet-400/[0.07]",
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

/**
 * Одна из двух шкал.
 *
 * Название НЕ усекается: усечённое «По за…» ничего не объясняет, а две
 * шкалы различаются как раз названием и цветом. Поэтому плашка живёт в
 * полную ширину карточки, а не в узкой колонке шапки, и число уехало на
 * вторую строку к звёздам, где места больше.
 */
function RatingScore({ kind, average, count }: { kind: RatingKind; average: number | null; count: number }) {
  const meta = KIND[kind];
  const Icon = kind === "orders" ? PackageCheck : Star;
  const empty = average === null || count === 0;
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 flex-col gap-1.5 rounded-xl border px-2.5 py-2",
        empty ? "border-border/50 bg-background/30" : meta.box
      )}
      title={meta.hint}
    >
      <p className="flex min-w-0 items-center gap-1.5">
        <Icon className={cn("h-3.5 w-3.5 shrink-0", empty ? "text-muted-foreground/60" : meta.accent)} />
        <span className="whitespace-nowrap text-[11px] font-medium text-muted-foreground">{meta.label}</span>
        <span className="ml-auto shrink-0 whitespace-nowrap text-[10px] text-muted-foreground">
          {empty ? "" : `${count} ${countWord(count, kind)}`}
        </span>
      </p>
      {/* Пустая шкала НЕ рисует ряд пустых звёзд: пять контуров и прочерк
          читаются как сломанный или отключённый контрол, в который зачем-то
          тыкают. Одна строчка словами честнее и тише. */}
      {empty ? (
        <p className="text-[11px] leading-5 text-muted-foreground/70">оценок нет</p>
      ) : (
        <p className="flex min-w-0 items-center gap-2">
          <StarRating value={average} size="sm" tone={meta.tone} label={meta.label} />
          <span className="ml-auto shrink-0 font-mono text-base font-semibold leading-none tabular-nums">
            {average.toFixed(1)}
          </span>
        </p>
      )}
    </div>
  );
}

/**
 * Обе шкалы рядом — единственный способ, которым они показываются.
 *
 * Пока не поставлено НИ ОДНОЙ оценки, две пустые плашки с прочерками — это
 * два заметных блока, не несущих ничего. Такой случай схлопывается в одну
 * спокойную строку: информации столько же, шума в разы меньше, и карточка
 * технаря без оценок перестаёт выглядеть сломанной.
 */
export function RatingScorePair({
  overall,
  orders,
  className,
}: {
  overall: { average: number | null; count: number };
  orders: { average: number | null; count: number };
  className?: string;
}) {
  const nothing = overall.count === 0 && orders.count === 0;
  if (nothing) {
    return (
      <p className={cn("flex items-center gap-1.5 text-[11px] text-muted-foreground", className)}>
        <Star className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
        Оценок в этом месяце ещё нет
      </p>
    );
  }
  return (
    <div className={cn("flex items-stretch gap-2", className)}>
      <RatingScore kind="overall" average={overall.average} count={overall.count} />
      <RatingScore kind="orders" average={orders.average} count={orders.count} />
    </div>
  );
}
