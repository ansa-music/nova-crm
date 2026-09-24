import { NavLink } from "react-router";
import { ChevronRight, EyeOff, Lock, Pin } from "lucide-react";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { cn } from "@/utils/cn";
import { getPresenceStatus, PRESENCE_DOT_COLOR, PRESENCE_LABEL } from "@/utils/presence";
import { personLabel } from "@/utils/peopleDesks";
import type { WorkspaceMember, WorkspacePage } from "@/types";

export interface DeskListRow {
  page: WorkspacePage;
  /** Ответственный — аватар и «в сети». */
  owner: WorkspaceMember | null;
  lastActiveAt: number | undefined;
  /** % «Готово» из счётчиков (null — не знаем). */
  percent: number | null;
  openable: boolean;
  pending: boolean;
  pinned: boolean;
  mine: boolean;
}

/**
 * «Столы» списком (просьба Nurba 25.09.2026: «страницу столы сделать
 * удобнее — она не удобная»). Обложки 4:3 — три в ряд, и у 28 человек стол
 * искали прокруткой; строка 48 px даёт весь список на одном экране: имя,
 * ответственный, «в сети», % готово. Обложки остались вторым видом.
 */
export function DeskListView({
  rows,
  onOpen,
  onRequest,
  onTogglePin,
  renderMenu,
}: {
  rows: DeskListRow[];
  onOpen: (page: WorkspacePage) => void;
  onRequest: (page: WorkspacePage) => void;
  onTogglePin?: (page: WorkspacePage) => void;
  renderMenu?: (page: WorkspacePage) => React.ReactNode;
}) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {rows.map(({ page, owner, lastActiveAt, percent, openable, pending, pinned, mine }) => {
        const presence = getPresenceStatus(lastActiveAt);
        const who = personLabel(owner);
        const body = (
          <>
            <span className="relative shrink-0">
              {owner ? (
                <MemberAvatar id={owner.uid} name={owner.name} nickname={owner.nickname} photoURL={owner.photoURL} className="h-8 w-8 text-[11px]" />
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-[11px] text-muted-foreground">—</span>
              )}
              {owner ? (
                <span
                  className={cn("absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card", PRESENCE_DOT_COLOR[presence])}
                  title={PRESENCE_LABEL[presence]}
                />
              ) : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-[14px] font-medium">{page.name}</span>
                {mine ? <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">мой</span> : null}
                {page.hiddenByResponsible ? (
                  <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground" title="Скрыт от других">
                    <EyeOff className="h-3 w-3" />
                  </span>
                ) : null}
              </span>
              <span className="block truncate text-[12px] text-muted-foreground">
                {who || "без ответственного"}
                {presence === "online" ? " · в сети" : ""}
              </span>
            </span>
            {percent !== null ? (
              <span className="hidden w-28 shrink-0 items-center gap-2 sm:flex" title={`Готово ${percent}% от общего`}>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <span className={cn("block h-full rounded-full", percent >= 75 ? "bg-success" : percent >= 40 ? "bg-primary" : "bg-warning")} style={{ width: `${Math.min(100, percent)}%` }} />
                </span>
                <span className="w-9 text-right font-mono text-[11px] tabular-nums text-muted-foreground">{percent}%</span>
              </span>
            ) : (
              <span className="hidden w-28 shrink-0 sm:block" />
            )}
            {!openable ? (
              <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                <Lock className="h-3 w-3" />
                {pending ? "запрос отправлен" : "запросить"}
              </span>
            ) : null}
          </>
        );
        return (
          <li key={page.id} className={cn("flex items-center gap-2 pr-2", pinned && "bg-primary/[0.04]")}>
            {openable ? (
              <NavLink to={`/page/${page.id}`} className="flex min-h-12 min-w-0 flex-1 items-center gap-3 px-3 py-2 hover:bg-accent">
                {body}
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </NavLink>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={() => onRequest(page)}
                className="flex min-h-12 min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent"
              >
                {body}
              </button>
            )}
            {onTogglePin && openable ? (
              <button
                type="button"
                onClick={() => onTogglePin(page)}
                aria-pressed={pinned}
                title={pinned ? "Открепить из меню" : "Закрепить в меню"}
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
                  pinned ? "text-primary" : "text-muted-foreground/60 hover:bg-accent hover:text-foreground"
                )}
              >
                <Pin className={cn("h-4 w-4", pinned && "fill-current")} />
              </button>
            ) : null}
            {renderMenu?.(page) ?? null}
          </li>
        );
      })}
    </ul>
  );
}
