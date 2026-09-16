import { useEffect } from "react";
import { useCurrentMonthKey } from "@/hooks/useCurrentMonthKey";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { ensureMonthTab, isMonthlyDesk } from "@/services/monthTabService";
import { ensureFreezeStatus } from "@/services/workspaceService";

// Session-wide: each desk/month is attempted once per page load, whatever
// the pages snapshot does in between. A failure waits for the next load
// instead of retrying on every snapshot.
const attempted = new Set<string>();
let queue: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<void>) {
  queue = queue.then(task).catch(() => undefined);
}

/**
 * Keeps every Технар desk on its current-month tab (see monthTabService.ts).
 * The Owner's session maintains all Технар desks — so opening the site on
 * the 1st rolls the whole team over — and a Технар's session maintains
 * their own. Mounted once, in AppLayout.
 *
 * Uses the REAL role: this is background maintenance the account is
 * genuinely allowed to do, not UI that a role simulation should hide.
 */
export function useMonthTabAutopilot() {
  const { activeWorkspace, activeWorkspaceId, pages, members } = useWorkspace();
  const permissions = usePermissions();
  const monthKey = useCurrentMonthKey();
  const uid = permissions.uid;
  // Owner or Тимлид: maintains every Технар desk.
  const isOwner = permissions.hasFullDeskAccess;
  const ready = permissions.isResolved && Boolean(uid && activeWorkspaceId);

  useEffect(() => {
    if (!ready || !activeWorkspaceId || !isOwner || activeWorkspace?.freezeStatusSeeded) return;
    const key = `freeze:${activeWorkspaceId}`;
    if (attempted.has(key)) return;
    attempted.add(key);
    enqueue(() =>
      ensureFreezeStatus(activeWorkspaceId).catch((error) => {
        console.error("Не удалось добавить статус «Заморозка»:", error);
      })
    );
  }, [ready, activeWorkspaceId, isOwner, activeWorkspace?.freezeStatusSeeded]);

  useEffect(() => {
    if (!ready || !activeWorkspaceId) return;
    for (const page of pages) {
      if (page.autoMonthKey === monthKey) continue;
      if (!isOwner && page.responsibleUserId !== uid) continue;
      if (!isMonthlyDesk(page, members)) continue;
      const key = `${activeWorkspaceId}:${page.id}:${monthKey}`;
      if (attempted.has(key)) continue;
      attempted.add(key);
      enqueue(async () => {
        try {
          await ensureMonthTab(page, monthKey, uid);
        } catch (error) {
          console.error(`Не удалось подготовить вкладку месяца для стола ${page.id}:`, error);
        }
      });
    }
  }, [ready, activeWorkspaceId, pages, members, monthKey, isOwner, uid]);
}
