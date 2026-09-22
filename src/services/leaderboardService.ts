import { getDocs, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import type { LeaderboardEntry } from "@/types";

export type LeaderboardEntryDraft = Omit<LeaderboardEntry, "updatedAt">;

/**
 * Called by the page's own responsible person (or Owner) whenever their
 * dashboard recomputes their totals — keeps their own leaderboard entry
 * fresh as a side effect of them simply looking at their own numbers. There
 * is no server-side job keeping this up to date: if someone never opens
 * their dashboard, their entry goes stale. Acceptable trade-off for a
 * client-only app with no backend functions.
 */
export async function updateLeaderboardEntry(workspaceId: string, entry: LeaderboardEntryDraft) {
  if (!db) return;
  await setDoc(paths.leaderboardEntry(workspaceId, entry.pageId), { ...entry, updatedAt: Date.now() });
}

/**
 * Что эта вкладка браузера уже записала в leaderboard:
 * `${workspaceId}/${pageId}` → подпись чисел. На модуле, а не в
 * компоненте: раньше КАЖДЫЙ пересчёт «Дашборда» (а их несколько за один
 * заход — строки столов приходят партиями) переписывал запись КАЖДОГО
 * стола, у Owner — всех столов, даже если ни одна цифра не сдвинулась.
 * На Spark (20 000 записей в сутки) это тысячи пустых записей в день.
 */
const lastPublished = new Map<string, string>();

function entrySignature(entry: LeaderboardEntryDraft): string {
  // responsibleUserId — сверх чисел: стол передали другому, цифры те же, а
  // запись должна назвать нового ответственного.
  return JSON.stringify([
    entry.doneTotal,
    entry.grandTotal,
    entry.percent,
    entry.openCount ?? null,
    entry.doneCount ?? null,
    entry.pageName,
    entry.responsibleUserId,
  ]);
}

/**
 * Пишет только те записи, чьи числа отличаются от уже записанных этой
 * вкладкой. Best-effort: упавшая запись забывается, чтобы следующий
 * пересчёт попробовал её снова.
 */
export async function publishLeaderboardEntries(workspaceId: string, entries: LeaderboardEntryDraft[]) {
  await Promise.all(
    entries.map(async (entry) => {
      const key = `${workspaceId}/${entry.pageId}`;
      const signature = entrySignature(entry);
      const previous = lastPublished.get(key);
      if (previous === signature) return;
      // Отмечаем до ответа сервера, чтобы второй пересчёт, пока эта запись
      // в пути, не отправил её же ещё раз.
      lastPublished.set(key, signature);
      try {
        await updateLeaderboardEntry(workspaceId, entry);
      } catch {
        if (lastPublished.get(key) !== signature) return;
        if (previous === undefined) lastPublished.delete(key);
        else lastPublished.set(key, previous);
      }
    })
  );
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
