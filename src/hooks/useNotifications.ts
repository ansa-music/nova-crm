import { useEffect, useState } from "react";
import { fetchMyNotifications } from "@/services/notificationService";
import { usePolledData } from "@/hooks/usePolledData";
import { INBOX_CHANGED_EVENT } from "@/utils/inboxEvents";
import type { Notification } from "@/types";

export function useNotifications(workspaceId: string | null, uid: string | null, enabled = true) {
  const [optimisticReadIds, setOptimisticReadIds] = useState<string[]>([]);
  const { data: notifications, reload } = usePolledData<Notification[]>(
    Boolean(enabled && workspaceId && uid),
    () => fetchMyNotifications(workspaceId as string, uid as string),
    [],
    [workspaceId, uid]
  );

  useEffect(() => {
    setOptimisticReadIds([]);
  }, [workspaceId, uid]);

  useEffect(() => {
    function onChanged() {
      void reload();
    }
    window.addEventListener(INBOX_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(INBOX_CHANGED_EVENT, onChanged);
  }, [reload]);

  const readSet = new Set(optimisticReadIds);
  const visible = notifications.map((n) => (n.read || readSet.has(n.id) ? { ...n, read: true } : n));
  const unreadCount = visible.filter((n) => !n.read).length;

  function markReadLocal(id: string) {
    setOptimisticReadIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }

  return { notifications: visible, unreadCount, reload, markReadLocal };
}
