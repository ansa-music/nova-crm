import { useWorkspaceStore } from "@/store/workspaceStore";
import { currentPeriodKey, DEFAULT_PERIODS, periodsOf, type PeriodSettings } from "@/utils/periods";

/**
 * Настройка периодов для НЕ-React кода (сервисы строк, автопилот вкладок,
 * заезд заказов): читается из документа workspace в сторе — он у каждой
 * сессии и так живой. Неизвестный workspace — целые месяцы, как раньше.
 */
export function periodSettingsOf(workspaceId: string | null | undefined): PeriodSettings {
  if (!workspaceId) return DEFAULT_PERIODS;
  const workspace = useWorkspaceStore.getState().workspaces.find((w) => w.id === workspaceId);
  return workspace ? periodsOf(workspace) : DEFAULT_PERIODS;
}

/** Ключ текущего периода столов этого workspace («2026-09» или «2026-10-2»). */
export function currentPeriodKeyOf(workspaceId: string | null | undefined, now: number = Date.now()): string {
  return currentPeriodKey(periodSettingsOf(workspaceId), now);
}
