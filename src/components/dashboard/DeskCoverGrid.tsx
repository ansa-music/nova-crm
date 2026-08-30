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
  onRequest,
  isPending,
  progressByPageId,
}: {
  pages: WorkspacePage[];
  members: WorkspaceMember[];
  ownerUid?: string | null;
  onOpen: (page: WorkspacePage) => void;
  highlightedId?: string | null;
  canOpen?: (page: WorkspacePage) => boolean;
  renderAction?: (page: WorkspacePage) => ReactNode;
  onRequest?: (page: WorkspacePage) => void;
  isPending?: (page: WorkspacePage) => boolean;
  progressByPageId?: Record<string, number>;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {pages.map((page) => {
        const who = deskOwnerName(members, page);
        const highlighted = highlightedId === page.id;
        const openable = canOpen ? canOpen(page) : true;
        const pending = Boolean(!openable && isPending?.(page));
        const action = renderAction?.(page) ?? null;
        return (
          <div
            key={page.id}
            className={cn(
              "relative overflow-hidden rounded-xl border bg-card text-left reflective-sheen",
              highlighted ? "border-primary/70" : "border-primary/28",
              (openable || !pending) && "transition-colors hover:border-primary/60"
            )}
          >
            <DeskCoverStrip
              coverUrl={resolvedCoverUrl(page, ownerUid)}
              name={page.name}
              ratio="thumb"
              progressPercent={progressByPageId?.[page.id] ?? null}
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background via-background/45 to-transparent" />

            {openable ? (
              <button
                type="button"
                onClick={() => onOpen(page)}
                className="absolute inset-0 z-[1] active:scale-[0.99]"
                aria-label={page.name}
              />
            ) : !pending && onRequest ? (
              <button
                type="button"
                onClick={() => onRequest(page)}
                className="absolute inset-0 z-[1] active:scale-[0.99]"
                aria-label="Запросить просмотр"
              />
            ) : null}

            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] flex flex-col gap-2 p-4">
              <div>
                <span className="block truncate font-serif text-[1.05rem] font-medium tracking-[-0.02em] text-white">
                  {page.name}
                </span>
                {who ? <span className="block truncate text-[12px] text-white/75">{who}</span> : null}
              </div>
              {action ? (
                <div className={openable ? "pointer-events-none" : "pointer-events-auto"}>{action}</div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
