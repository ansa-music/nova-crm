import { useEffect, useMemo, useRef, useState } from "react";
import { Settings2 } from "lucide-react";
import { deskEase, gsap, useGSAP } from "@/lib/gsap";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DeskCoverStrip } from "@/components/dashboard/DeskCoverStrip";
import { RecentActivity } from "@/components/dashboard/RecentActivity";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { EmptyState } from "@/components/common/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useHistoryLog } from "@/hooks/useHistoryLog";
import { useLeaderboard } from "@/hooks/useLeaderboard";
import { usePermissions } from "@/hooks/usePermissions";
import { isResponsibleForPage } from "@/utils/permissions";
import { updateDashboardPages } from "@/services/workspaceService";
import { DeskStudioSheet } from "@/components/pagesnav/DeskStudioSheet";
import { CreatePageDialog } from "@/components/pagesnav/CreatePageDialog";
import { useDeskLayout } from "@/hooks/useDeskLayout";
import { formatCurrency } from "@/utils/format";
import { formatDate, greetingByHour, hourInTimeZone, timeAgo } from "@/utils/date";
import { useNavigate } from "react-router";
import type { LeaderboardEntry, WorkspaceMember, WorkspacePage } from "@/types";

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

function personLabel(member?: { name?: string; nickname?: string } | null) {
  if (!member) return "";
  return member.nickname || member.name || "";
}

interface PersonDeskGroup {
  key: string;
  uid: string | null;
  member: WorkspaceMember | null;
  pages: WorkspacePage[];
}

function groupDesksByPerson(pages: WorkspacePage[], members: WorkspaceMember[]): PersonDeskGroup[] {
  const byUid = new Map<string, WorkspacePage[]>();
  const unassigned: WorkspacePage[] = [];
  for (const page of pages) {
    const uid = page.responsibleUserId;
    if (!uid) {
      unassigned.push(page);
      continue;
    }
    const list = byUid.get(uid) ?? [];
    list.push(page);
    byUid.set(uid, list);
  }
  const groups: PersonDeskGroup[] = [];
  for (const [uid, list] of byUid) {
    list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "ru"));
    const member = members.find((m) => m.uid === uid) ?? null;
    groups.push({ key: uid, uid, member, pages: list });
  }
  groups.sort((a, b) => personLabel(a.member).localeCompare(personLabel(b.member), "ru"));
  if (unassigned.length) {
    unassigned.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "ru"));
    groups.push({ key: "__none__", uid: null, member: null, pages: unassigned });
  }
  return groups;
}

export default function DashboardPage() {
  const { activeWorkspace, activeWorkspaceId, pages, members, isLoadingWorkspaceData } = useWorkspace();
  const permissions = usePermissions();
  const { profile } = useAuth();
  const { layout: deskLayout } = useDeskLayout(profile?.uid);
  const [studioPageId, setStudioPageId] = useState<string | null>(null);
  const [createPageOpen, setCreatePageOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [heroPageId, setHeroPageId] = useState<string | null>(null);
  const studioPage = pages.find((p) => p.id === studioPageId) ?? null;
  const navigate = useNavigate();

  const visiblePages = useMemo(
    () => pages.filter((p) => permissions.canAccessPage(p)),
    [pages, permissions]
  );

  const isPersonalLanding = permissions.role !== "owner" && permissions.role !== "admin";

  const studioPages = useMemo(() => {
    if (isPersonalLanding && profile) {
      return visiblePages.filter((p) => isResponsibleForPage(p, profile.uid));
    }
    return visiblePages;
  }, [visiblePages, isPersonalLanding, profile]);

  const groups = useMemo(() => groupDesksByPerson(studioPages, members), [studioPages, members]);

  useEffect(() => {
    if (groups.length === 0) {
      setSelectedKey(null);
      setHeroPageId(null);
      return;
    }
    setSelectedKey((prev) => {
      if (prev && groups.some((g) => g.key === prev)) return prev;
      if (profile && groups.some((g) => g.key === profile.uid)) return profile.uid;
      return groups[0].key;
    });
  }, [groups, profile]);

  const activeGroup = groups.find((g) => g.key === selectedKey) ?? groups[0] ?? null;
  const heroPage =
    (activeGroup && (activeGroup.pages.find((p) => p.id === heroPageId) ?? activeGroup.pages[0])) ?? null;

  useEffect(() => {
    if (!activeGroup) {
      setHeroPageId(null);
      return;
    }
    setHeroPageId((prev) => {
      if (prev && activeGroup.pages.some((p) => p.id === prev)) return prev;
      return activeGroup.pages[0]?.id ?? null;
    });
  }, [activeGroup]);

  const others = groups.filter((g) => g.key !== activeGroup?.key);

  const showBoard = deskLayout.showLeaderboard;
  const showHistory = !isPersonalLanding && permissions.canViewHistory;
  const leaderboardEntries = useLeaderboard(showBoard ? activeWorkspaceId : null);
  const { entries: historyEntries } = useHistoryLog(showHistory ? activeWorkspaceId : null);

  const deskRef = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      if (
        window.matchMedia(
          "(prefers-reduced-motion: reduce), (hover: none), (pointer: coarse), (max-width: 1023px)"
        ).matches
      ) {
        return;
      }
      const nodes = deskRef.current?.querySelectorAll(".desk-hero, .desk-thumb, .desk-home");
      if (!nodes?.length) return;
      gsap.fromTo(nodes, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.32, stagger: 0.05, ease: deskEase });
    },
    { scope: deskRef, dependencies: [isLoadingWorkspaceData, selectedKey] }
  );

  if (isLoadingWorkspaceData) {
    return (
      <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
        <Skeleton className="mb-4 h-8 w-48" />
        <Skeleton className="mb-4 aspect-[2/1] w-full rounded-xl" />
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-36 shrink-0 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  const dateLine = formatDate(Date.now(), "d MMMM");
  const name = profile ? profile.nickname || profile.name : "";
  const hello = greetingByHour(hourInTimeZone(Date.now()));
  const heroWho = heroPage
    ? personLabel(activeGroup?.member) || (activeGroup?.uid ? "Стол" : "Без ответственного")
    : "";

  const sheets = (
    <>
      <DeskStudioSheet
        page={studioPage}
        open={Boolean(studioPage)}
        onOpenChange={(open) => {
          if (!open) setStudioPageId(null);
        }}
        uid={profile?.uid}
      />
      <CreatePageDialog open={createPageOpen} onOpenChange={setCreatePageOpen} />
    </>
  );

  return (
    <div ref={deskRef} className="relative mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
      <header className="mb-4 flex flex-col gap-3 sm:mb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="eyebrow mb-1 text-primary">Сегодня · {dateLine}</p>
          <h1 className="hero">
            {name ? (isPersonalLanding ? `Привет, ${name}` : `${hello}, ${name}`) : isPersonalLanding ? "Привет" : hello}
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!isPersonalLanding && permissions.canManageWorkspace && (
            <DashboardSourcePicker
              workspaceId={activeWorkspaceId ?? ""}
              pages={visiblePages}
              clientsPageId={activeWorkspace?.dashboardClientsPageId}
              projectsPageId={activeWorkspace?.dashboardProjectsPageId}
            />
          )}
        </div>
      </header>

      {studioPages.length === 0 ? (
        <EmptyState
          className="rounded-xl border border-border bg-card py-14"
          title="Пока нет столов"
          action={
            permissions.canCreatePages ? (
              <Button size="sm" className="gap-1.5" onClick={() => setCreatePageOpen(true)}>
                <Settings2 className="h-3.5 w-3.5" />
                Настроить стол
              </Button>
            ) : undefined
          }
        />
      ) : heroPage && activeGroup ? (
        <>
          <section className="desk-hero relative mb-4 overflow-hidden rounded-xl border border-border sm:mb-5">
            <button
              type="button"
              className="block w-full text-left"
              onClick={() => navigate(`/page/${heroPage.id}`)}
            >
              <DeskCoverStrip coverUrl={heroPage.coverUrl} name={heroPage.name} ratio="hero" />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent" />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 p-4 sm:p-6">
                <p className="text-[17px] font-medium tracking-[-0.02em] text-[hsl(36_40%_96%)] sm:text-2xl">
                  {heroWho} · {heroPage.name}
                </p>
              </div>
            </button>
            {permissions.canManagePage(heroPage) && (
              <Button
                variant="outline"
                size="sm"
                className="absolute right-3 top-3 z-[1] gap-1.5 bg-background/80 sm:right-4 sm:top-4"
                onClick={() => setStudioPageId(heroPage.id)}
              >
                <Settings2 className="h-3.5 w-3.5" />
                Настроить стол
              </Button>
            )}
            {activeGroup.pages.length > 1 && (
              <div className="absolute bottom-3 left-3 z-[1] flex max-w-[calc(100%-1.5rem)] flex-wrap gap-1.5 sm:bottom-auto sm:left-auto sm:right-4 sm:top-14">
                {activeGroup.pages.map((page) => (
                  <button
                    key={page.id}
                    type="button"
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                      page.id === heroPage.id
                        ? "border-primary bg-background/90 text-foreground"
                        : "border-border/80 bg-background/60 text-muted-foreground"
                    )}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setHeroPageId(page.id);
                    }}
                  >
                    {page.name}
                  </button>
                ))}
              </div>
            )}
          </section>

          {!isPersonalLanding && others.length > 0 && (
            <section className="mb-6">
              <p className="eyebrow mb-3 text-primary">Другие столы</p>
              <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 scrollbar-thin sm:mx-0 sm:px-0">
                {others.map((group) => {
                  const coverPage = group.pages[0];
                  const label = personLabel(group.member) || coverPage.name;
                  return (
                    <button
                      key={group.key}
                      type="button"
                      className="desk-thumb w-[7.25rem] shrink-0 text-left sm:w-36"
                      onClick={() => {
                        setSelectedKey(group.key);
                        setHeroPageId(coverPage.id);
                      }}
                    >
                      <div className="overflow-hidden rounded-lg border border-border">
                        <DeskCoverStrip coverUrl={coverPage.coverUrl} name={label} ratio="thumb" />
                      </div>
                      <p className="mt-1.5 truncate text-[12px] font-medium">{label}</p>
                      {personLabel(group.member) && personLabel(group.member) !== coverPage.name ? (
                        <p className="truncate text-[11px] text-muted-foreground">{coverPage.name}</p>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </>
      ) : null}

      {showBoard && (
        <div className="desk-home mb-6">
          <LeaderboardWidget
            entries={leaderboardEntries}
            members={members}
            myUid={profile?.uid}
            featured={isPersonalLanding}
          />
        </div>
      )}

      {showHistory && (
        <div className="desk-home mb-6">
          <RecentActivity entries={historyEntries} />
        </div>
      )}

      {sheets}
    </div>
  );
}

function DashboardSourcePicker({
  workspaceId,
  pages,
  clientsPageId,
  projectsPageId,
}: {
  workspaceId: string;
  pages: { id: string; name: string }[];
  clientsPageId?: string;
  projectsPageId?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" title="Какой лист открывать в навигации">
          <Settings2 className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <p className="mb-3 text-sm font-medium">Листы на домашнем</p>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Клиенты</Label>
            <Select
              value={clientsPageId ?? "__auto__"}
              onValueChange={(v) => updateDashboardPages(workspaceId, { clientsPageId: v === "__auto__" ? null : v })}
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__auto__">Определять по названию</SelectItem>
                {pages.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Второй лист</Label>
            <Select
              value={projectsPageId ?? "__auto__"}
              onValueChange={(v) => updateDashboardPages(workspaceId, { projectsPageId: v === "__auto__" ? null : v })}
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__auto__">Определять по названию</SelectItem>
                {pages.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function LeaderboardWidget({
  entries,
  members,
  myUid,
  featured,
}: {
  entries: LeaderboardEntry[];
  members: {
    uid: string;
    name?: string;
    nickname?: string;
    photoURL?: string | null;
    lastActiveAt?: number;
    status: string;
    role: string;
  }[];
  myUid?: string;
  featured?: boolean;
}) {
  const ranked = useMemo(() => {
    return members
      .filter((m) => m.status === "active")
      .map((member) => {
        const myEntries = entries.filter((e) => e.responsibleUserId === member.uid);
        const doneTotal = myEntries.reduce((sum, e) => sum + e.doneTotal, 0);
        const pageNames = myEntries.map((e) => e.pageName);
        return { member, doneTotal, pageNames };
      })
      .sort((a, b) => b.doneTotal - a.doneTotal);
  }, [entries, members]);

  return (
    <Card className={featured ? "lift-card h-full border-border bg-card" : "lift-card border-border bg-card"}>
      <CardContent className={featured ? "p-5 sm:p-6" : "p-4"}>
        <p className="eyebrow mb-1 text-primary">Как ведут дело</p>
        <p className={cn(featured ? "mb-4 text-base font-medium" : "mb-3 text-sm font-medium")}>рейтинг по сумме «Готово»</p>
        {ranked.length === 0 ? (
          <p className="text-xs text-muted-foreground">Пока никого нет на столах.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {ranked.map(({ member, doneTotal, pageNames }, i) => {
              const mine = member.uid === myUid;
              return (
                <div
                  key={member.uid}
                  className={cn("flex items-center gap-2.5 rounded-md px-2 py-2", mine && "bg-primary/10 ring-1 ring-primary/40")}
                >
                  <span className="w-5 shrink-0 text-center font-mono text-[11px] tabular text-muted-foreground">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <MemberAvatar
                    id={member.uid}
                    name={member.name}
                    nickname={member.nickname}
                    photoURL={member.photoURL}
                    className={cn("h-8 w-8 shrink-0", mine && "ring-2 ring-primary")}
                  />
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-sm font-medium", mine && "text-primary")}>
                      {personLabel(member) || "—"}
                      {mine ? " · ты" : ""}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {pageNames.length > 0 ? pageNames.join(", ") : "нет листа"}
                      {member.lastActiveAt ? ` · заходил ${timeAgo(member.lastActiveAt)}` : ""}
                    </p>
                  </div>
                  <span className={cn("shrink-0 font-mono tabular", featured ? "text-base" : "text-sm", mine ? "text-primary" : "text-foreground")}>
                    {formatCurrency(doneTotal)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
