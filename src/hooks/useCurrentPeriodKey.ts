import { useEffect, useMemo, useState } from "react";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { periodKeyFor, sanitizePeriods, type PeriodSettings } from "@/utils/periods";

/** Настройка периодов активного workspace (`workspace.periods`, см. utils/periods.ts). */
export function usePeriodSettings(): PeriodSettings {
  // Сырая ссылка из стора, а не новый объект: zustand иначе перерисовывал бы на каждом снимке.
  const raw = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId)?.periods);
  return useMemo(() => sanitizePeriods(raw), [raw]);
}

/**
 * Ключ ТЕКУЩЕГО периода столов («2026-09» или «2026-10-2») по Алматы; сам
 * переключается в полночь границы периода, пока приложение открыто. Для
 * графика смен НЕ годится — там календарный `useCurrentMonthKey`.
 */
export function useCurrentPeriodKey(): string {
  const settings = usePeriodSettings();
  const [key, setKey] = useState(() => periodKeyFor(Date.now(), settings));

  useEffect(() => {
    const check = () => {
      const next = periodKeyFor(Date.now(), settings);
      setKey((prev) => (prev === next ? prev : next));
    };
    check();
    const timer = window.setInterval(check, 60_000);
    return () => window.clearInterval(timer);
  }, [settings]);

  return key;
}
