import { useMemo, useState } from "react";
import { Archive, ArchiveRestore, MoreHorizontal, Search } from "lucide-react";
import { useNavigate } from "react-router";
import { EmptyState } from "@/components/common/EmptyState";
import { DeskCoverGrid } from "@/components/dashboard/DeskCoverGrid";
import { DeskCoverStrip } from "@/components/dashboard/DeskCoverStrip";
import { restoreDesk, retireDesk } from "@/components/desks/deskRetireActions";
import { RequestDeskViewButton } from "@/components/pagesnav/RequestDeskViewButton";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useLeaderboard } from "@/hooks/useLeaderboard";
import { usePeopleDesks } from "@/hooks/usePeopleDesks";
import { usePermissions } from "@/hooks/usePermissions";
import { useViewRequests } from "@/hooks/useViewRequests";
import { useWorkspace } from "@/hooks/useWorkspace";
import { formatDate } from "@/utils/date";
import { displayNameOf } from "@/utils/displayName";
import { canOpenDesk, deskOwnerName, personLabel, resolvedCoverUrl } from "@/utils/peopleDesks";
import { PageHeader, pageChipClass } from "@/components/common/PageHeader";
import { cn } from "@/utils/cn";
import type { WorkspacePage } from "@/types";

type DeskChip = "all" | "mine" | "others" | "hidden";

export default function DesksPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { activeWorkspaceId, members, pages, inactivePages } = useWorkspace();
  const permissions = usePermissions();
  const { isLoadingWorkspaceData, ownerUid } = usePeopleDesks();
  const { requestView, latestForPage, reload } = useViewRequests(activeWorkspaceId, profile?.uid ?? null);
  const leaderboard = useLeaderboard(activeWorkspaceId);
  const [query, setQuery] = useState("");
  const [inactiveOpen, setInactiveOpen] = useState(false);
  const [chip, setChip] = useState<DeskChip>("all");

  const progressByPageId = useMemo(() => {
    const next: Record<string, number> = {};
    for (const entry of leaderboard) {
      if (!(entry.grandTotal > 0)) continue;
      const percent =
        typeof entry.percent === "number" && Number.isFinite(entry.percent)
          ? entry.percent
          : Math.round((entry.doneTotal / entry.grandTotal) * 100);
      next[entry.pageId] = percent;
    }
    return next;
  }, [leaderboard]);

  const ownerId = ownerUid ?? members.find((m) => m.role === "owner")?.uid ?? null;
  // Owner: may open every desk.
  const isOwner = permissions.hasFullDeskAccess;
  const uid = profile?.uid;

  // Hidden desks stand with everyone else — the cover shows «Скрыт» and the
  // table stays closed without the responsible person's permission.
  const mine = useMemo(() => pages.filter((page) => page.responsibleUserId === uid), [pages, uid]);
  const others = useMemo(() => pages.filter((page) => page.responsibleUserId !== uid), [pages, uid]);
  const hidden = useMemo(() => pages.filter((page) => page.hiddenByResponsible), [pages]);
  const scoped = chip === "mine" ? mine : chip === "others" ? others : chip === "hidden" ? hidden : pages;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return scoped;
    return scoped.filter((page) => {
      const who = deskOwnerName(members, page) || "";
      return page.name.toLowerCase().includes(q) || who.toLowerCase().includes(q);
    });
  }, [scoped, members, query]);

  const chips: { id: DeskChip; label: string; count: number }[] = [
    { id: "all", label: "Все", count: pages.length },
    { id: "mine", label: "Мои", count: mine.length },
    { id: "others", label: "Чужие", count: others.length },
    ...(hidden.length > 0 ? [{ id: "hidden" as const, label: "Скрытые", count: hidden.length }] : []),
  ];

  const inactiveSorted = useMemo(
    () => inactivePages.slice().sort((a, b) => (b.inactiveAt ?? 0) - (a.inactiveAt ?? 0)),
    [inactivePages]
  );

  function mayOpen(page: WorkspacePage) {
    return canOpenDesk({
      page,
      uid: profile?.uid,
      isOwner,
      deskBlocked: permissions.deskBlocked,
      seesAllDesks: permissions.seesAllDesks,
    });
  }

  async function sendRequest(page: WorkspacePage) {
    const toUid = page.responsibleUserId || ownerId;
    if (!toUid) throw new Error("Нет ответственного у стола");
    await requestView(page, displayNameOf(profile), toUid);
    await reload();
  }

  async function requestFromCard(page: WorkspacePage) {
    if (mayOpen(page)) return;
    if (latestForPage(page.id)?.status === "pending") return;
    try {
      await sendRequest(page);
      toast.success("Запрос отправлен");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось отправить запрос");
    }
  }

  if (isLoadingWorkspaceData) {
    return (
      <div className="mx-auto w-full min-w-0 max-w-6xl p-5 sm:p-8 lg:p-10">
        <Skeleton className="mb-6 h-10 w-48" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[4/3] w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="relative mx-auto w-full min-w-0 max-w-6xl p-5 sm:p-8 lg:p-10">
      <PageHeader
        eyebrow="Студия"
        title="Столы"
        description="Обложки видны всем. Свой стол открывается сразу, чужой и скрытый — после разрешения."
        actions={
          <>
            {inactivePages.length > 0 && (
              <Button type="button" variant="outline" className="min-h-11 gap-1.5" onClick={() => setInactiveOpen(true)}>
                <Archive className="h-3.5 w-3.5" />
                Неактуальные
                <span className="font-mono text-[11px] tabular text-muted-foreground">{inactivePages.length}</span>
              </Button>
            )}
            <label className="flex h-11 w-full items-center gap-2 rounded-full border border-primary/30 bg-card/80 px-4 text-[13px] text-muted-foreground sm:w-64">
              <Search className="h-3.5 w-3.5 shrink-0" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Название стола"
                className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
              />
            </label>
          </>
        }
        filters={chips.map((item) => (
          <button key={item.id} type="button" onClick={() => setChip(item.id)} className={pageChipClass(chip === item.id)}>
            {item.label}
            <span className="tabular-nums text-[10px] opacity-80">{item.count}</span>
          </button>
        ))}
      />

      {filtered.length > 0 ? (
        <DeskCoverGrid
          pages={filtered}
          members={members}
          ownerUid={ownerUid}
          canOpen={mayOpen}
          onOpen={(page) => navigate(`/page/${page.id}`)}
          onRequest={(page) => void requestFromCard(page)}
          isPending={(page) => latestForPage(page.id)?.status === "pending"}
          progressByPageId={progressByPageId}
          renderAction={(page) => (
            <RequestDeskViewButton
              page={page}
              mine={latestForPage(page.id)}
              canOpen={mayOpen(page)}
              onRequest={() => sendRequest(page)}
            />
          )}
          renderCorner={
            permissions.canRetireDesks
              ? (page) => (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 rounded-full border border-white/20 bg-black/45 text-white backdrop-blur-sm hover:bg-black/65 hover:text-white"
                        aria-label={`Действия со столом «${page.name}»`}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => void retireDesk(page, members, permissions.uid)}>
                        <Archive className="h-4 w-4" /> В неактуальные
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )
              : undefined
          }
        />
      ) : (
        <EmptyState
          className="rounded-2xl border border-primary/25 bg-card py-16"
          title={query.trim() || chip !== "all" ? "Нет таких столов" : "Пока нет столов"}
        />
      )}

      <Sheet open={inactiveOpen} onOpenChange={setInactiveOpen}>
        <SheetContent side="right" className="flex w-full max-w-md flex-col overflow-y-auto p-0">
          <SheetHeader className="border-b border-primary/25 px-5 py-4 pr-12">
            <SheetTitle>Неактуальные столы</SheetTitle>
            <p className="text-sm text-muted-foreground">
              Их нет в «Столах», на дашборде и в «Технарях». Вкладки и строки сохранены
              {permissions.canRetireDesks ? " — стол можно вернуть в любой момент." : "."}
            </p>
          </SheetHeader>
          <div className="flex flex-col gap-3 p-4">
            {inactiveSorted.length === 0 ? (
              <p className="text-sm text-muted-foreground">Неактуальных столов нет.</p>
            ) : (
              inactiveSorted.map((page) => {
                const who = deskOwnerName(members, page);
                const by = personLabel(members.find((m) => m.uid === page.inactiveBy) ?? null);
                const openable = mayOpen(page);
                return (
                  <div key={page.id} className="overflow-hidden rounded-xl border border-primary/25 bg-card">
                    <div className="opacity-60 grayscale">
                      <DeskCoverStrip coverUrl={resolvedCoverUrl(page, ownerUid)} name={page.name} ratio="thumb" />
                    </div>
                    <div className="flex flex-col gap-2 p-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{page.name}</p>
                        <p className="truncate text-[12px] text-muted-foreground">
                          {[who, page.inactiveAt ? `неактуален с ${formatDate(page.inactiveAt, "d MMM yyyy")}` : null, by ? `убрал(а) ${by}` : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      {(openable || permissions.canRetireDesks) && (
                        <div className="flex gap-2">
                          {openable && (
                            <Button type="button" size="sm" variant="outline" className="min-h-11 flex-1" onClick={() => navigate(`/page/${page.id}`)}>
                              Открыть
                            </Button>
                          )}
                          {permissions.canRetireDesks && (
                            <Button
                              type="button"
                              size="sm"
                              className="min-h-11 flex-1 gap-1.5"
                              onClick={() => void restoreDesk(page, members, permissions.uid)}
                            >
                              <ArchiveRestore className="h-3.5 w-3.5" />
                              Вернуть в столы
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
