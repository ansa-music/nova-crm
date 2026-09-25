import { useState } from "react";
import { Bell } from "lucide-react";
import { useLocation, useNavigate } from "react-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { refreshWorkspaceMembers, useWorkspace } from "@/hooks/useWorkspace";
import { usePermissions } from "@/hooks/usePermissions";
import { useNotifications } from "@/hooks/useNotifications";
import { BrowserNotifyRow } from "@/components/common/BrowserNotifySetting";
import { useViewRequests } from "@/hooks/useViewRequests";
import { useOwnerAccessRequests } from "@/hooks/useOwnerAccessRequests";
import { markAllNotificationsRead, markNotificationRead } from "@/services/notificationService";
import { myDisplayName } from "@/utils/displayName";
import { usePersonName } from "@/hooks/usePersonName";
import { timeAgo } from "@/utils/date";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/utils/cn";
import { confirmDialog } from "@/utils/appDialog";
import { deskFromLocation, deskNavState } from "@/utils/deskLinks";
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

export function NotificationBell({
  className,
  onOpenChange,
}: {
  className?: string;
  /** Сайдбар держит панель раскрытой, пока список открыт: он в портале, и
      pointerleave по панели срабатывает, хотя человек ещё читает уведомления. */
  onOpenChange?: (open: boolean) => void;
}) {
  const { profile } = useAuth();
  // allPages, а не pages: запросы бывают и к столам ОС, которых в `pages` нет.
  const { activeWorkspaceId, allPages: pages, members } = useWorkspace();
  const nameOf = usePersonName();
  const { notifications, unreadCount, reload, markReadLocal } = useNotifications(activeWorkspaceId, profile?.uid ?? null);
  const { requests, resolveRequest, reload: reloadRequests } = useViewRequests(activeWorkspaceId, profile?.uid ?? null);
  const permissions = usePermissions();
  // По РЕАЛЬНОЙ роли, а не по симуляции (isWorkspaceOwner — создатель): Owner,
  // смотрящий приложение в режиме «Технарь», всё равно видит кнопки выдачи
  // прав — иначе заявка висела бы до выхода из режима.
  // Заявки по ключу решает только создатель workspace: выданному Owner
  // кнопок «Выбрать роль… / Отклонить» не показываем (правила их и не пустят).
  const { ownerRequests, reloadOwnerRequests, resolveOwnerRequest } = useOwnerAccessRequests(
    activeWorkspaceId,
    permissions.isWorkspaceOwner
  );
  const navigate = useNavigate();
  const location = useLocation();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const visible = unreadOnly ? notifications.filter((n) => !n.read) : notifications;

  return (
    <DropdownMenu
      open={menuOpen}
      onOpenChange={(open) => {
        setMenuOpen(open);
        onOpenChange?.(open);
        if (open) {
          void reload();
          void reloadRequests();
          void reloadOwnerRequests();
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
        <BrowserNotifyRow />
        <div className="max-h-96 overflow-y-auto">
          {visible.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              {unreadOnly ? "Нет непрочитанных" : "У вас пока нет новых уведомлений"}
            </div>
          ) : (
            visible.map((n) => {
              const req = n.viewRequestId ? requests.find((r) => r.id === n.viewRequestId) : null;
              const ownerReq =
                n.kind === "owner-request" && n.ownerRequestId
                  ? (ownerRequests.find((r) => r.id === n.ownerRequestId) ?? null)
                  : null;
              const ownerPending = ownerReq?.status === "pending";
              const pending = (n.kind === "view-request" && req?.status === "pending") || ownerPending;
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
                          {nameOf(n.fromUid, n.fromName)} · {timeAgo(n.createdAt)}
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
                          // На стол — с «откуда»: «Назад» в его шапке вернёт сюда же.
                          if (dest)
                            navigate(dest, dest.startsWith("/page/") ? { state: deskNavState(deskFromLocation(location)) } : undefined);
                        }}
                      >
                        <p className="truncate text-sm font-medium">{n.title}</p>
                        <p className="line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          {nameOf(n.fromUid, n.fromName)} · {timeAgo(n.createdAt)}
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
                              await resolveRequest(req, page, "approved", myDisplayName(profile, members));
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
                              await resolveRequest(req, page, "denied", myDisplayName(profile, members));
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
                    {ownerPending && ownerReq ? (
                      <div className="mt-2 flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          className="h-9 flex-1"
                          onClick={async (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            // Роль выбирается в «Настройки → Ключ доступа» — выпадашка
                            // внутри выпадашки колокольчика закрывала бы её.
                            setMenuOpen(false);
                            onOpenChange?.(false);
                            navigate("/settings?tab=access-key");
                          }}
                        >
                          Выбрать роль…
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-9 flex-1"
                          onClick={async (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (!profile) return;
                            try {
                              await resolveOwnerRequest(ownerReq, "denied", profile.uid, myDisplayName(profile, members));
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
