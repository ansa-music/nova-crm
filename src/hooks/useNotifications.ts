import { useEffect, useState } from "react";
import { subscribeMyNotifications } from "@/services/notificationService";
import type { Notification } from "@/types";

export function useNotifications(workspaceId: string | null, uid: string | null, enabled = true) {
  const [optimisticReadIds, setOptimisticReadIds] = useState<string[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    setOptimisticReadIds([]);
  }, [workspaceId, uid]);

  useEffect(() => {
    if (!enabled || !workspaceId || !uid) {
      setNotifications([]);
      return;
    }
    const unsubscribe = subscribeMyNotifications(workspaceId, uid, setNotifications);
    return unsubscribe;
  }, [enabled, workspaceId, uid]);

  const readSet = new Set(optimisticReadIds);
  const visible = notifications.map((n) => (n.read || readSet.has(n.id) ? { ...n, read: true } : n));
  const unreadCount = visible.filter((n) => !n.read).length;

  function markReadLocal(id: string) {
    setOptimisticReadIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }

  return {
    notifications: visible,
    unreadCount,
    reload: () => {
      /* live onSnapshot already feeds notifications */
    },
    markReadLocal,
  };
}
