import { useMemo, useState } from "react";
import { Search, UsersRound } from "lucide-react";
import { useNavigate } from "react-router";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { EmptyState } from "@/components/common/EmptyState";
import { RequestDeskViewButton } from "@/components/pagesnav/RequestDeskViewButton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/hooks/useAuth";
import { usePeopleDesks } from "@/hooks/usePeopleDesks";
import { usePermissions } from "@/hooks/usePermissions";
import { usePresenceMap } from "@/hooks/usePresenceMap";
import { useUrlState } from "@/hooks/useUrlState";
import { useViewRequests } from "@/hooks/useViewRequests";
import { useWorkspace } from "@/hooks/useWorkspace";
import { deskHref, deskNavState } from "@/utils/deskLinks";
import { myDisplayName } from "@/utils/displayName";
import { canOpenDesk, groupDeskSubtitle, personLabel } from "@/utils/peopleDesks";
import { getPresenceStatus, PRESENCE_DOT_COLOR } from "@/utils/presence";
import { memberHasRole, ROLE_LABELS, rolesOf } from "@/types";
import { PageHeader, pageChipClass } from "@/components/common/PageHeader";
import { cn } from "@/utils/cn";
import type { Role, WorkspacePage } from "@/types";


/** Значения `?role=`: пусто — без фильтра. */
const ROLE_PARAMS: readonly (Role | "")[] = ["", "owner", "teamlead", "manager", "os", "admin", "viewer"];

const ROLE_CHIPS: { id: Role; label: string }[] = [
  { id: "owner", label: "Owner" },
  { id: "teamlead", label: "Тимлид" },
  { id: "manager", label: "Технарь" },
  { id: "os", label: "ОС" },
  { id: "admin", label: "admin" },
  { id: "viewer", label: "Viewer" },
];

function RoleBadge({ role }: { role: Role }) {
  const tone =
    role === "owner"
      ? "border-primary/40 bg-primary/12 text-primary"
      : role === "teamlead"
        ? "border-fuchsia-400/40 bg-fuchsia-400/12 text-fuchsia-200"
        : role === "manager"
          ? "border-teal-400/40 bg-teal-400/12 text-teal-200"
          : role === "os"
            ? "border-amber-400/40 bg-amber-400/12 text-amber-200"
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
  // «В сети» — max(Firestore, Supabase): см. usePresenceMap.
  const presenceAt = usePresenceMap(activeWorkspaceId);
  const [query, setQuery] = useState("");
  // Фильтр роли — в адресе (`?role=os`): F5 не сбрасывает, ссылку можно отдать.
  const [roleParam, setRoleParam] = useUrlState<Role | "">("role", "", { values: ROLE_PARAMS });
  const roleFilter: Role | null = roleParam || null;
  const setRoleFilter = (next: Role | null) => setRoleParam(next ?? "");

  // Owner or Тимлид: may open every desk.
  const isOwner = permissions.hasFullDeskAccess;
  const ownerId = ownerUid ?? members.find((m) => m.role === "owner")?.uid ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return peopleGroups.filter((g) => {
      if (roleFilter && !memberHasRole(g.member, roleFilter)) return false;
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
      deskBlocked: permissions.deskBlocked,
      seesAllDesks: permissions.seesAllDesks,
    });
  }

  /**
   * Сырой запрос: БРОСАЕТ ошибку и ничего не тостит. Именно он уходит в
   * `RequestDeskViewButton` — кнопка сама показывает и успех, и отказ.
   * Раньше здесь стоял try/catch со своим тостом, и промис резолвился даже
   * на ошибке: человек видел красный тост, а следом зелёный «Запрос
   * отправлен» на неотправленный запрос. Разделение — как на /desks.
   */
  async function sendRequest(page: WorkspacePage) {
    const toUid = page.responsibleUserId || ownerId;
    if (!toUid) throw new Error("Нет ответственного у стола");
    await requestView(page, myDisplayName(profile, members), toUid);
    await reload();
  }

  /** Клик по самой строке: тостит сам, потому что кнопки тут нет. */
  async function requestFromRow(page: WorkspacePage) {
    try {
      await sendRequest(page);
      toast.success("Запрос на просмотр отправлен");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось отправить запрос");
    }
  }

  if (isLoadingWorkspaceData) {
    return (
      <div className="mx-auto w-full min-w-0 max-w-2xl p-5 sm:p-8">
        <Skeleton className="mb-6 h-10 w-48" />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="mb-2 h-16 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-2xl p-5 sm:p-8">
      <PageHeader
        eyebrow="Студия"
        title="Люди"
        description="Лица команды. Свой стол открывается сразу, чужой — после запроса."
        actions={
          <label className="flex h-11 w-full items-center gap-2 rounded-full border border-primary/30 bg-card/80 px-4 text-[13px] text-muted-foreground sm:w-64">
            <Search className="h-3.5 w-3.5 shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Имя"
              className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
            />
          </label>
        }
        filters={ROLE_CHIPS.map((chip) => {
          const on = roleFilter === chip.id;
          return (
            <button key={chip.id} type="button" onClick={() => setRoleFilter(on ? null : chip.id)} className={pageChipClass(on)}>
              {chip.label}
            </button>
          );
        })}
      />

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
                        PRESENCE_DOT_COLOR[getPresenceStatus(presenceAt(group.member))]
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
                    {rolesOf(group.member).map((role) => (
                      <RoleBadge key={role} role={role} />
                    ))}
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
                    navigate(deskHref(openPage.id), { state: deskNavState({ to: "/people", label: "Люди" }) });
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
                      void requestFromRow(requestPage);
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
