import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { toast } from "@/components/ui/sonner";

/**
 * «Вышла новая версия — обновите». Сайт — одностраничное приложение: вкладку
 * не перезагружают днями, и после деплоя человек продолжает работать на
 * СТАРОМ коде. Так и было со звуком заказа: его выкатили, а у всех с
 * открытой вкладкой играл прежний сигнал, пока они сами не нажали F5.
 *
 * Как узнаём: `index.html` отдаётся без кэша (firebase.json), а в нём ссылка
 * на главный бандл с хешем (`/assets/index-XXXX.js`). Хеш не тот, с которым
 * вкладка загрузилась, — значит, вышла новая версия. Проверяем раз в 5 минут,
 * пока вкладка на виду, и при возвращении на вкладку.
 *
 * Что делаем: постоянный тост «Обновить» и перезагрузка при СЛЕДУЮЩЕМ
 * переходе по разделам — переход и так уводит с текущего экрана, а
 * перезагрузка на месте могла бы съесть недописанную ячейку.
 */

const CHECK_EVERY_MS = 5 * 60_000;
const MIN_GAP_MS = 60_000;
const TOAST_ID = "nova-app-update";

function currentEntry(): string | null {
  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]');
  if (!script) return null;
  try {
    return new URL(script.src, window.location.href).pathname;
  } catch {
    return null;
  }
}

async function latestEntry(): Promise<string | null> {
  const res = await fetch(`/index.html?check=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return null;
  const html = await res.text();
  return html.match(/\/assets\/index-[\w-]+\.js/)?.[0] ?? null;
}

export function useAppUpdateCheck() {
  const location = useLocation();
  const updateReadyRef = useRef(false);
  const firstPathRef = useRef(location.pathname + location.search);

  useEffect(() => {
    // В разработке бандла с хешем нет — сравнивать не с чем.
    const loaded = currentEntry();
    if (!loaded) return;
    let lastCheck = 0;
    let cancelled = false;

    const check = async () => {
      if (cancelled || updateReadyRef.current || document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastCheck < MIN_GAP_MS) return;
      lastCheck = now;
      try {
        const latest = await latestEntry();
        if (cancelled || !latest || latest === loaded) return;
        updateReadyRef.current = true;
        toast("Вышла новая версия Nova", {
          id: TOAST_ID,
          description: "Обновите страницу, чтобы получить последние изменения.",
          duration: Infinity,
          action: { label: "Обновить", onClick: () => window.location.reload() },
        });
      } catch {
        /* нет сети — проверим в следующий раз */
      }
    };

    const interval = window.setInterval(() => void check(), CHECK_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  // Новая версия уже есть, а человек перешёл в другой раздел — загружаем
  // этот раздел уже новым кодом.
  useEffect(() => {
    const path = location.pathname + location.search;
    if (path === firstPathRef.current) return;
    firstPathRef.current = path;
    if (updateReadyRef.current) window.location.reload();
  }, [location.pathname, location.search]);
}
