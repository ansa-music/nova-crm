import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { RoleSwitcher } from "@/components/common/RoleSwitcher";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { Sidebar } from "@/components/layout/Sidebar";
import { useIsTablet } from "@/hooks/useMediaQuery";

export function Topbar({ title }: { title?: string }) {
  const isCompactNav = useIsTablet();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  if (!isCompactNav) return null;

  return (
    <header className={`sticky top-0 flex h-12 shrink-0 items-center gap-1.5 border-b border-primary/15 bg-transparent px-3 backdrop-blur-xl ${mobileNavOpen ? "z-[220]" : "z-30"}`}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="min-h-10 min-w-10"
        title="Меню"
        aria-label="Меню"
        aria-expanded={mobileNavOpen}
        onClick={(e) => {
          e.stopPropagation();
          setMobileNavOpen((open) => !open);
        }}
      >
        <Menu className="h-4 w-4" />
      </Button>
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent
          side="left"
          aria-describedby={undefined}
          className="h-[100dvh] max-h-[100dvh] w-[min(20rem,88vw)] max-w-[20rem] overflow-hidden bg-background p-0 border-r border-primary/25 backdrop-blur-none"
        >
          {/* Radix requires a title on every dialog surface for screen readers;
              the drawer shows the NOVA wordmark instead, so this stays sr-only. */}
          <SheetTitle className="sr-only">Навигация</SheetTitle>
          <Sidebar mobile onNavigate={() => setMobileNavOpen(false)} />
        </SheetContent>
      </Sheet>
      {title && <h1 className="truncate text-sm font-semibold">{title}</h1>}
      <div className="flex-1" />
      <NotificationBell />
      <RoleSwitcher />
    </header>
  );
}
