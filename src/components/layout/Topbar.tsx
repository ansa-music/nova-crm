import { useState } from "react";
import { useLocation } from "react-router";
import { Menu, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { RoleSwitcher } from "@/components/common/RoleSwitcher";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { Sidebar } from "@/components/layout/Sidebar";
import { useIsMobile, useIsTablet } from "@/hooks/useMediaQuery";
import { usePageMeta } from "@/hooks/useNavModel";

/**
 * Шапка узких экранов. Телефон (≤767): без гамбургера и drawer — разделы
 * живут в нижней панели и листе «Ещё»; слева заголовок раздела из модели,
 * справа поиск и колокольчик. Планшет (768–1023): гамбургер с drawer,
 * как раньше. `title` — совместимость: кто передаёт, тот и подписывает.
 */
export function Topbar({ title }: { title?: string }) {
  const isCompactNav = useIsTablet();
  const isPhone = useIsMobile();
  const { pathname } = useLocation();
  const meta = usePageMeta(pathname);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  if (!isCompactNav) return null;

  const heading = title ?? meta.title;

  if (isPhone) {
    return (
      // Плоская шапка: свой фон, чтобы контент под липкой шапкой не просвечивал.
      <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-1 border-b border-border bg-background pl-4 pr-1">
        <div className="min-w-0 flex-1">
          <p className="eyebrow truncate leading-none">{meta.eyebrow}</p>
          <h1 className="truncate text-[15px] font-semibold leading-tight">{heading}</h1>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-11 w-11 rounded-lg"
          title="Поиск"
          aria-label="Поиск и переход"
          onClick={() => window.dispatchEvent(new Event("nova:command-palette"))}
        >
          <Search className="h-[18px] w-[18px]" />
        </Button>
        <NotificationBell className="h-11 w-11 rounded-lg" />
      </header>
    );
  }

  return (
    <header className={`sticky top-0 flex h-12 shrink-0 items-center gap-1.5 border-b border-border bg-background px-3 ${mobileNavOpen ? "z-[220]" : "z-30"}`}>
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
          className="h-[100dvh] max-h-[100dvh] w-[min(20rem,88vw)] max-w-[20rem] overflow-hidden bg-background p-0 border-r border-border backdrop-blur-none"
        >
          {/* Radix requires a title on every dialog surface for screen readers;
              the drawer shows the NOVA wordmark instead, so this stays sr-only. */}
          <SheetTitle className="sr-only">Навигация</SheetTitle>
          {/* `mobile` — drawer никогда не сворачивается в рейку: закрепление
              (`sidebarPinned`) касается только десктопного меню. */}
          <Sidebar mobile onNavigate={() => setMobileNavOpen(false)} />
        </SheetContent>
      </Sheet>
      <h1 className="truncate text-sm font-semibold">{heading}</h1>
      <div className="flex-1" />
      <NotificationBell />
      <RoleSwitcher />
    </header>
  );
}
