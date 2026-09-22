import { useEffect, useState } from "react";
import { subscribeMyNotifications } from "@/services/notificationService";
import type { Notification } from "@/types";

/**
 * Подписка на свои уведомления — ОДНА на приложение, а не на компонент.
 *
 * Колокольчик висит и в сайдбаре, и в шапке (на десктопе оба сразу), а теперь
 * те же уведомления читает мост во всплывашки браузера. Три собственных
 * `onSnapshot` на один и тот же запрос — это втрое больше слушателей на Spark
 * и три показа одного всплывающего уведомления. Поэтому подписка живёт на
 * модуле и считает своих читателей: последний ушёл — слушатель закрыт.
 */
type Reader = (rows: Notification[]) => void;

interface Shared {
  key: string;
  rows: Notification[];
  readers: Set<Reader>;
  unsubscribe: () => void;
}

let shared: Shared | null = null;

function joinShared(workspaceId: string, uid: string, reader: Reader): () => void {
  const key = `${workspaceId}:${uid}`;
  if (shared && shared.key !== key) {
    shared.unsubscribe();
    shared = null;
  }
  if (!shared) {
    const next: Shared = { key, rows: [], readers: new Set(), unsubscribe: () => {} };
    shared = next;
    next.unsubscribe = subscribeMyNotifications(workspaceId, uid, (rows) => {
      next.rows = rows;
      next.readers.forEach((fn) => fn(rows));
    });
  }
  const current = shared;
  current.readers.add(reader);
  // Тот, кто подключился позже, сразу получает последний снимок: иначе второй
  // колокольчик рисовал бы «уведомлений нет» до следующего изменения.
  if (current.rows.length > 0) reader(current.rows);
  return () => {
    current.readers.delete(reader);
    if (current.readers.size === 0) {
      current.unsubscribe();
      if (shared === current) shared = null;
    }
  };
}

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
    return joinShared(workspaceId, uid, setNotifications);
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
