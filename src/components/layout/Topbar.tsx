import { useState } from "react";
import { Bell, Keyboard, Menu } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { RoleSwitcher } from "@/components/common/RoleSwitcher";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
import { Sidebar } from "@/components/layout/Sidebar";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useNotifications } from "@/hooks/useNotifications";
import { markAllNotificationsRead, markNotificationRead } from "@/services/notificationService";
import { timeAgo } from "@/utils/date";
import { cn } from "@/utils/cn";
import { useUiStore } from "@/store/uiStore";

const PRIORITY_DOT: Record<string, string> = {
  normal: "bg-muted-foreground",
  important: "bg-amber-500",
  urgent: "bg-red-500",
};

export function Topbar({ title }: { title?: string }) {
  const isMobile = useIsMobile();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { profile } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const { notifications, unreadCount } = useNotifications(activeWorkspaceId, profile?.uid ?? null);

  return (
    <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-1.5 border-b border-border/50 bg-background/55 px-3 backdrop-blur-xl sm:px-4">
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

      <DropdownMenu
        onOpenChange={(open) => {
          if (open && activeWorkspaceId) markAllNotificationsRead(activeWorkspaceId, notifications);
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" title="Уведомления" className="relative">
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-0.5 font-mono text-[9px] font-semibold text-primary-foreground">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80 p-0">
          <div className="border-b border-border px-3 py-2"><p className="eyebrow">Уведомления</p></div>
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                У вас пока нет новых уведомлений
              </div>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => activeWorkspaceId && !n.read && markNotificationRead(activeWorkspaceId, n.id)}
                  className={cn(
                    "flex w-full items-start gap-2 border-b border-border px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-accent/40",
                    !n.read && "bg-accent/20"
                  )}
                >
                  <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", PRIORITY_DOT[n.priority])} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{n.title}</p>
                    <p className="line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {n.fromName} · {timeAgo(n.createdAt)}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <RoleSwitcher />
      <Button
        variant="ghost"
        size="icon"
        title="Горячие клавиши (?)"
        onClick={() => useUiStore.getState().setShortcutsHelpOpen(true)}
      >
        <Keyboard className="h-4 w-4" />
      </Button>
      <ThemeToggle />
    </header>
  );
}
