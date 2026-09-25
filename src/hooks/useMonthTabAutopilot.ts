import { useEffect } from "react";
import { useCurrentPeriodKey } from "@/hooks/useCurrentPeriodKey";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { ensureMonthTab, findMonthTab, isMonthlyDesk } from "@/services/monthTabService";
import { carryDefaultIds } from "@/utils/carryOver";
import { carryOverRows, listCarryCandidates } from "@/services/rows/carryOver";
import { sbBackendOf } from "@/services/sb/sbCollections";
import { fetchSubPages } from "@/services/subPageService";
import { ensureFreezeStatus } from "@/services/workspaceService";
import { toast } from "@/components/ui/sonner";
import { DEFAULT_STATUS_OPTIONS } from "@/utils/columnOptions";
import { periodLabel, periodOfTabId, periodsOf, previousPeriodKey } from "@/utils/periods";
import { effectiveTechLoadKinds } from "@/utils/techLoad";

// Session-wide: each desk/month is attempted once per page load, whatever
// the pages snapshot does in between. A failure waits for the next load
// instead of retrying on every snapshot.
const attempted = new Set<string>();
let queue: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<void>) {
  queue = queue.then(task).catch(() => undefined);
}

/**
 * Keeps every Технарь desk on its current-month tab (see monthTabService.ts).
 * The Owner's session maintains all Технарь desks — so opening the site on
 * the 1st rolls the whole team over — and a Технарь's session maintains
 * their own. Mounted once, in AppLayout.
 *
 * Uses the REAL role: this is background maintenance the account is
 * genuinely allowed to do, not UI that a role simulation should hide.
 */
export function useMonthTabAutopilot() {
  const { activeWorkspace, activeWorkspaceId, pages, members } = useWorkspace();
  const permissions = usePermissions();
  const monthKey = useCurrentPeriodKey();
  const uid = permissions.uid;
  // The Owner maintains every Технарь desk (a Тимлид reads no desks).
  const isOwner = permissions.upkeepOwner;
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
      // Вкладка месяца на месте — но карта столбцов может отставать: у
      // столов, размеченных до появления «стола ОС», её нет вовсе, и ОС не
      // может выдать туда заказ («стол не сообщил ключи столбцов»). Чиним
      // тем же проходом: один раз на стол, дальше условие уже не сработает.
      const monthReady = page.autoMonthKey === monthKey;
      const keysReady =
        Boolean(page.autoMonthSubPageId) && page.osFieldKeys?.tabId === page.autoMonthSubPageId;
      if (monthReady && keysReady) continue;
      if (!isOwner && page.responsibleUserId !== uid) continue;
      if (!isMonthlyDesk(page, members)) continue;
      const key = `${activeWorkspaceId}:${page.id}:${monthKey}`;
      if (attempted.has(key)) continue;
      attempted.add(key);
      enqueue(async () => {
        try {
          const tabId = await ensureMonthTab(page, monthKey, uid);
          // Автоперенос незавершённых (Owner включил в «Настройки → Периоды»):
          // сразу после того, как стол получил вкладку нового периода — раз на
          // стол и период в этой вкладке браузера. Owner + технарь могут
          // запустить оба: второй получит moved: [] (дубли пропускаются).
          const settings = periodsOf(activeWorkspace);
          if (!settings.autoCarry || !activeWorkspace || monthReady) return;
          const autoKey = `nova:carry-auto:${activeWorkspaceId}:${page.id}:${monthKey}`;
          try {
            if (sessionStorage.getItem(autoKey)) return;
            sessionStorage.setItem(autoKey, String(Date.now()));
          } catch {
            /* приватный режим — переносим без памяти */
          }
          const subs = await fetchSubPages(page.workspaceId, page.id);
          const toTab = subs.find((s) => s.id === tabId);
          const fromTab = findMonthTab(subs, previousPeriodKey(monthKey, settings));
          if (!toTab || !fromTab || fromTab.id === toTab.id || fromTab.isArchived) return;
          const statusOptions = activeWorkspace.statusOptions ?? DEFAULT_STATUS_OPTIONS;
          const candidates = await listCarryCandidates({
            workspaceId: page.workspaceId,
            page,
            fromTab,
            statusOptions,
            kinds: effectiveTechLoadKinds(activeWorkspace),
            force: true,
          });
          const ids = carryDefaultIds(candidates.groups);
          const rows = candidates.all.filter((r) => ids.has(r.id));
          if (rows.length === 0) return;
          const result = await carryOverRows({
            workspaceId: page.workspaceId,
            page,
            fromTab,
            toTab,
            rows,
            allFromRows: candidates.all,
            oldPeriodKey: periodOfTabId(fromTab.id) ?? fromTab.monthKey ?? previousPeriodKey(monthKey, settings),
            responsibleOptions: activeWorkspace.responsibleOptions ?? [],
            uid,
            deskLoadBackend: sbBackendOf(activeWorkspace, "deskLoads"),
          });
          if (result.moved.length > 0) {
            toast.success(`Перенесено ${result.moved.length} заказов в «${periodLabel(monthKey, settings)}»`, {
              description: page.name,
            });
          }
        } catch (error) {
          console.error(`Не удалось подготовить вкладку месяца для стола ${page.id}:`, error);
        }
      });
    }
  }, [ready, activeWorkspaceId, activeWorkspace, pages, members, monthKey, isOwner, uid]);
}
