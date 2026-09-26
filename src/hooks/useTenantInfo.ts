import { useEffect, useState } from "react";
import { supabaseRows } from "@/lib/supabaseRows";

/**
 * Тариф и статус компании (SaaS этап 2) — строка `rows_workspaces`, её читает
 * любой участник. Пишет только администратор платформы (`platform_set_tenant`).
 *
 * `null` — не знаем: компания не заведена в реестре (строки на Firestore),
 * SQL ещё не накатан, нет связи. «Не знаем» НЕ закрывает приложение — ворота
 * пускают; настоящий замок держит база (`rows_writable_workspaces` не пускает
 * запись у приостановленной компании и у той, чей пробный кончился).
 */
export interface TenantInfo {
  plan: string;
  status: "active" | "trial" | "suspended";
  trialUntil: number | null;
  seatsLimit: number | null;
}

export function tenantActive(info: TenantInfo, now = Date.now()): boolean {
  if (info.status === "active") return true;
  if (info.status === "trial") return info.trialUntil === null || info.trialUntil > now;
  return false;
}

/** Дней до конца пробного (0 — кончился сегодня или раньше); null — не пробный. */
export function trialDaysLeft(info: TenantInfo, now = Date.now()): number | null {
  if (info.status !== "trial" || info.trialUntil === null) return null;
  return Math.max(0, Math.ceil((info.trialUntil - now) / 86_400_000));
}

const REFRESH_MS = 30 * 60_000;
const cache = new Map<string, { info: TenantInfo | null; at: number }>();

async function fetchTenantInfo(workspaceId: string): Promise<TenantInfo | null> {
  const { data, error } = await supabaseRows
    .from("rows_workspaces")
    .select("plan,status,trial_until,seats_limit")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { plan?: string; status?: string; trial_until?: string | null; seats_limit?: number | null };
  const until = row.trial_until ? new Date(row.trial_until).getTime() : null;
  const status = row.status === "trial" || row.status === "suspended" ? row.status : "active";
  return {
    plan: row.plan ?? "internal",
    status,
    trialUntil: until !== null && Number.isFinite(until) ? until : null,
    seatsLimit: row.seats_limit ?? null,
  };
}

/**
 * Статус активной компании. Читается при входе, при возврате на вкладку
 * (не чаще раза в 5 минут) и раз в 30 минут на виду — одна крошечная выборка.
 */
export function useTenantInfo(workspaceId: string | null, enabled: boolean): TenantInfo | null {
  const [info, setInfo] = useState<TenantInfo | null>(() => (workspaceId ? cache.get(workspaceId)?.info ?? null : null));

  useEffect(() => {
    if (!workspaceId || !enabled) {
      setInfo(null);
      return;
    }
    let cancelled = false;
    const cached = cache.get(workspaceId);
    setInfo(cached?.info ?? null);

    const load = (force: boolean) => {
      const prev = cache.get(workspaceId);
      if (!force && prev && Date.now() - prev.at < 5 * 60_000) return;
      void fetchTenantInfo(workspaceId)
        .then((next) => {
          cache.set(workspaceId, { info: next, at: Date.now() });
          if (!cancelled) setInfo(next);
        })
        .catch(() => undefined);
    };
    load(!cached);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load(true);
    }, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") load(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [workspaceId, enabled]);

  return info;
}
