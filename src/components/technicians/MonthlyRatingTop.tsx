import { Crown, Medal } from "lucide-react";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { ScoreMeter } from "@/components/technicians/ScoreRating";
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

/**
 * Закреплённый итог прошлого месяца по оценкам заказов (1–10). Висит над
 * живыми оценками весь следующий месяц: первого числа счётчики обнуляются,
 * и без этой карточки экран выглядел бы так, будто технарей никто никогда
 * не оценивал.
 */
export function MonthlyRatingTop({ monthLabel, entries }: { monthLabel: string; entries: MonthlyTopEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <header className="mb-3 flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Crown className="h-4 w-4 shrink-0 text-amber-300" />
          <h2 className="section">Лучшие по оценкам за {monthLabel}</h2>
          <span className="rounded-full border border-border/70 px-2 py-px text-[10px] text-muted-foreground">закреплено</span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Средняя оценка заказов из 10. Этот месяц оценивается заново — счётчики обнулились первого числа.
        </p>
      </header>
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
            <span className="hidden shrink-0 text-[10px] text-muted-foreground xs:inline">{entry.count} зак.</span>
            <ScoreMeter average={entry.average} count={entry.count} size="sm" />
          </li>
        ))}
      </ol>
    </section>
  );
}
