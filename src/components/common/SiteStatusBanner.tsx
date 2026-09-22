import { useEffect, useState } from "react";
import { AlertTriangle, ChevronUp } from "lucide-react";

/**
 * Объявление на весь сайт — «CRM временно не работает» (просьба Nurba
 * 22.09.2026, когда кончилась квота Firestore). Текст лежит НЕ в базе, а
 * файлом на хостинге (`public/status.json`, отдаётся без кэша): база в этот
 * момент не принимает записи, а хостинг работает всегда, поэтому объявление
 * видно даже на экране загрузки и входа. Включить/выключить — поправить
 * файл и задеплоить. Сайт перечитывает его раз в 2 минуты и при возврате
 * на вкладку (это запрос к хостингу, квоту базы не тратит).
 *
 * Полоса висит поверх шапки (колокольчик, меню, на телефоне — кнопка меню),
 * поэтому её можно свернуть «Понятно» в маленький значок внизу по центру;
 * тап по значку разворачивает текст обратно. Свёрнутость помнится на
 * вкладку (sessionStorage) и только для ЭТОГО текста: новое объявление
 * снова развернётся у всех.
 */
interface SiteStatus {
  maintenance?: boolean;
  title?: string;
  message?: string;
}

const CHECK_EVERY_MS = 2 * 60_000;
const COLLAPSED_KEY = "nova:site-status-collapsed";

function statusKey(status: SiteStatus): string {
  return `${status.title ?? ""}
${status.message ?? ""}`;
}

function readCollapsed(): string | null {
  try {
    return window.sessionStorage.getItem(COLLAPSED_KEY);
  } catch {
    return null;
  }
}

function writeCollapsed(key: string | null) {
  try {
    if (key === null) window.sessionStorage.removeItem(COLLAPSED_KEY);
    else window.sessionStorage.setItem(COLLAPSED_KEY, key);
  } catch {
    /* без sessionStorage — свёрнуто до перезагрузки */
  }
}

async function fetchSiteStatus(): Promise<SiteStatus | null> {
  try {
    const res = await fetch(`/status.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as SiteStatus;
  } catch {
    return null;
  }
}

export function SiteStatusBanner() {
  const [status, setStatus] = useState<SiteStatus | null>(null);
  const [collapsedKey, setCollapsedKey] = useState<string | null>(readCollapsed);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const next = await fetchSiteStatus();
      // Не прочиталось (нет сети) — оставляем, что было, а не гасим объявление.
      if (!cancelled && next) setStatus(next);
    };
    void load();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, CHECK_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!status?.maintenance) return null;
  const title = status.title || "Nova CRM временно не работает";
  const key = statusKey(status);

  if (collapsedKey === key) {
    return (
      <button
        type="button"
        role="status"
        onClick={() => {
          writeCollapsed(null);
          setCollapsedKey(null);
        }}
        className="fixed bottom-3 left-1/2 z-[1000] flex min-h-9 max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-2 rounded-full border border-destructive/60 bg-destructive px-3.5 py-1.5 text-[13px] font-semibold text-destructive-foreground shadow-lg"
      >
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span className="truncate">{title}</span>
        <ChevronUp className="h-4 w-4 shrink-0 opacity-80" />
      </button>
    );
  }

  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-[1000] border-b border-destructive/60 bg-destructive px-4 py-3 text-destructive-foreground shadow-lg"
    >
      <div className="mx-auto flex max-w-4xl items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{title}</p>
          {status.message && <p className="mt-0.5 text-[13px] leading-5 opacity-95">{status.message}</p>}
        </div>
        <button
          type="button"
          onClick={() => {
            writeCollapsed(key);
            setCollapsedKey(key);
          }}
          className="min-h-11 shrink-0 rounded-md border border-destructive-foreground/40 px-3 text-[13px] font-semibold hover:bg-destructive-foreground/10 sm:min-h-8"
        >
          Понятно
        </button>
      </div>
    </div>
  );
}
