import { useState } from "react";
import { LayoutGrid, Settings2, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeskCoverStrip } from "@/components/dashboard/DeskCoverStrip";
import { EmptyState } from "@/components/common/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { usePeopleDesks } from "@/hooks/usePeopleDesks";
import { DeskStudioSheet } from "@/components/pagesnav/DeskStudioSheet";
import { CreatePageDialog } from "@/components/pagesnav/CreatePageDialog";
import { resolvedCoverUrl } from "@/utils/peopleDesks";
import { greetingByHour, hourInTimeZone } from "@/utils/date";
import { useNavigate } from "react-router";

export default function DashboardPage() {
  const permissions = usePermissions();
  const { profile } = useAuth();
  const { groups, studioPages, isLoadingWorkspaceData, ownerUid } = usePeopleDesks();
  const [studioOpen, setStudioOpen] = useState(false);
  const [createPageOpen, setCreatePageOpen] = useState(false);
  const navigate = useNavigate();

  const mine = groups.find((g) => g.uid === profile?.uid) ?? null;
  const myDesk = mine?.pages[0] ?? studioPages.find((p) => p.responsibleUserId === profile?.uid) ?? null;

  if (isLoadingWorkspaceData) {
    return (
      <div className="mx-auto max-w-3xl p-5 sm:p-8">
        <Skeleton className="mb-4 h-8 w-56" />
        <Skeleton className="aspect-[2/1] w-full rounded-[1.35rem]" />
      </div>
    );
  }

  const hello = greetingByHour(hourInTimeZone(Date.now()));
  const who = profile?.nickname || profile?.name || "";

  return (
    <div className="mx-auto max-w-3xl p-5 sm:p-8">
      <p className="eyebrow mb-2 text-primary">Главная</p>
      <h1 className="font-serif text-[1.85rem] font-medium tracking-[-0.03em] sm:text-[2.2rem]">
        {hello}
        {who ? `, ${who}` : ""}
      </h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">Твой стол. Остальные — в «Столы» и «Люди».</p>

      <div className="mb-6 flex flex-wrap gap-2">
        <Button variant="outline" className="min-h-11 gap-1.5 rounded-full" onClick={() => navigate("/desks")}>
          <LayoutGrid className="h-3.5 w-3.5" />
          Все столы
        </Button>
        <Button variant="outline" className="min-h-11 gap-1.5 rounded-full" onClick={() => navigate("/people")}>
          <UsersRound className="h-3.5 w-3.5" />
          Люди
        </Button>
      </div>

      {!myDesk ? (
        <EmptyState
          className="rounded-2xl border border-border bg-card py-14"
          title="Своего стола пока нет"
          action={
            permissions.canCreatePages ? (
              <Button size="sm" className="min-h-11 gap-1.5" onClick={() => setCreatePageOpen(true)}>
                <Settings2 className="h-3.5 w-3.5" />
                Новый стол
              </Button>
            ) : undefined
          }
        />
      ) : (
        <section className="relative overflow-hidden rounded-[1.35rem] border border-border">
          <button type="button" className="block w-full text-left" onClick={() => navigate(`/page/${myDesk.id}`)}>
            <DeskCoverStrip coverUrl={resolvedCoverUrl(myDesk, ownerUid)} name={myDesk.name} ratio="hero" />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
          </button>
          <div className="pointer-events-none absolute inset-0 z-[1] flex flex-col justify-between p-4 sm:p-7">
            {permissions.canManagePage(myDesk) ? (
              <div className="pointer-events-auto self-start">
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11 rounded-full border-white/25 bg-white/10 px-4 text-[hsl(36_40%_96%)] hover:bg-white/16 hover:text-[hsl(36_40%_96%)]"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setStudioOpen(true);
                  }}
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  Настроить стол
                </Button>
              </div>
            ) : (
              <div />
            )}
            <p className="font-serif text-[1.65rem] font-medium tracking-[-0.03em] text-[hsl(36_40%_96%)] sm:text-[2.15rem]">
              {myDesk.name}
            </p>
          </div>
        </section>
      )}

      <DeskStudioSheet
        page={studioOpen ? myDesk : null}
        open={studioOpen && Boolean(myDesk)}
        onOpenChange={(open) => {
          if (!open) setStudioOpen(false);
        }}
        uid={profile?.uid}
      />
      <CreatePageDialog open={createPageOpen} onOpenChange={setCreatePageOpen} />
    </div>
  );
}
