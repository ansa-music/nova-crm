import { useState } from "react";
import { Bell, Menu } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
import { Sidebar } from "@/components/layout/Sidebar";
import { useIsMobile } from "@/hooks/useMediaQuery";

export function Topbar({ title }: { title?: string }) {
  const isMobile = useIsMobile();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <header className="glass-panel sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b px-4">
      {isMobile && (
        <>
          <Button variant="ghost" size="icon" onClick={() => setMobileNavOpen(true)}>
            <Menu className="h-4 w-4" />
          </Button>
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetContent side="left" className="w-64 p-0">
              <Sidebar mobile />
            </SheetContent>
          </Sheet>
        </>
      )}

      {title && <h1 className="hidden shrink-0 text-sm font-semibold sm:block">{title}</h1>}

      <div className="flex-1">
        <GlobalSearch />
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" title="Уведомления">
            <Bell className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <div className="p-3 text-center text-sm text-muted-foreground">
            У вас пока нет новых уведомлений
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <ThemeToggle />
    </header>
  );
}
