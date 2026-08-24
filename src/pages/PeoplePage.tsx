import { useMemo, useState } from "react";
import { Search, UsersRound } from "lucide-react";
import { useNavigate } from "react-router";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { EmptyState } from "@/components/common/EmptyState";
import { DeskCoverStrip } from "@/components/dashboard/DeskCoverStrip";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { usePeopleDesks } from "@/hooks/usePeopleDesks";
import { groupDeskSubtitle, personLabel, resolvedCoverUrl } from "@/utils/peopleDesks";
import { cn } from "@/utils/cn";

export default function PeoplePage() {
  const navigate = useNavigate();
  const { groups, isLoadingWorkspaceData, selectPerson, ownerUid } = usePeopleDesks();
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

  function openDesk(key: string, pageId: string | undefined) {
    selectPerson(key);
    if (pageId) navigate(`/page/${pageId}`);
    else navigate("/");
  }

  if (isLoadingWorkspaceData) {
    return (
      <div className="mx-auto max-w-6xl p-5 sm:p-8 lg:p-10">
        <Skeleton className="mb-6 h-10 w-48" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[4/3] w-full rounded-[1.35rem]" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="relative mx-auto max-w-6xl p-5 sm:p-8 lg:p-10">
      <header className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow mb-1 text-primary">Studio</p>
          <h1 className="font-serif text-[1.85rem] font-medium tracking-[-0.03em] sm:text-[2.15rem]">Люди</h1>
          <p className="mt-1 text-sm text-muted-foreground">Открой стол человека.</p>
        </div>
        <label className="flex h-11 w-full max-w-sm items-center gap-2 rounded-full border border-border bg-card/80 px-4 text-[13px] text-muted-foreground">
          <Search className="h-3.5 w-3.5 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Имя или стол"
            className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
      </header>

      {filtered.length === 0 ? (
        <EmptyState className="rounded-2xl border border-border bg-card py-16" title={query ? "Никого не нашлось" : "Пока никого нет"} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((group) => {
            const coverPage = group.pages[0];
            const name = personLabel(group.member) || (group.uid ? "Стол" : "Без ответственного");
            const desk = groupDeskSubtitle(group);
            return (
              <button
                key={group.key}
                type="button"
                onClick={() => openDesk(group.key, coverPage?.id)}
                className={cn(
                  "group relative overflow-hidden rounded-[1.35rem] border border-border bg-card text-left transition-colors hover:border-primary/40"
                )}
              >
                <DeskCoverStrip coverUrl={resolvedCoverUrl(coverPage, ownerUid)} name={name} ratio="thumb" />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 z-[1] flex items-end gap-3 p-4">
                  {group.member ? (
                    <MemberAvatar
                      id={group.member.uid}
                      name={group.member.name}
                      nickname={group.member.nickname}
                      photoURL={group.member.photoURL}
                      className="h-11 w-11 shrink-0 ring-2 ring-[hsl(36_40%_96%)]/30"
                    />
                  ) : (
                    <Avatar className="h-11 w-11 shrink-0 ring-2 ring-[hsl(36_40%_96%)]/30">
                      <AvatarFallback>
                        <UsersRound className="h-4 w-4" />
                      </AvatarFallback>
                    </Avatar>
                  )}
                  <span className="min-w-0 flex-1 pb-0.5">
                    <span className="block truncate font-serif text-[1.05rem] font-medium tracking-[-0.02em] text-[hsl(36_40%_96%)]">
                      {name}
                    </span>
                    {desk ? (
                      <span className="block truncate text-[12px] text-[hsl(36_30%_82%)]">{desk}</span>
                    ) : null}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
