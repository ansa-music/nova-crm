import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentMonthKey } from "@/hooks/useCurrentMonthKey";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { refreshDeskLoadFromRows, subscribeDeskLoadHistory, subscribeDeskLoads } from "@/services/deskLoadService";
import { currentMonthSubPageId, isMonthlyDesk } from "@/services/monthTabService";
import { subscribeTechRatings } from "@/services/techRatingService";
import type { DeskLoad, DeskLoadArchive, TechRating } from "@/types";

/**
 * Every desk's month counts, live. `loads` stays null until the first
 * snapshot; a denied read sets `failed` — it is "unknown", never "empty".
 */
export function useDeskLoads(workspaceId: string | null, enabled: boolean) {
  const [loads, setLoads] = useState<DeskLoad[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setLoads(null);
    setFailed(false);
    if (!workspaceId || !enabled) return;
    return subscribeDeskLoads(
      workspaceId,
      (next) => {
        setLoads(next);
        setFailed(false);
      },
      () => setFailed(true)
    );
  }, [workspaceId, enabled]);
  return { loads, failed };
}

/** Every ОС rating of every Технар, live. */
export function useTechRatings(workspaceId: string | null, enabled: boolean) {
  const [ratings, setRatings] = useState<TechRating[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setRatings(null);
    setFailed(false);
    if (!workspaceId || !enabled) return;
    return subscribeTechRatings(
      workspaceId,
      (next) => {
        setRatings(next);
        setFailed(false);
      },
      () => setFailed(true)
    );
  }, [workspaceId, enabled]);
  return { ratings, failed };
}

/** Archived months from `fromMonthKey` on. Empty (not null) on a denied read — the chart just hides. */
export function useDeskLoadHistory(workspaceId: string | null, fromMonthKey: string, enabled: boolean) {
  const [history, setHistory] = useState<DeskLoadArchive[]>([]);
  useEffect(() => {
    setHistory([]);
    if (!workspaceId || !enabled) return;
    return subscribeDeskLoadHistory(workspaceId, fromMonthKey, setHistory, () => setHistory([]));
  }, [workspaceId, fromMonthKey, enabled]);
  return history;
}

// Each desk's month tab at most this often per page load, shared by every
// screen that recounts. Keyed by the tab, so a desk the month autopilot
// rolls over while a screen is open gets counted right away.
const REFRESH_EVERY_MS = 5 * 60 * 1000;
const lastRefreshAt = new Map<string, number>();

/**
 * Owner-only background recount: the Owner can read every desk, so desks
 * nobody opened lately still show the truth on «Технари» and «Дашборд».
 * Everyone else relies on the counts each desk publishes while its Технар
 * works in it.
 */
export function useOwnerDeskRecount(loads: DeskLoad[] | null) {
  const { activeWorkspace, activeWorkspaceId, members, pages } = useWorkspace();
  const permissions = usePermissions();
  const { profile } = useAuth();
  const monthKey = useCurrentMonthKey();
  const isOwner = permissions.hasFullDeskAccess;
  const uid = profile?.uid ?? "";
  const loadsRef = useRef(loads);
  loadsRef.current = loads;
  const optionsRef = useRef(activeWorkspace?.responsibleOptions ?? []);
  optionsRef.current = activeWorkspace?.responsibleOptions ?? [];
  const loadsReady = loads !== null;

  useEffect(() => {
    if (!isOwner || !activeWorkspaceId || !uid || !loadsReady) return;
    const startedAt = Date.now();
    const desks = pages.filter((p) => {
      const subPageId = currentMonthSubPageId(p, monthKey);
      if (!subPageId || !isMonthlyDesk(p, members)) return false;
      const key = `${p.id}:${subPageId}`;
      if (startedAt - (lastRefreshAt.get(key) ?? 0) < REFRESH_EVERY_MS) return false;
      lastRefreshAt.set(key, startedAt);
      return true;
    });
    if (desks.length === 0) return;
    void (async () => {
      for (let i = 0; i < desks.length; i += 3) {
        await Promise.all(
          desks.slice(i, i + 3).map((desk) =>
            refreshDeskLoadFromRows(
              desk,
              monthKey,
              uid,
              loadsRef.current?.find((l) => l.pageId === desk.id),
              optionsRef.current
            ).catch((error) => console.warn(`Не удалось пересчитать стол ${desk.id}:`, error))
          )
        );
      }
    })();
  }, [isOwner, activeWorkspaceId, uid, loadsReady, members, pages, monthKey]);
}
