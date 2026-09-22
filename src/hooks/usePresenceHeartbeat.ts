import { useEffect } from "react";
import { updatePresenceHeartbeat } from "@/services/authService";
import { useAuth } from "@/hooks/useAuth";

/**
 * Раз в 15 минут, а не в 3: каждый удар — запись в member-документ КАЖДОГО
 * workspace человека плюс снимок own-member у всех его открытых вкладок, и
 * при бесплатной квоте Spark (20 000 записей в сутки) один лишь пульс съедал
 * тысячи записей. Пороги «в сети / недавно» в utils/presence.ts подняты под
 * этот шаг — ниже шага порог «в сети» терял бы смысл.
 */
const HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Минимальный промежуток между ударами — общий на ВСЕ вкладки этого
 * человека. Меньше шага интервала (12 < 15), чтобы собственный таймер
 * вкладки всегда проходил, а лишние вкладки, монтаж и visibilitychange —
 * нет: раньше каждая вкладка и каждое переключение на неё писали отдельно.
 */
const BEAT_MIN_GAP_MS = 12 * 60 * 1000;

function beatStampKey(uid: string) {
  return `nova:beat:${uid}`;
}

/**
 * Запасной штамп внутри вкладки — на случай, когда localStorage недоступен
 * (приватный режим, запрет данных сайта): тогда общие на вкладки ворота
 * теряются, но внутри вкладки пульс всё равно не чаще раза в 12 минут.
 */
const tabLastBeatAt = new Map<string, number>();

/** Удар, начатый этой вкладкой и ещё не подтверждённый сервером — второй поверх него не нужен. */
const beatInFlight = new Set<string>();

function readBeatStamp(uid: string): number {
  let shared = 0;
  try {
    const raw = window.localStorage.getItem(beatStampKey(uid));
    const parsed = raw ? Number(raw) : 0;
    if (Number.isFinite(parsed)) shared = parsed;
  } catch {
    /* хранилище закрыто — остаётся штамп вкладки */
  }
  return Math.max(shared, tabLastBeatAt.get(uid) ?? 0);
}

function writeBeatStamp(uid: string, at: number) {
  tabLastBeatAt.set(uid, at);
  try {
    window.localStorage.setItem(beatStampKey(uid), String(at));
  } catch {
    /* без хранилища — только ворота внутри вкладки */
  }
}

/** Mount once near the app root (inside AppLayout). Keeps this user's presence fresh across all their workspaces. */
export function usePresenceHeartbeat() {
  const { profile } = useAuth();
  const uid = profile?.uid;
  const workspaceIds = profile?.workspaceIds;

  useEffect(() => {
    if (!uid || !workspaceIds?.length) return;

    function beat() {
      if (document.visibilityState !== "visible") return;
      if (beatInFlight.has(uid!)) return;
      const now = Date.now();
      const age = now - readBeatStamp(uid!);
      // Штамп «из будущего» (перевели часы назад) не должен глушить пульс
      // до тех пор, пока часы его не догонят, — считаем его устаревшим.
      if (age >= 0 && age < BEAT_MIN_GAP_MS) return;

      beatInFlight.add(uid!);
      void updatePresenceHeartbeat(uid!, workspaceIds!, now)
        .then((landed) => {
          // Штамп — только после записи, дошедшей до сервера: при отказе
          // (например, resource-exhausted) следующий удар должен попробовать
          // снова, а не молчать 12 минут. И ставим время НАЧАЛА удара — ровно
          // то lastActiveAt, что легло в документ: запись, провисевшая без
          // сети, не должна засчитываться как свежий удар.
          if (landed) writeBeatStamp(uid!, now);
        })
        .finally(() => {
          beatInFlight.delete(uid!);
        });
    }

    beat();
    const interval = setInterval(beat, HEARTBEAT_INTERVAL_MS);
    document.addEventListener("visibilitychange", beat);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", beat);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, JSON.stringify(workspaceIds)]);
}
