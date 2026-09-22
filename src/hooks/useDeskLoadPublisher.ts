import { useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentMonthKey } from "@/hooks/useCurrentMonthKey";
import { useWorkspace } from "@/hooks/useWorkspace";
import { publishDeskLoad } from "@/services/deskLoadService";
import { sendNotification } from "@/services/notificationService";
import { publishOsOrders } from "@/services/osOrdersService";
import { DEFAULT_STATUS_OPTIONS } from "@/utils/columnOptions";
import { myDisplayName } from "@/utils/displayName";
import { collectOsOrders, countDeskLoad, deskLoadSignature, osOrdersSignature } from "@/utils/techLoad";
import type { OsOrderItem, PageRow, StatusOption, SubPage, WorkspacePage } from "@/types";

const NO_OPTIONS: StatusOption[] = [];

/** What each order looked like at the last publish — to tell the ОС what changed. */
type OrderSnapshot = { pageId: string; subPageId: string; byRow: Map<string, { status: string; title: string; os: string[] }> };

/**
 * Keeps «Технари» current from the desk itself: while this month's tab is
 * open with its rows loaded, every change to the order counts is published
 * as the desk's DeskLoad, and each ОС's own order list as their OsOrders.
 * Nothing is written when the numbers didn't change. Debounced — a snapshot
 * can briefly come back empty from cache before the real rows, and that
 * blip must not reach the ОС as «0 заказов».
 *
 * When a published order's status changes, the ОС who gave it gets a
 * notification — from this session's baseline on, never on first load.
 */
export function useDeskLoadPublisher({
  page,
  subPage,
  rows,
  rowsLoading,
  canEdit,
  uid,
  responsibleOptions = NO_OPTIONS,
}: {
  page: WorkspacePage | null;
  subPage: SubPage | null;
  rows: PageRow[];
  rowsLoading: boolean;
  canEdit: boolean;
  uid: string;
  /** Shared «Ответственный» list — resolves ОС columns to option values. */
  responsibleOptions?: StatusOption[];
}) {
  const monthKey = useCurrentMonthKey();
  const { members, activeWorkspace } = useWorkspace();
  const { profile } = useAuth();
  const lastSignatureRef = useRef("");
  const lastOsSignaturesRef = useRef(new Map<string, string>());
  const lastOrdersRef = useRef<OrderSnapshot | null>(null);

  const isMonthTab = Boolean(
    page?.responsibleUserId &&
      subPage &&
      page.autoMonthKey === monthKey &&
      page.autoMonthSubPageId === subPage.id
  );
  const active = isMonthTab && canEdit && !rowsLoading && Boolean(uid);

  const counts = useMemo(
    () => (active && subPage ? countDeskLoad(subPage.columns, rows, responsibleOptions, monthKey) : null),
    [active, subPage, rows, responsibleOptions, monthKey]
  );
  const osOrders = useMemo(
    () => (active && subPage ? collectOsOrders(subPage.columns, rows, responsibleOptions) : null),
    [active, subPage, rows, responsibleOptions]
  );

  const pageId = page?.id;
  const pageName = page?.name ?? "";
  const workspaceId = page?.workspaceId;
  const responsibleUserId = page?.responsibleUserId;
  const subPageId = subPage?.id;
  const statusOptions = activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS;
  const membersRef = useRef(members);
  membersRef.current = members;
  const fromName = myDisplayName(profile, members);

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
        osCounts: counts.osCounts,
        osStatusCounts: counts.osStatusCounts,
        osLastOrderAt: counts.osLastOrderAt,
        grandTotal: counts.grandTotal,
        statusSums: counts.statusSums,
        dayCounts: counts.dayCounts,
        daySums: counts.daySums,
        updatedBy: uid,
      }).catch((error) => {
        lastSignatureRef.current = "";
        console.warn(`Не удалось обновить загрузку стола ${pageId}:`, error);
      });
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [counts, pageId, workspaceId, responsibleUserId, subPageId, monthKey, uid]);

  useEffect(() => {
    if (!osOrders || !pageId || !workspaceId || !responsibleUserId || !subPageId) return;
    const timer = window.setTimeout(() => {
      for (const [osValue, orders] of Object.entries(osOrders)) {
        const key = `${pageId}:${osValue}`;
        const signature = osOrdersSignature(orders, subPageId, monthKey);
        if (lastOsSignaturesRef.current.get(key) === signature) continue;
        lastOsSignaturesRef.current.set(key, signature);
        publishOsOrders({ pageId, workspaceId, responsibleUserId, osValue, monthKey, subPageId, orders, updatedBy: uid }).catch(
          (error) => {
            lastOsSignaturesRef.current.delete(key);
            console.warn(`Не удалось обновить заказы ОС на столе ${pageId}:`, error);
          }
        );
      }
      notifyStatusChanges(osOrders);
    }, 1500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [osOrders, pageId, workspaceId, responsibleUserId, subPageId, monthKey, uid]);

  function statusLabel(raw: string) {
    if (!raw) return "без статуса";
    return statusOptions.find((o) => o.value === raw)?.label ?? raw;
  }

  function notifyStatusChanges(current: Record<string, OsOrderItem[]>) {
    if (!pageId || !workspaceId || !subPageId) return;
    const byRow = new Map<string, { status: string; title: string; os: string[] }>();
    for (const [osValue, orders] of Object.entries(current)) {
      for (const order of orders) {
        const entry = byRow.get(order.rowId) ?? { status: order.status, title: order.title, os: [] };
        entry.os.push(osValue);
        byRow.set(order.rowId, entry);
      }
    }
    const previous = lastOrdersRef.current;
    lastOrdersRef.current = { pageId, subPageId, byRow };
    if (!previous || previous.pageId !== pageId || previous.subPageId !== subPageId) return;

    const linesByOs = new Map<string, string[]>();
    for (const [rowId, now] of byRow) {
      const before = previous.byRow.get(rowId);
      if (!before || before.status === now.status) continue;
      const line = `«${now.title || "Без названия"}»: ${statusLabel(before.status)} → ${statusLabel(now.status)}`;
      for (const os of now.os) {
        if (!before.os.includes(os)) continue;
        const lines = linesByOs.get(os) ?? [];
        lines.push(line);
        linesByOs.set(os, lines);
      }
    }
    for (const [osValue, lines] of linesByOs) {
      const targets = membersRef.current
        .filter((m) => m.status === "active" && m.osNickValue === osValue && m.uid && m.uid !== uid)
        .map((m) => m.uid);
      if (targets.length === 0) continue;
      sendNotification(
        {
          workspaceId,
          title: lines.length === 1 ? `Статус вашего заказа · ${pageName}` : `${lines.length} заказа сменили статус · ${pageName}`,
          body: lines.slice(0, 6).join("\n") + (lines.length > 6 ? `\n…и ещё ${lines.length - 6}` : ""),
          priority: "normal",
          fromUid: uid,
          fromName,
          target: "selected",
          selectedUids: targets,
          pageId,
          href: "/technicians",
        },
        targets
      ).catch((error) => console.warn("Не удалось уведомить ОС о смене статуса:", error));
    }
  }
}
