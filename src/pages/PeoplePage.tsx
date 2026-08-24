import { useMemo, useState } from "react";
import { Search, UsersRound } from "lucide-react";
import { useNavigate } from "react-router";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { EmptyState } from "@/components/common/EmptyState";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { usePeopleDesks } from "@/hooks/usePeopleDesks";
import { groupDeskSubtitle, personLabel } from "@/utils/peopleDesks";
import { ROLE_LABELS } from "@/types";
import { cn } from "@/utils/cn";

export default function PeoplePage() {
  const navigate = useNavigate();
  const { groups, isLoadingWorkspaceData, selectPerson } = usePeopleDesks({ syncPersonSelection: true });
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => {
      const name = personLabel(g.member) || (g.uid ? "Стол" : "Без ответственного");
      const desk = groupDeskSubtitle(g);
      return name.toLowerCase().includes(q) || desk.toLowerCase().includes(q);
    });
  }, [groups, query]);

  if (isLoadingWorkspaceData) {
    return (
      <div className="mx-auto max-w-2xl p-5 sm:p-8">
        <Skeleton className="mb-6 h-10 w-48" />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="mb-2 h-16 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-5 sm:p-8">
      <header className="mb-7">
        <p className="eyebrow mb-1 text-primary">Студия</p>
        <h1 className="font-serif text-[1.85rem] font-medium tracking-[-0.03em] sm:text-[2.15rem]">Люди</h1>
        <p className="mt-1 mb-5 text-sm text-muted-foreground">Лица команды. Нажми — откроется его стол.</p>
        <label className="flex h-11 w-full items-center gap-2 rounded-full border border-border bg-card/80 px-4 text-[13px] text-muted-foreground">
          <Search className="h-3.5 w-3.5 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Имя"
            className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
      </header>

      {filtered.length === 0 ? (
        <EmptyState className="rounded-2xl border border-border bg-card py-16" title={query ? "Никого не нашлось" : "Пока никого нет"} />
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((group) => {
            const coverPage = group.pages[0];
            const name = personLabel(group.member) || (group.uid ? "Стол" : "Без ответственного");
            const desk = groupDeskSubtitle(group);
            const role = group.member?.role ? ROLE_LABELS[group.member.role] : null;
            return (
              <button
                key={group.key}
                type="button"
                onClick={() => {
                  selectPerson(group.key);
                  if (coverPage) navigate(`/page/${coverPage.id}`);
                }}
                className={cn(
                  "flex min-h-16 w-full items-center gap-3 rounded-2xl border border-border bg-card px-3 py-3 text-left hover:border-primary/40"
                )}
              >
                {group.member ? (
                  <MemberAvatar
                    id={group.member.uid}
                    name={group.member.name}
                    nickname={group.member.nickname}
                    photoURL={group.member.photoURL}
                    className="h-12 w-12 shrink-0"
                  />
                ) : (
                  <Avatar className="h-12 w-12 shrink-0">
                    <AvatarFallback>
                      <UsersRound className="h-4 w-4" />
                    </AvatarFallback>
                  </Avatar>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-foreground">{name}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">
                    {[role, desk].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
