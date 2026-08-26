import { useState } from "react";
import { Bell } from "lucide-react";
import { useNavigate } from "react-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useNotifications } from "@/hooks/useNotifications";
import { useViewRequests } from "@/hooks/useViewRequests";
import { markAllNotificationsRead, markNotificationRead } from "@/services/notificationService";
import { displayNameOf } from "@/utils/displayName";
import { timeAgo } from "@/utils/date";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/utils/cn";
import type { Notification } from "@/types";

const PRIORITY_DOT: Record<string, string> = {
  normal: "bg-muted-foreground",
  important: "bg-primary",
  urgent: "bg-primary",
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
  const { activeWorkspaceId, pages } = useWorkspace();
  const { notifications, unreadCount, reload, markReadLocal } = useNotifications(activeWorkspaceId, profile?.uid ?? null);
  const { requests, resolveRequest, reload: reloadRequests } = useViewRequests(activeWorkspaceId, profile?.uid ?? null);
  const navigate = useNavigate();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const visible = unreadOnly ? notifications.filter((n) => !n.read) : notifications;

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) {
          void reload();
          void reloadRequests();
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
        <div className="flex items-center justify-between gap-2 border-b border-primary/25 px-3 py-2">
          <p className="eyebrow">Уведомления</p>
          <button
            type="button"
            onClick={() => setUnreadOnly((v) => !v)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              unreadOnly
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border bg-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            Непрочитанные
          </button>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {visible.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              {unreadOnly ? "Нет непрочитанных" : "У вас пока нет новых уведомлений"}
            </div>
          ) : (
            visible.map((n) => {
              const req = n.viewRequestId ? requests.find((r) => r.id === n.viewRequestId) : null;
              const pending = n.kind === "view-request" && req?.status === "pending";
              return (
                <div
                  key={n.id}
                  className={cn(
                    "flex w-full items-start gap-2 border-b border-border px-3 py-2.5 text-left last:border-0",
                    !n.read && "bg-primary/[0.06]"
                  )}
                >
                  <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", PRIORITY_DOT[n.priority])} />
                  <div className="min-w-0 flex-1">
                    {pending ? (
                      <div>
                        <p className="truncate text-sm font-medium">{n.title}</p>
                        <p className="line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          {n.fromName} · {timeAgo(n.createdAt)}
                        </p>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="w-full text-left"
                        onClick={() => {
                          if (activeWorkspaceId && !n.read) {
                            markReadLocal(n.id);
                            void markNotificationRead(activeWorkspaceId, n.id);
                          }
                          const dest = notificationHref(n);
                          if (dest) navigate(dest);
                        }}
                      >
                        <p className="truncate text-sm font-medium">{n.title}</p>
                        <p className="line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          {n.fromName} · {timeAgo(n.createdAt)}
                        </p>
                      </button>
                    )}
                    {pending && req ? (
                      <div className="mt-2 flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          className="h-9 flex-1"
                          onClick={async (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            try {
                              const page = pages.find((p) => p.id === req.pageId);
                              await resolveRequest(req, page, "approved", displayNameOf(profile));
                              toast.success("Доступ открыт");
                            } catch (error) {
                              toast.error(error instanceof Error ? error.message : "Не удалось принять");
                            }
                          }}
                        >
                          Принять
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-9 flex-1"
                          onClick={async (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            try {
                              const page = pages.find((p) => p.id === req.pageId);
                              await resolveRequest(req, page, "denied", displayNameOf(profile));
                              toast.success("Запрос отклонён");
                            } catch (error) {
                              toast.error(error instanceof Error ? error.message : "Не удалось отклонить");
                            }
                          }}
                        >
                          Отклонить
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
