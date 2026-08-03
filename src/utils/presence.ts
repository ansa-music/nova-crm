export type PresenceStatus = "online" | "away" | "offline";

const ONLINE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes
const AWAY_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

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
