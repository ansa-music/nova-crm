import type { ReactNode } from "react";
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
  canOpen,
  renderAction,
}: {
  pages: WorkspacePage[];
  members: WorkspaceMember[];
  ownerUid?: string | null;
  onOpen: (page: WorkspacePage) => void;
  highlightedId?: string | null;
  canOpen?: (page: WorkspacePage) => boolean;
  renderAction?: (page: WorkspacePage) => ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {pages.map((page) => {
        const who = deskOwnerName(members, page);
        const highlighted = highlightedId === page.id;
        const openable = canOpen ? canOpen(page) : true;
        const action = !openable ? renderAction?.(page) : null;
        const cover = (
          <>
            <DeskCoverStrip coverUrl={resolvedCoverUrl(page, ownerUid)} name={page.name} ratio="thumb" />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
            <span className="absolute inset-x-0 bottom-0 z-[1] p-4">
              <span className="block truncate font-serif text-[1.05rem] font-medium tracking-[-0.02em] text-white">
                {page.name}
              </span>
              {who ? <span className="block truncate text-[12px] text-white/75">{who}</span> : null}
            </span>
          </>
        );
        return (
          <div
            key={page.id}
            className={cn(
              "relative overflow-hidden rounded-xl border bg-card text-left",
              highlighted ? "border-primary/70" : "border-primary/28",
              openable && "transition-colors hover:border-primary/60"
            )}
          >
            {openable ? (
              <button
                type="button"
                onClick={() => onOpen(page)}
                className="group relative block w-full overflow-hidden text-left active:scale-[0.99]"
              >
                {cover}
              </button>
            ) : (
              <div className="relative overflow-hidden">{cover}</div>
            )}
            {action ? <div className="border-t border-primary/20 p-3">{action}</div> : null}
          </div>
        );
      })}
    </div>
  );
}
