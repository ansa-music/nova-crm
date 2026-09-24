import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useAuthStore } from "@/store/authStore";
import { useWorkspaceStore } from "@/store/workspaceStore";
import {
  getPresenceMap,
  isPresenceConfirmed,
  presenceVersion,
  refreshPresence,
  subscribePresence,
} from "@/services/presenceService";
import { useSbBackend } from "@/services/sb/sbCollections";
import { mergedLastActiveAt } from "@/utils/presence";

/**
 * Пока экран открыт и вкладка на виду — освежать присутствие так часто.
 * Это Supabase (десяток строк, без квоты Firestore), а «в сети» иначе
 * застывало бы на том, что было при открытии экрана.
 */
const VISIBLE_REFRESH_MS = 5 * 60 * 1000;

/** Кто из участников когда был в сети — по отметке участника в Firestore и удару в Supabase. */
export type PresenceLookup = ((
  member: { uid?: string | null; lastActiveAt?: number | null } | null | undefined
) => number | undefined) & {
  /**
   * Данным можно ВЕРИТЬ, а не только рисовать по ним: присутствие в
   * Firestore (как раньше) или карта Supabase уже пришла с сервера в этой
   * вкладке. До первой удачной выборки в карте снимок из localStorage или
   * пустота (после выхода снимки стёрты), и `lastActiveAt` в Firestore у
   * людей на новом коде застыл — «давно не заходили» по такому набору
   * показал бы почти всю команду.
   */
  confirmed: boolean;
};

/**
 * Присутствие участников workspace: одна выборка из Supabase при открытии
 * экрана и при возврате на вкладку (не чаще раза в 2 минуты на вкладку —
 * общий кэш в presenceService), сразу рисуется из снимка в localStorage.
 *
 * Возвращает функцию «последний раз в сети» — максимум из `member.lastActiveAt`
 * (Firestore) и удара в Supabase: вкладки на старом коде ещё пишут в
 * Firestore, и человек не должен выпадать из «в сети», пока их не
 * перезагрузят. Когда присутствие в Firestore (строки там, флаг-откат, нет
 * SQL) — просто `member.lastActiveAt`, как раньше.
 */
export function usePresenceMap(workspaceId: string | null | undefined): PresenceLookup {
  const viewerUid = useAuthStore((s) => s.profile?.uid ?? null);
  const workspace = useWorkspaceStore((s) => (workspaceId ? s.workspaces.find((w) => w.id === workspaceId) ?? null : null));
  // Флаг `sbCollections.presence` + память «таблицы нет» (общая с панелью
  // Owner); пока SQL не накатан, экран сам раз в 10 минут спрашивает снова.
  const backend = useSbBackend(workspace, "presence");
  const onSupabase = Boolean(workspaceId && viewerUid && backend === "supabase");

  useSyncExternalStore(subscribePresence, presenceVersion, presenceVersion);
  const map = onSupabase ? getPresenceMap(viewerUid, workspaceId) : null;
  const confirmed = onSupabase ? isPresenceConfirmed(viewerUid, workspaceId) : true;

  useEffect(() => {
    if (!onSupabase || !viewerUid || !workspaceId) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void refreshPresence(viewerUid, workspaceId);
    };
    refresh();
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, VISIBLE_REFRESH_MS);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(timer);
    };
  }, [onSupabase, viewerUid, workspaceId]);

  return useMemo<PresenceLookup>(
    () =>
      Object.assign(
        (member: Parameters<PresenceLookup>[0]) =>
          mergedLastActiveAt(member?.lastActiveAt, member?.uid ? map?.get(member.uid) : undefined),
        { confirmed }
      ),
    [map, confirmed]
  );
}
