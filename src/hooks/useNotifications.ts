import { fetchMyNotifications } from "@/services/notificationService";
import { usePolledData } from "@/hooks/usePolledData";
import type { Notification } from "@/types";

export function useNotifications(workspaceId: string | null, uid: string | null, enabled = true) {
  const { data: notifications, reload } = usePolledData<Notification[]>(
    Boolean(enabled && workspaceId && uid),
    () => fetchMyNotifications(workspaceId as string, uid as string),
    [],
    [workspaceId, uid]
  );

  const unreadCount = notifications.filter((n) => !n.read).length;

  return { notifications, unreadCount, reload };
}
