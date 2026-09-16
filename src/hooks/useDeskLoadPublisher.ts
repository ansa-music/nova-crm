import { useEffect, useMemo, useRef } from "react";
import { useCurrentMonthKey } from "@/hooks/useCurrentMonthKey";
import { publishDeskLoad } from "@/services/deskLoadService";
import { countDeskLoad, deskLoadSignature } from "@/utils/techLoad";
import type { PageRow, SubPage, WorkspacePage } from "@/types";

/**
 * Keeps «Технари» current from the desk itself: while this month's tab is
 * open with its rows loaded, every change to the order counts is published
 * as the desk's DeskLoad. Nothing is written when the numbers didn't change.
 * Debounced — a snapshot can briefly come back empty from cache before the
 * real rows, and that blip must not reach the ОС as «0 заказов».
 */
export function useDeskLoadPublisher({
  page,
  subPage,
  rows,
  rowsLoading,
  canEdit,
  uid,
}: {
  page: WorkspacePage | null;
  subPage: SubPage | null;
  rows: PageRow[];
  rowsLoading: boolean;
  canEdit: boolean;
  uid: string;
}) {
  const monthKey = useCurrentMonthKey();
  const lastSignatureRef = useRef("");

  const isMonthTab = Boolean(
    page?.responsibleUserId &&
      subPage &&
      page.autoMonthKey === monthKey &&
      page.autoMonthSubPageId === subPage.id
  );
  const active = isMonthTab && canEdit && !rowsLoading && Boolean(uid);

  const counts = useMemo(
    () => (active && subPage ? countDeskLoad(subPage.columns, rows) : null),
    [active, subPage, rows]
  );

  const pageId = page?.id;
  const workspaceId = page?.workspaceId;
  const responsibleUserId = page?.responsibleUserId;
  const subPageId = subPage?.id;

  useEffect(() => {
    if (!counts || !pageId || !workspaceId || !responsibleUserId || !subPageId) return;
    const signature = deskLoadSignature({ ...counts, subPageId, monthKey });
    if (signature === lastSignatureRef.current) return;
    const timer = window.setTimeout(() => {
      lastSignatureRef.current = signature;
      publishDeskLoad({
        pageId,
        workspaceId,
        responsibleUserId,
        monthKey,
        subPageId,
        total: counts.total,
        statusCounts: counts.statusCounts,
        updatedBy: uid,
      }).catch((error) => {
        lastSignatureRef.current = "";
        console.warn(`Не удалось обновить загрузку стола ${pageId}:`, error);
      });
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [counts, pageId, workspaceId, responsibleUserId, subPageId, monthKey, uid]);
}
