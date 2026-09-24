import { useEffect, useState } from "react";
import { cleanupOldReadNotifications, subscribeMyNotifications } from "@/services/notificationService";
import { useSbBackend, type SbBackend } from "@/services/sb/sbCollections";
import { useBootstrapStore } from "@/store/bootstrapStore";
import { useWorkspaceStore } from "@/store/workspaceStore";
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
interface NotificationsSnapshot {
  rows: Notification[];
  /**
   * Снимок Supabase из localStorage, сервер ещё не ответил: рисовать можно,
   * решать нельзя (правило fromCache) — всплывашки и «прочитать по ссылке»
   * ждут сервера.
   */
  fromCache: boolean;
}

type Reader = (snapshot: NotificationsSnapshot) => void;

interface Shared {
  key: string;
  workspaceId: string;
  uid: string;
  snapshot: NotificationsSnapshot;
  /** Пришёл ли хоть один снимок: пустой `rows` до него значит «не знаем», а не «уведомлений нет». */
  loaded: boolean;
  readers: Set<Reader>;
  unsubscribe: () => void;
}

let shared: Shared | null = null;

/**
 * Чистку старых прочитанных откладываем от старта: при входе и так идут
 * чтения профиля, столов и участников, а чистке спешить некуда.
 */
const CLEANUP_DELAY_MS = 20_000;

function joinShared(workspaceId: string, uid: string, backend: SbBackend, reader: Reader): () => void {
  // Хранилище в ключе: сменилось (Owner переключил, SQL вставили, «таблицы
  // нет») — новая подписка, а не залипшая старая.
  const key = `${workspaceId}:${uid}:${backend}`;
  if (shared && shared.key !== key) {
    shared.unsubscribe();
    shared = null;
  }
  if (!shared) {
    const next: Shared = {
      key,
      workspaceId,
      uid,
      snapshot: { rows: [], fromCache: false },
      loaded: false,
      readers: new Set(),
      unsubscribe: () => {},
    };
    shared = next;
    const stopListening = subscribeMyNotifications(
      workspaceId,
      uid,
      (rows, fromCache = false) => {
        next.snapshot = { rows, fromCache };
        next.loaded = true;
        next.readers.forEach((fn) => fn(next.snapshot));
      },
      backend
    );
    const cleanupTimer = setTimeout(() => void cleanupOldReadNotifications(workspaceId, uid), CLEANUP_DELAY_MS);
    next.unsubscribe = () => {
      clearTimeout(cleanupTimer);
      stopListening();
    };
  }
  const current = shared;
  current.readers.add(reader);
  // Тот, кто подключился позже, сразу получает последний снимок: иначе второй
  // колокольчик рисовал бы «уведомлений нет» до следующего изменения.
  if (current.loaded) reader(current.snapshot);
  return () => {
    current.readers.delete(reader);
    if (current.readers.size === 0) {
      current.unsubscribe();
      if (shared === current) shared = null;
    }
  };
}

/**
 * Последний снимок общей подписки — для кода вне React
 * (markPrivateConversationRead): свежий список уже лежит здесь, и перечитывать
 * ради него уведомления из базы незачем. null — на этого человека подписки нет,
 * первый снимок ещё не пришёл или пока есть только снимок из кэша (по нему не
 * решаем); тогда вызывающий сам решает, что делать.
 */
export function getSharedNotifications(workspaceId: string, uid: string): Notification[] | null {
  if (!shared || shared.workspaceId !== workspaceId || shared.uid !== uid || !shared.loaded) return null;
  if (shared.snapshot.fromCache) return null;
  return shared.snapshot.rows;
}

/**
 * Где уведомления этого workspace — Firestore или Supabase (правило в
 * services/sb/sbCollections.ts). `null` — документ workspace ещё не пришёл:
 * ждём, иначе старт читал бы Firestore и тут же переподписывался бы на
 * Supabase. Документа нет и в пришедшем списке — как раньше, Firestore.
 */
function useNotificationsBackend(workspaceId: string | null): SbBackend | null {
  const workspace = useWorkspaceStore((s) => (workspaceId ? s.workspaces.find((w) => w.id === workspaceId) ?? null : null));
  const listResolved = useBootstrapStore((s) => s.workspaceListResolved);
  const backend = useSbBackend(workspace, "notifications");
  if (workspace) return backend;
  return listResolved ? "firestore" : null;
}

const EMPTY: NotificationsSnapshot = { rows: [], fromCache: false };

export function useNotifications(workspaceId: string | null, uid: string | null, enabled = true) {
  const backend = useNotificationsBackend(workspaceId);
  const [optimisticReadIds, setOptimisticReadIds] = useState<string[]>([]);
  const [snapshot, setSnapshot] = useState<NotificationsSnapshot>(EMPTY);

  useEffect(() => {
    setOptimisticReadIds([]);
  }, [workspaceId, uid]);

  useEffect(() => {
    if (!enabled || !workspaceId || !uid || !backend) {
      setSnapshot(EMPTY);
      return;
    }
    return joinShared(workspaceId, uid, backend, setSnapshot);
  }, [enabled, workspaceId, uid, backend]);

  const readSet = new Set(optimisticReadIds);
  const visible = snapshot.rows.map((n) => (n.read || readSet.has(n.id) ? { ...n, read: true } : n));
  const unreadCount = visible.filter((n) => !n.read).length;

  function markReadLocal(id: string) {
    setOptimisticReadIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }

  return {
    notifications: visible,
    unreadCount,
    /** Список — из снимка на устройстве, сервер ещё не ответил (только Supabase). */
    fromCache: snapshot.fromCache,
    reload: () => {
      /* live subscription already feeds notifications */
    },
    markReadLocal,
  };
}
