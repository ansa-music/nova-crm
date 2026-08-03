import { useEffect, useState } from "react";
import { subscribeToMyNotifications } from "@/services/notificationService";
import type { Notification } from "@/types";

export function useNotifications(workspaceId: string | null, uid: string | null) {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    if (!workspaceId || !uid) {
      setNotifications([]);
      return;
    }
    return subscribeToMyNotifications(workspaceId, uid, setNotifications, (error) =>
      console.error("subscribeToMyNotifications denied:", error.code, error.message)
    );
  }, [workspaceId, uid]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return { notifications, unreadCount };
}
