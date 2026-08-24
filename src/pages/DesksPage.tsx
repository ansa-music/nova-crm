import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useNavigate } from "react-router";
import { EmptyState } from "@/components/common/EmptyState";
import { DeskCoverStrip } from "@/components/dashboard/DeskCoverStrip";
import { Skeleton } from "@/components/ui/skeleton";
import { usePeopleDesks } from "@/hooks/usePeopleDesks";
import { personLabel, resolvedCoverUrl } from "@/utils/peopleDesks";
import { cn } from "@/utils/cn";

export default function DesksPage() {
  const navigate = useNavigate();
  const { studioPages, groups, isLoadingWorkspaceData, ownerUid } = usePeopleDesks();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return studioPages;
    return studioPages.filter((page) => {
      const group = groups.find((g) => g.pages.some((p) => p.id === page.id));
      const who = personLabel(group?.member) || "";
      return page.name.toLowerCase().includes(q) || who.toLowerCase().includes(q);
    });
  }, [studioPages, groups, query]);

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
          <h1 className="font-serif text-[1.85rem] font-medium tracking-[-0.03em] sm:text-[2.15rem]">Столы</h1>
          <p className="mt-1 text-sm text-muted-foreground">Открой стол по обложке.</p>
        </div>
        <label className="flex h-11 w-full max-w-sm items-center gap-2 rounded-full border border-border bg-card/80 px-4 text-[13px] text-muted-foreground">
          <Search className="h-3.5 w-3.5 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Название стола"
            className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
      </header>

      {filtered.length === 0 ? (
        <EmptyState className="rounded-2xl border border-border bg-card py-16" title={query ? "Нет таких столов" : "Пока нет столов"} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((page) => {
            const group = groups.find((g) => g.pages.some((p) => p.id === page.id));
            const who = personLabel(group?.member);
            return (
              <button
                key={page.id}
                type="button"
                onClick={() => navigate(`/page/${page.id}`)}
                className={cn(
                  "group relative overflow-hidden rounded-[1.35rem] border border-border bg-card text-left transition-colors hover:border-primary/40"
                )}
              >
                <DeskCoverStrip coverUrl={resolvedCoverUrl(page, ownerUid)} name={page.name} ratio="thumb" />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                <span className="absolute inset-x-0 bottom-0 z-[1] p-4">
                  <span className="block truncate font-serif text-[1.05rem] font-medium tracking-[-0.02em] text-white">
                    {page.name}
                  </span>
                  {who ? <span className="block truncate text-[12px] text-white/75">{who}</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
