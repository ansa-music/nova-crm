export type PresenceStatus = "online" | "away" | "offline";

// Пороги держатся от шага пульса (usePresenceHeartbeat: раз в 15 минут, не
// чаще раза в 12 на все вкладки). При прежних 2 минутах «в сети» было короче
// самого шага — живой человек почти всё время числился «недавно».
// 30, а не 20: таймер каждой вкладки идёт от её открытия, и между двумя
// пульсами живого человека бывает до ~27 минут (порог 12 мин + шаг 15).
const ONLINE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
const AWAY_THRESHOLD_MS = 90 * 60 * 1000; // 90 minutes

export function getPresenceStatus(lastActiveAt: number | undefined | null): PresenceStatus {
  if (!lastActiveAt) return "offline";
  const diff = Date.now() - lastActiveAt;
  if (diff < ONLINE_THRESHOLD_MS) return "online";
  if (diff < AWAY_THRESHOLD_MS) return "away";
  return "offline";
}

export const PRESENCE_LABEL: Record<PresenceStatus, string> = {
  online: "В сети",
  away: "Был(а) недавно",
  offline: "Не в сети",
};

export const PRESENCE_DOT_COLOR: Record<PresenceStatus, string> = {
  online: "bg-emerald-500",
  away: "bg-amber-500",
  offline: "bg-muted-foreground/50",
};
