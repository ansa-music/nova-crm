import { useCallback, useEffect, useState } from "react";

const RECENT_LIMIT = 8;
const EVENT = "nova:page-nav-prefs";

function recentKey(uid: string) {
  return `nova-crm:recent-pages:${uid}`;
}

function pinnedKey(uid: string) {
  return `nova-crm:pinned-pages:${uid}`;
}

function uniqueIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function readIds(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return uniqueIds(parsed.filter((id): id is string => typeof id === "string" && id.length > 0));
  } catch {
    return [];
  }
}

function writeIds(key: string, ids: string[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(ids));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* private browsing */
  }
}

export function recordRecentPage(uid: string, pageId: string) {
  if (!uid || !pageId) return;
  const next = uniqueIds([pageId, ...readIds(recentKey(uid)).filter((id) => id !== pageId)]).slice(0, RECENT_LIMIT);
  writeIds(recentKey(uid), next);
}

export function togglePinnedPage(uid: string, pageId: string) {
  if (!uid || !pageId) return;
  const current = readIds(pinnedKey(uid));
  const next = current.includes(pageId) ? current.filter((id) => id !== pageId) : [...current, pageId];
  writeIds(pinnedKey(uid), next);
}

export function readPinnedPageIds(uid: string): string[] {
  if (!uid) return [];
  return readIds(pinnedKey(uid));
}

/** Personal recents + pins, uid-keyed localStorage. Not synced. */
export function useUserPageNav(uid: string | undefined | null) {
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);

  const refresh = useCallback(() => {
    if (!uid) {
      setRecentIds([]);
      setPinnedIds([]);
      return;
    }
    setRecentIds(readIds(recentKey(uid)));
    setPinnedIds(readIds(pinnedKey(uid)));
  }, [uid]);

  useEffect(() => {
    refresh();
    window.addEventListener(EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [refresh]);

  const togglePin = useCallback(
    (pageId: string) => {
      if (!uid) return;
      togglePinnedPage(uid, pageId);
    },
    [uid]
  );

  return { recentIds, pinnedIds, togglePin };
}
