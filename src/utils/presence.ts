export type PresenceStatus = "online" | "away" | "offline";

// Пороги держатся от САМОГО РЕДКОГО пульса. Удар в Supabase идёт раз в 5
// минут, но запасной путь в Firestore (SQL не накатан, строки в Firestore,
// вкладки на старом коде) — по-прежнему раз в 15 минут, не чаще раза в 12 на
// все вкладки. 30, а не 20: таймер каждой вкладки идёт от её открытия, и между
// двумя Firestore-пульсами живого человека бывает до ~27 минут (порог 12 + шаг
// 15). При прежних 2 минутах «в сети» было короче самого шага.
const ONLINE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
const AWAY_THRESHOLD_MS = 90 * 60 * 1000; // 90 minutes

/**
 * Последний раз в сети по двум источникам: `lastActiveAt` member-документа
 * Firestore (его ещё пишут вкладки на старом коде и запасной путь пульса) и
 * удар в Supabase `member_presence`. Берётся максимум — новее из двух.
 */
export function mergedLastActiveAt(
  firestoreAt: number | undefined | null,
  supabaseAt: number | undefined | null
): number | undefined {
  const a = typeof firestoreAt === "number" && Number.isFinite(firestoreAt) ? firestoreAt : 0;
  const b = typeof supabaseAt === "number" && Number.isFinite(supabaseAt) ? supabaseAt : 0;
  const at = Math.max(a, b);
  return at > 0 ? at : undefined;
}

/** Принимает уже смёрженное значение (см. mergedLastActiveAt / usePresenceMap). */
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
