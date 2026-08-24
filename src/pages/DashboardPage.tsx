import { useEffect, useRef, useState } from "react";
import { Plus, Settings2 } from "lucide-react";
import { deskEase, gsap, useGSAP } from "@/lib/gsap";
import { Button } from "@/components/ui/button";
import { DeskCoverStrip } from "@/components/dashboard/DeskCoverStrip";
import { EmptyState } from "@/components/common/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { usePeopleDesks } from "@/hooks/usePeopleDesks";
import { DeskStudioSheet } from "@/components/pagesnav/DeskStudioSheet";
import { CreatePageDialog } from "@/components/pagesnav/CreatePageDialog";
import { personLabel, resolvedCoverUrl } from "@/utils/peopleDesks";
import { useNavigate } from "react-router";
import type { WorkspacePage } from "@/types";

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

export default function DashboardPage() {
  const permissions = usePermissions();
  const { profile } = useAuth();
  const { groups, activeGroup, studioPages, isLoadingWorkspaceData, selectPerson, ownerUid } = usePeopleDesks();
  const [studioPageId, setStudioPageId] = useState<string | null>(null);
  const [createPageOpen, setCreatePageOpen] = useState(false);
  const [heroPageId, setHeroPageId] = useState<string | null>(null);
  const studioPage = studioPages.find((p) => p.id === studioPageId) ?? null;
  const navigate = useNavigate();

  const heroPage: WorkspacePage | null =
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
      const nodes = deskRef.current?.querySelectorAll(".desk-hero, .desk-thumb");
      if (!nodes?.length) return;
      gsap.fromTo(nodes, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.32, stagger: 0.05, ease: deskEase });
    },
    { scope: deskRef, dependencies: [isLoadingWorkspaceData, activeGroup?.key] }
  );

  if (isLoadingWorkspaceData) {
    return (
      <div className="mx-auto max-w-6xl p-5 sm:p-8 lg:p-10">
        <Skeleton className="mb-6 aspect-[2/1] w-full rounded-[1.35rem]" />
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-40 shrink-0 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  const heroWho = heroPage
    ? personLabel(activeGroup?.member) || (activeGroup?.uid ? "Стол" : "Без ответственного")
    : "";

  return (
    <div ref={deskRef} className="relative mx-auto max-w-6xl p-5 sm:p-8 lg:p-10">
      {studioPages.length === 0 ? (
        <EmptyState
          className="rounded-2xl border border-border bg-card py-14"
          title="Пока нет столов"
          action={
            permissions.canCreatePages ? (
              <Button size="sm" className="min-h-11 gap-1.5" onClick={() => setCreatePageOpen(true)}>
                <Plus className="h-3.5 w-3.5" />
                Новый стол
              </Button>
            ) : undefined
          }
        />
      ) : heroPage && activeGroup ? (
        <>
          <section className="desk-hero relative mb-8 overflow-hidden rounded-[1.35rem] border border-border">
            <button
              type="button"
              className="block w-full text-left"
              onClick={() => navigate(`/page/${heroPage.id}`)}
            >
              <DeskCoverStrip coverUrl={resolvedCoverUrl(heroPage, ownerUid)} name={heroPage.name} ratio="hero" />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
            </button>
            <div className="pointer-events-none absolute inset-0 z-[1] flex flex-col justify-between p-4 sm:p-7">
              {permissions.canManagePage(heroPage) ? (
                <div className="pointer-events-auto self-start">
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11 rounded-full border-white/25 bg-white/10 px-4 text-[hsl(36_40%_96%)] hover:bg-white/16 hover:text-[hsl(36_40%_96%)]"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setStudioPageId(heroPage.id);
                    }}
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                    Настроить стол
                  </Button>
                </div>
              ) : (
                <div />
              )}
              <div>
              <p className="font-serif text-[1.65rem] font-medium tracking-[-0.03em] text-[hsl(36_40%_96%)] sm:text-[2.15rem]">
                {heroWho} · {heroPage.name}
              </p>
              {activeGroup.pages.length > 1 && (
                <div className="pointer-events-auto mt-3 flex max-w-full flex-wrap gap-1.5">
                  {activeGroup.pages.map((page) => (
                    <button
                      key={page.id}
                      type="button"
                      className={cn(
                        "min-h-11 rounded-full border px-3 py-1 text-[11px] font-medium text-[hsl(36_40%_96%)] sm:min-h-0 sm:py-1",
                        page.id === heroPage.id ? "border-white/50 bg-white/20" : "border-white/20 bg-black/20"
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
              </div>
            </div>
          </section>

          {others.length > 0 && (
            <section>
              <p className="mb-3 text-[13px] font-medium text-foreground">Другие люди</p>
              <div className="-mx-5 flex gap-3 overflow-x-auto px-5 pb-1 scrollbar-thin sm:mx-0 sm:px-0">
                {others.map((group) => {
                  const coverPage = group.pages[0];
                  const label = personLabel(group.member) || coverPage.name;
                  return (
                    <button
                      key={group.key}
                      type="button"
                      className="desk-thumb relative w-[8.5rem] shrink-0 overflow-hidden rounded-2xl border border-border text-left sm:w-40"
                      onClick={() => {
                        selectPerson(group.key);
                        setHeroPageId(coverPage.id);
                      }}
                    >
                      <DeskCoverStrip coverUrl={resolvedCoverUrl(coverPage, ownerUid)} name={label} ratio="thumb" />
                      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                      <p className="absolute bottom-2 left-2.5 right-2 truncate text-[12px] font-medium text-[hsl(36_40%_96%)]">
                        {label}
                      </p>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </>
      ) : null}

      <DeskStudioSheet
        page={studioPage}
        open={Boolean(studioPage)}
        onOpenChange={(open) => {
          if (!open) setStudioPageId(null);
        }}
        uid={profile?.uid}
      />
      <CreatePageDialog open={createPageOpen} onOpenChange={setCreatePageOpen} />
    </div>
  );
}
