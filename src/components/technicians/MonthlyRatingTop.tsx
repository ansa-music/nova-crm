import { Crown, Medal, PackageCheck, Star } from "lucide-react";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { StarRating } from "@/components/technicians/StarRating";
import { cn } from "@/utils/cn";
import { personLabel } from "@/utils/peopleDesks";
import type { WorkspaceMember } from "@/types";

export interface MonthlyTopEntry {
  member: WorkspaceMember;
  average: number;
  count: number;
}

/** Медаль за место, дальше просто номер — без золота у пятого места. */
const PLACE_TONE = [
  "border-amber-400/50 bg-amber-400/12 text-amber-300",
  "border-slate-300/45 bg-slate-300/12 text-slate-200",
  "border-orange-400/45 bg-orange-400/12 text-orange-300",
];

function Place({ index }: { index: number }) {
  const Icon = index === 0 ? Crown : Medal;
  return (
    <span
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
        index < 3 ? PLACE_TONE[index] : "border-border/70 text-muted-foreground"
      )}
      aria-label={`${index + 1} место`}
    >
      {index < 3 ? <Icon className="h-3.5 w-3.5" /> : index + 1}
    </span>
  );
}

function Column({
  kind,
  entries,
}: {
  kind: "overall" | "orders";
  entries: MonthlyTopEntry[];
}) {
  const orders = kind === "orders";
  const Icon = orders ? PackageCheck : Star;
  return (
    <div className="min-w-0 flex-1">
      <p
        className={cn(
          "mb-2 flex items-center gap-1.5 text-[11px] font-medium",
          orders ? "text-violet-300" : "text-amber-300"
        )}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" />
        {orders ? "По заказам" : "Общая оценка"}
      </p>
      {entries.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">В том месяце по этой шкале не оценивали.</p>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {entries.map((entry, index) => (
            <li key={entry.member.uid} className="flex min-w-0 items-center gap-2">
              <Place index={index} />
              <MemberAvatar
                id={entry.member.uid}
                name={entry.member.name}
                nickname={entry.member.nickname}
                photoURL={entry.member.photoURL}
                className="h-6 w-6 shrink-0"
              />
              <span className="min-w-0 flex-1 truncate text-xs">{personLabel(entry.member)}</span>
              <StarRating value={entry.average} size="sm" tone={orders ? "violet" : "amber"} />
              <span className="w-8 shrink-0 text-right font-mono text-xs font-semibold tabular-nums">
                {entry.average.toFixed(1)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * Закреплённый итог прошлого месяца. Висит над живыми оценками весь
 * следующий месяц и решает ровно одну проблему: первого числа все счётчики
 * обнуляются, и без этой карточки экран выглядит так, будто технарей никто
 * никогда не оценивал, а ОС не понимает, что месяц просто начался заново.
 *
 * Показывает обе шкалы отдельно — они независимы, и «лучший по общей» и
 * «лучший по заказам» часто разные люди; сводить их в один балл значит
 * выдумывать вес, которого никто не задавал.
 */
export function MonthlyRatingTop({
  monthLabel,
  overall,
  orders,
}: {
  monthLabel: string;
  overall: MonthlyTopEntry[];
  orders: MonthlyTopEntry[];
}) {
  if (overall.length === 0 && orders.length === 0) return null;
  return (
    <section className="rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/[0.07] to-transparent p-4">
      <header className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
        <Crown className="h-4 w-4 shrink-0 text-amber-300" />
        <h2 className="text-sm font-medium">Итоги за {monthLabel}</h2>
        <span className="rounded-full border border-border/70 px-2 py-px text-[10px] text-muted-foreground">
          закреплено
        </span>
        <p className="w-full text-[11px] text-muted-foreground sm:w-auto sm:flex-1 sm:text-right">
          Этот месяц оценивается заново
        </p>
      </header>
      <div className="flex flex-col gap-4 sm:flex-row sm:gap-6">
        <Column kind="overall" entries={overall} />
        <Column kind="orders" entries={orders} />
      </div>
    </section>
  );
}
