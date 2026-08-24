import { DeskCoverStrip } from "@/components/dashboard/DeskCoverStrip";
import { deskOwnerName, resolvedCoverUrl } from "@/utils/peopleDesks";
import { cn } from "@/utils/cn";
import type { WorkspaceMember, WorkspacePage } from "@/types";

export function DeskCoverGrid({
  pages,
  members,
  ownerUid,
  onOpen,
  highlightedId,
}: {
  pages: WorkspacePage[];
  members: WorkspaceMember[];
  ownerUid?: string | null;
  onOpen: (page: WorkspacePage) => void;
  highlightedId?: string | null;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {pages.map((page) => {
        const who = deskOwnerName(members, page);
        const highlighted = highlightedId === page.id;
        return (
          <button
            key={page.id}
            type="button"
            onClick={() => onOpen(page)}
            className={cn(
              "group relative overflow-hidden rounded-xl border bg-card text-left transition-colors hover:border-primary/60 active:scale-[0.99]",
              highlighted ? "border-primary/70" : "border-primary/28"
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
  );
}
