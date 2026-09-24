import { useEffect, useMemo, useState } from "react";
import { useCurrentMonthKey } from "@/hooks/useCurrentMonthKey";
import { useDeskLoads } from "@/hooks/useDeskLoads";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  derivableDesk,
  fetchLeaderboardEntries,
  leaderboardFromDeskLoads,
  subscribeLeaderboard,
} from "@/services/leaderboardService";
import { useSbBackend } from "@/services/sb/sbCollections";
import { DEFAULT_STATUS_OPTIONS } from "@/utils/columnOptions";
import type { LeaderboardEntry } from "@/types";

/**
 * Цифры обложек «Столов» («Готово» / «Общий» / процент).
 *
 * Счётчики столов в Supabase (ключ `deskLoads` в sbCollections) — записи
 * выводятся из них (leaderboardFromDeskLoads): та же общая подписка
 * `desk_loads`, что у Дашборда и «Технарей», без чтений Firestore и без
 * отдельной коллекции, которую дашборды переписывали и которая расходилась
 * чтением по всем открытым «Столам». Столы без счётчиков (не столы технарей)
 * — разово из прежней коллекции leaderboard: их по-прежнему пишет дашборд.
 * Иначе (счётчики в Firestore) — живая подписка на leaderboard, как было.
 */
export function useLeaderboard(workspaceId: string | null) {
  const { activeWorkspace, pages, members } = useWorkspace();
  const monthKey = useCurrentMonthKey();
  const same = Boolean(workspaceId && activeWorkspace?.id === workspaceId);
  // null — документ workspace не пришёл: ждём, иначе старт подписался бы на
  // Firestore и тут же ушёл бы в Supabase.
  const deskBackend = useSbBackend(same ? activeWorkspace : null, "deskLoads");
  const derived = same && deskBackend === "supabase";
  const decided = Boolean(workspaceId) && (!same || deskBackend !== null);

  const [live, setLive] = useState<LeaderboardEntry[]>([]);
  useEffect(() => {
    setLive([]);
    if (!workspaceId || !decided || derived) return;
    return subscribeLeaderboard(workspaceId, setLive);
  }, [workspaceId, decided, derived]);

  const { loads } = useDeskLoads(workspaceId, derived);
  const statusOptions = activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS;
  const fromLoads = useMemo(
    () => (derived && loads ? leaderboardFromDeskLoads(loads, pages, statusOptions, monthKey) : []),
    [derived, loads, pages, statusOptions, monthKey]
  );

  // Столы, чьих цифр в счётчиках нет и не будет, — их старые записи.
  const legacyIds = useMemo(
    () => (derived ? pages.filter((p) => !derivableDesk(p, members)).map((p) => p.id).sort() : []),
    [derived, pages, members]
  );
  const legacyKey = legacyIds.join(",");
  const [legacy, setLegacy] = useState<LeaderboardEntry[]>([]);
  useEffect(() => {
    setLegacy([]);
    if (!workspaceId || !derived || !legacyKey) return;
    let cancelled = false;
    fetchLeaderboardEntries(workspaceId, legacyKey.split(",")).then(
      (entries) => {
        if (!cancelled) setLegacy(entries);
      },
      (error) => console.warn("Не удалось прочитать цифры обложек столов:", error)
    );
    return () => {
      cancelled = true;
    };
  }, [workspaceId, derived, legacyKey]);

  return useMemo(() => {
    if (!derived) return live;
    const derivedIds = new Set(fromLoads.map((e) => e.pageId));
    return [...fromLoads, ...legacy.filter((e) => !derivedIds.has(e.pageId))];
  }, [derived, live, fromLoads, legacy]);
}
