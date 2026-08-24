import { Settings2 } from "lucide-react";
import { Link } from "react-router";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { DeskCoverStrip, deskInitials } from "@/components/dashboard/DeskCoverStrip";
import { cn } from "@/utils/cn";
import { formatCurrency } from "@/utils/format";
import type { WorkspacePage } from "@/types";

type DeskMember = {
  uid: string;
  name?: string;
  nickname?: string;
  photoURL?: string | null;
} | null;

interface DeskCardProps {
  page: WorkspacePage;
  title: string;
  member?: DeskMember;
  doneTotal: number;
  percent: number;
  openCount: number;
  highlighted?: boolean;
  canManage?: boolean;
  onCustomize?: () => void;
  onHover?: (id: string | null) => void;
}

export function DeskCard({
  page,
  title,
  member,
  doneTotal,
  percent,
  openCount,
  highlighted,
  canManage,
  onCustomize,
  onHover,
}: DeskCardProps) {
  const letter = deskInitials(title || page.name);

  return (
    <Link
      to={`/page/${page.id}`}
      className={cn("desk-card", highlighted && "desk-card-active")}
      onMouseEnter={() => onHover?.(page.id)}
      onMouseLeave={() => onHover?.(null)}
    >
      <DeskCoverStrip coverUrl={page.coverUrl} name={page.name} ratio="video" />
      <div className="relative z-[1] flex flex-1 flex-col gap-3 p-4">
        <div className="flex min-w-0 items-center gap-3">
          {member ? (
            <MemberAvatar
              id={member.uid}
              name={member.name}
              nickname={member.nickname}
              photoURL={member.photoURL}
              className="h-10 w-10 shrink-0 ring-1 ring-primary/35"
            />
          ) : (
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/10 font-mono text-[11px] font-semibold tracking-wide text-primary"
              aria-hidden
            >
              {letter}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-medium leading-5">{title}</p>
            {title !== page.name ? (
              <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{page.name}</p>
            ) : null}
            <p className="mt-1 truncate font-mono text-[11px] tabular text-muted-foreground">
              {doneTotal > 0 || percent > 0
                ? `Готово ${formatCurrency(doneTotal)} · ${percent}%`
                : openCount > 0
                  ? `${openCount} в деле`
                  : "пока пусто"}
            </p>
          </div>
        </div>
        {canManage && onCustomize ? (
          <button
            type="button"
            className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-primary/40 bg-transparent px-3 text-[12px] font-medium text-primary hover:border-primary hover:bg-primary/10"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onCustomize();
            }}
          >
            <Settings2 className="h-3.5 w-3.5" />
            Настроить стол
          </button>
        ) : null}
      </div>
    </Link>
  );
}
