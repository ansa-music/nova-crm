import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { RoleSwitcher } from "@/components/common/RoleSwitcher";
import { Sidebar } from "@/components/layout/Sidebar";
import { useIsTablet } from "@/hooks/useMediaQuery";

export function Topbar({ title }: { title?: string }) {
  const isCompactNav = useIsTablet();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  if (!isCompactNav) return null;

  return (
    <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-1.5 border-b border-border bg-background px-3">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="min-h-10 min-w-10"
        title="Меню"
        aria-label="Меню"
        onClick={(e) => {
          e.stopPropagation();
          setMobileNavOpen(true);
        }}
      >
        <Menu className="h-4 w-4" />
      </Button>
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent
          side="left"
          className="h-[100dvh] max-h-[100dvh] w-[min(20rem,88vw)] max-w-[20rem] overflow-hidden bg-background p-0 border-r border-border backdrop-blur-none"
        >
          <Sidebar mobile onNavigate={() => setMobileNavOpen(false)} />
        </SheetContent>
      </Sheet>
      {title && <h1 className="truncate text-sm font-semibold">{title}</h1>}
      <div className="flex-1" />
      <RoleSwitcher />
    </header>
  );
}
