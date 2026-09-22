import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useNotifications } from "@/hooks/useNotifications";
import {
  NOTIFY_OPEN_EVENT,
  playAlertSound,
  playOrderSound,
  primeAlertSoundOnFirstInteraction,
  showBrowserNotification,
  watchBrowserNotifyPermission,
} from "@/utils/browserNotify";
import { pickFreshNotifications } from "@/utils/freshNotifications";
import type { Notification } from "@/types";

/**
 * Мост «пришло уведомление → человек это заметил»: звук, всплывашка браузера,
 * когда вкладка не на виду, и тост, когда на виду.
 *
 * Живёт в `AppLayout`, а не в колокольчике: колокольчик снимается в
 * полноэкранном режиме таблицы — ровно там, где технарь и сидит, когда
 * приходит новый заказ.
 */

const SEEN_KEY = "nova:notify-announced";
const SEEN_LIMIT = 200;

function loadSeen(): Set<string> {
  try {
    const raw = sessionStorage.getItem(SEEN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveSeen(seen: Set<string>) {
  try {
    // Держим хвост: вкладку не перезагружают неделями, а список рос бы вечно.
    const list = Array.from(seen).slice(-SEEN_LIMIT);
    sessionStorage.setItem(SEEN_KEY, JSON.stringify(list));
  } catch {
    /* приватный режим — переживём без памяти между перезагрузками */
  }
}

export function useNotificationAlerts() {
  const { activeWorkspaceId } = useWorkspace();
  const { profile } = useAuth();
  const uid = profile?.uid ?? null;
  const { notifications } = useNotifications(activeWorkspaceId, uid);
  const navigate = useNavigate();

  /**
   * Что уже показывали. Первый снимок подписки приходит пустым, а следом —
   * со всеми старыми уведомлениями сразу: поэтому «новое» определяется по
   * времени создания, а не по «это первый вызов эффекта» (см. урок в
   * CLAUDE.md). Иначе при каждом входе всплывало бы по тридцать штук.
   */
  const seenRef = useRef<Set<string> | null>(null);
  const startedAtRef = useRef(Date.now());

  useEffect(() => {
    // Смена аккаунта/workspace — своя история показов.
    seenRef.current = loadSeen();
    startedAtRef.current = Date.now();
  }, [activeWorkspaceId, uid]);

  useEffect(() => {
    primeAlertSoundOnFirstInteraction();
    watchBrowserNotifyPermission();
  }, []);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const href = (event as CustomEvent<string>).detail;
      if (typeof href === "string" && href.startsWith("/")) navigate(href);
    };
    window.addEventListener(NOTIFY_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(NOTIFY_OPEN_EVENT, onOpen);
  }, [navigate]);

  useEffect(() => {
    if (!activeWorkspaceId || !uid) return;
    const seen = seenRef.current ?? loadSeen();
    seenRef.current = seen;
    const fresh = pickFreshNotifications(notifications, seen, startedAtRef.current);
    if (fresh.length === 0) return;
    for (const n of fresh) seen.add(n.id);
    saveSeen(seen);
    // Сначала звук — один на пачку, даже если заказов приехало три. Про
    // заказ — свой звук (файл Nurba), остальное — короткий сигнал.
    if (fresh.some(isOrderNotification)) playOrderSound();
    else playAlertSound();
    for (const n of fresh.slice(0, 3)) announce(n, navigate);
  }, [notifications, activeWorkspaceId, uid, navigate]);
}

/** Уведомление про заказ: всё, что ведёт на «Заказы» (новый, «открыт всем», отклик, выдача). */
function isOrderNotification(n: Notification): boolean {
  return typeof n.href === "string" && n.href.startsWith("/orders");
}

function hrefOf(n: Notification): string | null {
  if (typeof n.href === "string" && n.href.startsWith("/")) return n.href;
  if (typeof n.pageId === "string" && n.pageId) return `/page/${n.pageId}`;
  return null;
}

function announce(n: Notification, navigate: (to: string) => void) {
  const href = hrefOf(n);
  // Вкладка на виду — всплывашка поверх неё выглядит как сбой; там свой тост.
  // `hasFocus` важен отдельно от `visibilityState`: окно браузера может быть
  // открыто на втором мониторе и формально «видимо», а человек — в другом окне.
  const hidden = document.visibilityState !== "visible" || !document.hasFocus();
  const shown = hidden && showBrowserNotification({ title: n.title, body: n.body, tag: n.id, href });
  if (shown) return;
  toast(n.title, {
    description: n.body,
    duration: n.priority === "normal" ? 6000 : 12000,
    action: href ? { label: "Открыть", onClick: () => navigate(href) } : undefined,
  });
}
