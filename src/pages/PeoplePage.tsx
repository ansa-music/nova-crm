import { useMemo, useState } from "react";
import { Search, UsersRound } from "lucide-react";
import { useNavigate } from "react-router";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { EmptyState } from "@/components/common/EmptyState";
import { RequestDeskViewButton } from "@/components/pagesnav/RequestDeskViewButton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { usePeopleDesks } from "@/hooks/usePeopleDesks";
import { usePermissions } from "@/hooks/usePermissions";
import { useViewRequests } from "@/hooks/useViewRequests";
import { useWorkspace } from "@/hooks/useWorkspace";
import { displayNameOf } from "@/utils/displayName";
import { canOpenDesk, groupDeskSubtitle, personLabel } from "@/utils/peopleDesks";
import { getPresenceStatus, PRESENCE_DOT_COLOR } from "@/utils/presence";
import { ROLE_LABELS } from "@/types";
import { cn } from "@/utils/cn";
import type { Role, WorkspacePage } from "@/types";


const ROLE_CHIPS: { id: Role; label: string }[] = [
  { id: "owner", label: "Owner" },
  { id: "manager", label: "Технар" },
  { id: "admin", label: "admin" },
  { id: "viewer", label: "Viewer" },
];

function RoleBadge({ role }: { role: Role }) {
  const tone =
    role === "owner"
      ? "border-primary/40 bg-primary/12 text-primary"
      : role === "manager"
        ? "border-teal-400/40 bg-teal-400/12 text-teal-200"
        : role === "admin"
          ? "border-sky-400/40 bg-sky-400/12 text-sky-200"
          : "border-border bg-muted/60 text-muted-foreground";
  return (
    <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em]", tone)}>
      {ROLE_LABELS[role]}
    </span>
  );
}

export default function PeoplePage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { peopleGroups, isLoadingWorkspaceData, selectPerson, ownerUid } = usePeopleDesks({
    syncPersonSelection: true,
  });
  const permissions = usePermissions();
  const { activeWorkspaceId, members } = useWorkspace();
  const { requestView, latestForPage, reload } = useViewRequests(activeWorkspaceId, profile?.uid ?? null);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | null>(null);

  const isOwner = Boolean(permissions.isWorkspaceOwner || permissions.realRole === "owner");
  const ownerId = ownerUid ?? members.find((m) => m.role === "owner")?.uid ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return peopleGroups.filter((g) => {
      if (roleFilter && g.member?.role !== roleFilter) return false;
      if (!q) return true;
      const name = personLabel(g.member) || (g.uid ? "Стол" : "Без ответственного");
      const desk = groupDeskSubtitle(g);
      return name.toLowerCase().includes(q) || desk.toLowerCase().includes(q);
    });
  }, [peopleGroups, query, roleFilter]);

  function mayOpen(page: WorkspacePage) {
    return canOpenDesk({
      page,
      uid: profile?.uid,
      isOwner,
      role: permissions.role,
      latestRequest: latestForPage(page.id),
    });
  }

  async function sendRequest(page: WorkspacePage) {
    const toUid = page.responsibleUserId || ownerId;
    if (!toUid) throw new Error("Нет ответственного у стола");
    await requestView(page, displayNameOf(profile), toUid);
    await reload();
  }

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
        <p className="mt-1 mb-5 text-sm text-muted-foreground">
          Лица команды. Свой стол открывается сразу, чужой — после запроса.
        </p>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {ROLE_CHIPS.map((chip) => {
            const on = roleFilter === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => setRoleFilter(on ? null : chip.id)}
                className={cn(
                  "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  on
                    ? "border-primary/50 bg-primary/15 text-primary"
                    : "border-border bg-background/40 text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
        <label className="flex h-11 w-full items-center gap-2 rounded-full border border-primary/30 bg-card/80 px-4 text-[13px] text-muted-foreground">
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
        <EmptyState className="rounded-2xl border border-primary/25 bg-card py-16" title={query || roleFilter ? "Никого не нашлось" : "Пока никого нет"} />
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((group) => {
            const openPage = group.pages.find((p) => mayOpen(p)) ?? null;
            const requestPage = openPage ? null : (group.pages[0] ?? null);
            const name = personLabel(group.member) || (group.uid ? "Стол" : "Без ответственного");
            const desk = groupDeskSubtitle(group);
            const hidden = Boolean(group.deskHidden);
            const rowClass = cn(
              "flex min-h-16 w-full items-center gap-3 rounded-xl border border-primary/25 bg-card px-3 py-3 text-left",
              hidden && "opacity-80"
            );
            const body = (
              <>
                {group.member ? (
                  <div className="relative shrink-0">
                    <MemberAvatar
                      id={group.member.uid}
                      name={group.member.name}
                      nickname={group.member.nickname}
                      photoURL={group.member.photoURL}
                      className="h-12 w-12 shrink-0"
                    />
                    <span
                      className={cn(
                        "absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-card",
                        PRESENCE_DOT_COLOR[getPresenceStatus(group.member.lastActiveAt)]
                      )}
                    />
                  </div>
                ) : (
                  <Avatar className="h-12 w-12 shrink-0">
                    <AvatarFallback>
                      <UsersRound className="h-4 w-4" />
                    </AvatarFallback>
                  </Avatar>
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="block truncate text-[15px] font-semibold text-foreground">{name}</span>
                    {group.member?.role ? <RoleBadge role={group.member.role} /> : null}
                    {hidden ? (
                      <span className="shrink-0 rounded-full border border-primary/25 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                        скрыт
                      </span>
                    ) : null}
                  </span>
                  {desk ? (
                    <span className="block truncate text-[12px] text-muted-foreground">{desk}</span>
                  ) : null}
                </span>
              </>
            );

            if (openPage) {
              return (
                <button
                  key={group.key}
                  type="button"
                  onClick={() => {
                    selectPerson(group.key);
                    navigate(`/page/${openPage.id}`);
                  }}
                  className={cn(rowClass, "transition-colors hover:border-primary/55 hover:bg-primary/[0.06] active:scale-[0.99]")}
                >
                  {body}
                </button>
              );
            }

            const pending = requestPage ? latestForPage(requestPage.id)?.status === "pending" : false;
            return (
              <div key={group.key} className={cn("overflow-hidden rounded-xl border border-primary/25 bg-card", hidden && "opacity-80")}>
                {pending || !requestPage ? (
                  <div className="flex min-h-16 w-full items-center gap-3 px-3 py-3 text-left">
                    {body}
                  </div>
                ) : (
                  <button
                    type="button"
                    className="flex min-h-16 w-full items-center gap-3 px-3 py-3 text-left"
                    onClick={() => {
                      selectPerson(group.key);
                      void sendRequest(requestPage);
                    }}
                  >
                    {body}
                  </button>
                )}
                {requestPage ? (
                  <div className="border-t border-primary/20 px-3 py-2">
                    <RequestDeskViewButton
                      page={requestPage}
                      mine={latestForPage(requestPage.id)}
                      onRequest={() => sendRequest(requestPage)}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
