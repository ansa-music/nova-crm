import { Bell } from "lucide-react";
import { useNavigate } from "react-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useNotifications } from "@/hooks/useNotifications";
import { markAllNotificationsRead, markNotificationRead } from "@/services/notificationService";
import { timeAgo } from "@/utils/date";
import { cn } from "@/utils/cn";
import type { Notification } from "@/types";

const PRIORITY_DOT: Record<string, string> = {
  normal: "bg-muted-foreground",
  important: "bg-secondary",
  urgent: "bg-secondary",
};

function notificationHref(n: Notification): string | null {
  if (typeof n.href === "string" && n.href.startsWith("/")) return n.href;
  if (n.relatedAnnouncementId) return "/announcements";
  if (typeof n.pageId === "string" && n.pageId) return "/page/" + n.pageId;
  if (n.fromUid) return `/messages/${n.fromUid}`;
  return "/messages";
}

export function NotificationBell({ className }: { className?: string }) {
  const { profile } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const { notifications, unreadCount, reload, markReadLocal } = useNotifications(activeWorkspaceId, profile?.uid ?? null);
  const navigate = useNavigate();

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) {
          void reload();
          if (activeWorkspaceId) markAllNotificationsRead(activeWorkspaceId, notifications);
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Уведомления"
          className={cn(
            "relative flex h-8 w-8 items-center justify-center rounded-full text-foreground/85 hover:bg-sidebar-accent hover:text-foreground",
            className
          )}
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute right-1 top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 font-mono text-[8px] font-semibold text-primary-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="border-b border-border px-3 py-2">
          <p className="eyebrow">Уведомления</p>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">У вас пока нет новых уведомлений</div>
          ) : (
            notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  if (activeWorkspaceId && !n.read) {
                    markReadLocal(n.id);
                    void markNotificationRead(activeWorkspaceId, n.id);
                  }
                  const dest = notificationHref(n);
                  if (dest) navigate(dest);
                }}
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
  );
}
