import { useMemo, useState } from "react";
import { EyeOff, Search } from "lucide-react";
import { useNavigate } from "react-router";
import { EmptyState } from "@/components/common/EmptyState";
import { DeskCoverStrip } from "@/components/dashboard/DeskCoverStrip";
import { RequestDeskViewButton } from "@/components/pagesnav/RequestDeskViewButton";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { usePeopleDesks } from "@/hooks/usePeopleDesks";
import { usePermissions } from "@/hooks/usePermissions";
import { useViewRequests } from "@/hooks/useViewRequests";
import { useWorkspace } from "@/hooks/useWorkspace";
import { displayNameOf } from "@/utils/displayName";
import { deskOwnerName, resolvedCoverUrl, splitStudioDesks } from "@/utils/peopleDesks";
import { cn } from "@/utils/cn";
import type { WorkspacePage } from "@/types";

export default function DesksPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { activeWorkspaceId, members, pages } = useWorkspace();
  const permissions = usePermissions();
  const { isLoadingWorkspaceData, ownerUid } = usePeopleDesks();
  const { requestView, latestForPage, reload } = useViewRequests(activeWorkspaceId, profile?.uid ?? null);
  const [query, setQuery] = useState("");
  const [hiddenOpen, setHiddenOpen] = useState(false);

  const ownerId = ownerUid ?? members.find((m) => m.role === "owner")?.uid ?? null;

  const { openable, hidden } = useMemo(
    () =>
      splitStudioDesks(pages, {
        uid: profile?.uid,
        canAccess: permissions.canAccessPage,
        isOwner: Boolean(permissions.isWorkspaceOwner || permissions.realRole === "owner"),
      }),
    [pages, permissions, profile?.uid]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return openable;
    return openable.filter((page) => {
      const who = deskOwnerName(members, page) || "";
      return page.name.toLowerCase().includes(q) || who.toLowerCase().includes(q);
    });
  }, [openable, members, query]);

  async function sendRequest(page: WorkspacePage) {
    const toUid = page.responsibleUserId || ownerId;
    if (!toUid) throw new Error("Нет ответственного у стола");
    await requestView(page, displayNameOf(profile), toUid);
    await reload();
  }

  if (isLoadingWorkspaceData) {
    return (
      <div className="mx-auto max-w-6xl p-5 sm:p-8 lg:p-10">
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
    <div className="relative mx-auto max-w-6xl p-5 sm:p-8 lg:p-10">
      <header className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow mb-1 text-primary">Studio</p>
          <h1 className="font-serif text-[1.85rem] font-medium tracking-[-0.03em] sm:text-[2.15rem]">Столы</h1>
          <p className="mt-1 text-sm text-muted-foreground">Открой стол по обложке.</p>
        </div>
        <div className="flex w-full max-w-xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          {hidden.length > 0 && (
            <Button type="button" variant="outline" className="min-h-11 gap-1.5" onClick={() => setHiddenOpen(true)}>
              <EyeOff className="h-3.5 w-3.5" />
              Скрытые столы
              <span className="font-mono text-[11px] tabular text-muted-foreground">{hidden.length}</span>
            </Button>
          )}
          <label className="flex h-11 w-full max-w-sm items-center gap-2 rounded-full border border-primary/30 bg-card/80 px-4 text-[13px] text-muted-foreground">
            <Search className="h-3.5 w-3.5 shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Название стола"
              className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
            />
          </label>
        </div>
      </header>

      {filtered.length === 0 ? (
        <EmptyState className="rounded-2xl border border-primary/25 bg-card py-16" title={query ? "Нет таких столов" : "Пока нет столов"} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((page) => {
            const who = deskOwnerName(members, page);
            return (
              <button
                key={page.id}
                type="button"
                onClick={() => navigate(`/page/${page.id}`)}
                className={cn(
                  "group relative overflow-hidden rounded-xl border border-primary/28 bg-card text-left transition-colors hover:border-primary/60 active:scale-[0.99]"
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

      <Sheet open={hiddenOpen} onOpenChange={setHiddenOpen}>
        <SheetContent side="right" className="flex w-full max-w-md flex-col overflow-y-auto p-0">
          <SheetHeader className="border-b border-primary/25 px-5 py-4 pr-12">
            <SheetTitle>Скрытые столы</SheetTitle>
            <p className="text-sm text-muted-foreground">Обложки видны. Открыть можно после разрешения ответственного.</p>
          </SheetHeader>
          <div className="flex flex-col gap-3 p-4">
            {hidden.length === 0 ? (
              <p className="text-sm text-muted-foreground">Скрытых столов нет.</p>
            ) : (
              hidden.map((page) => {
                const who = deskOwnerName(members, page);
                const canOpen = permissions.canAccessPage(page);
                const mine = latestForPage(page.id);
                return (
                  <div key={page.id} className="overflow-hidden rounded-xl border border-primary/25 bg-card">
                    <DeskCoverStrip coverUrl={resolvedCoverUrl(page, ownerUid)} name={page.name} ratio="thumb" />
                    <div className="flex flex-col gap-2 p-3">
                      <div>
                        <p className="truncate font-medium">{page.name}</p>
                        {who ? <p className="truncate text-[12px] text-muted-foreground">{who}</p> : null}
                      </div>
                      {canOpen ? (
                        <Button type="button" size="sm" className="min-h-11 w-full" onClick={() => navigate(`/page/${page.id}`)}>
                          Открыть
                        </Button>
                      ) : (
                        <RequestDeskViewButton page={page} mine={mine} onRequest={() => sendRequest(page)} />
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

