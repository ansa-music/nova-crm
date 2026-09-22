import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

/**
 * Объявление на весь сайт — «CRM временно не работает» (просьба Nurba
 * 22.09.2026, когда кончилась квота Firestore). Текст лежит НЕ в базе, а
 * файлом на хостинге (`public/status.json`, отдаётся без кэша): база в этот
 * момент не принимает записи, а хостинг работает всегда, поэтому объявление
 * видно даже на экране загрузки и входа. Включить/выключить — поправить
 * файл и задеплоить. Сайт перечитывает его раз в 2 минуты и при возврате
 * на вкладку (это запрос к хостингу, квоту базы не тратит).
 */
interface SiteStatus {
  maintenance?: boolean;
  title?: string;
  message?: string;
}

const CHECK_EVERY_MS = 2 * 60_000;

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
  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-[1000] border-b border-destructive/60 bg-destructive px-4 py-3 text-destructive-foreground shadow-lg"
    >
      <div className="mx-auto flex max-w-4xl items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">{status.title || "Nova CRM временно не работает"}</p>
          {status.message && <p className="mt-0.5 text-[13px] leading-5 opacity-95">{status.message}</p>}
        </div>
      </div>
    </div>
  );
}
