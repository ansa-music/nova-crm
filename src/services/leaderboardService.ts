import { getDocs, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import type { LeaderboardEntry } from "@/types";

/**
 * Called by the page's own responsible person (or Owner) whenever their
 * dashboard recomputes their totals — keeps their own leaderboard entry
 * fresh as a side effect of them simply looking at their own numbers. There
 * is no server-side job keeping this up to date: if someone never opens
 * their dashboard, their entry goes stale. Acceptable trade-off for a
 * client-only app with no backend functions.
 */
export async function updateLeaderboardEntry(workspaceId: string, entry: Omit<LeaderboardEntry, "updatedAt">) {
  if (!db) return;
  await setDoc(paths.leaderboardEntry(workspaceId, entry.pageId), { ...entry, updatedAt: Date.now() });
}

export async function fetchLeaderboard(workspaceId: string): Promise<LeaderboardEntry[]> {
  if (!db) return [];
  const snap = await getDocs(paths.leaderboard(workspaceId));
  return snap.docs.map((d) => d.data() as LeaderboardEntry);
}

export function subscribeLeaderboard(
  workspaceId: string,
  cb: (rows: LeaderboardEntry[]) => void
) {
  if (!db) {
    cb([]);
    return () => {};
  }
  return onSnapshot(paths.leaderboard(workspaceId), (snap) => {
    cb(snap.docs.map((d) => d.data() as LeaderboardEntry));
  });
}
