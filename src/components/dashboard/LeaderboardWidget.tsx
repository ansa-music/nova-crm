import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { cn } from "@/utils/cn";
import { formatCurrency } from "@/utils/format";
import { timeAgo } from "@/utils/date";
import { personLabel } from "@/utils/peopleDesks";
import type { LeaderboardEntry } from "@/types";

type MemberRow = {
  uid: string;
  name?: string;
  nickname?: string;
  photoURL?: string | null;
  lastActiveAt?: number;
  status: string;
  role: string;
};

export function LeaderboardWidget({
  entries,
  members,
  myUid,
  featured,
}: {
  entries: LeaderboardEntry[];
  members: MemberRow[];
  myUid?: string;
  featured?: boolean;
}) {
  // Ranked by total sum «Готово» (not %). A small list fully done shouldn't
  // outrank someone who closed more in absolute terms. Every active person
  // appears, even at 0 with no list yet. Several lists for one person sum
  // into one row.
  const ranked = useMemo(() => {
    return members
      .filter((m) => m.status === "active")
      .map((member) => {
        const myEntries = entries.filter((e) => e.responsibleUserId === member.uid);
        const doneTotal = myEntries.reduce((sum, e) => sum + e.doneTotal, 0);
        const grandTotal = myEntries.reduce((sum, e) => sum + e.grandTotal, 0);
        const pageNames = myEntries.map((e) => e.pageName);
        return { member, doneTotal, grandTotal, pageNames };
      })
      .sort((a, b) => b.doneTotal - a.doneTotal);
  }, [entries, members]);

  return (
    <Card className={cn("h-full overflow-hidden rounded-2xl border-border bg-card", featured && "min-h-[16rem]")}>
      <CardContent className={featured ? "p-5 sm:p-6" : "p-5"}>
        <p className="eyebrow mb-1 text-primary">Как ведут дело</p>
        <p className={cn(featured ? "mb-4 font-serif text-lg font-medium tracking-[-0.02em]" : "mb-3 text-sm font-medium")}>
          рейтинг по сумме «Готово»
        </p>
        {ranked.length === 0 ? (
          <p className="text-xs text-muted-foreground">Пока никого нет на столах.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {ranked.map(({ member, doneTotal, pageNames }, i) => {
              const mine = member.uid === myUid;
              return (
                <div
                  key={member.uid}
                  className={cn(
                    "flex items-center gap-2.5 rounded-xl px-2 py-2",
                    mine && "bg-primary/8 ring-1 ring-primary/25"
                  )}
                >
                  <span className="w-5 shrink-0 text-center font-mono text-[11px] tabular text-muted-foreground">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <MemberAvatar
                    id={member.uid}
                    name={member.name}
                    nickname={member.nickname}
                    photoURL={member.photoURL}
                    className={cn("h-8 w-8 shrink-0", mine && "ring-2 ring-primary")}
                  />
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-sm font-medium", mine && "text-primary")}>
                      {personLabel(member) || "—"}
                      {mine ? " · ты" : ""}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {pageNames.length > 0 ? pageNames.join(", ") : "нет листа"}
                      {member.lastActiveAt ? ` · заходил ${timeAgo(member.lastActiveAt)}` : ""}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 font-mono tabular",
                      featured ? "text-base" : "text-sm",
                      mine ? "text-primary" : "text-foreground"
                    )}
                  >
                    {formatCurrency(doneTotal)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
