import type { Notification } from "@/types";

/** Запас на расхождение часов устройств: у ОС и технаря они не совпадают. */
export const CLOCK_SKEW_MS = 2 * 60 * 1000;

/**
 * Какие уведомления показывать всплывашкой и звуком.
 *
 * Подписка сначала отдаёт ПУСТОЙ массив, и только потом — весь список разом,
 * поэтому «новое» нельзя определять как «чего не было в прошлом снимке»: при
 * каждом входе всплыло бы всё за месяц. Признак — время создания позже
 * открытия вкладки (с запасом на расхождение часов устройств) плюс память о
 * том, что уже показывали.
 */
export function pickFreshNotifications(
  rows: Notification[],
  seen: Set<string>,
  startedAt: number
): Notification[] {
  const cutoff = startedAt - CLOCK_SKEW_MS;
  return rows
    .filter((n) => !n.read && n.createdAt >= cutoff && !seen.has(n.id))
    .sort((a, b) => a.createdAt - b.createdAt);
}
