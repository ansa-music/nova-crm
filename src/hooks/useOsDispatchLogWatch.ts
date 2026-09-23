import { useEffect } from "react";
import { useNavigate } from "react-router";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { OS_DISPATCH_KIND_LABELS, watchOsDispatchLog, type OsDispatchLogEntry } from "@/services/osDispatchLogService";
import { hasFullAccess } from "@/utils/permissions";

/** Руководство может ЗНАТЬ о выдаче только когда она правда новая. */
const FRESH_MS = 2 * 60_000;

/** Кому пункт «Выдачи ОС» и его подписка: Owner и Тимлид — «от Тимлида и выше». */
export function useCanSeeOsDispatchLog(): boolean {
  const permissions = usePermissions();
  return permissions.isResolved && hasFullAccess(permissions.role);
}

export function describeOsDispatch(entry: OsDispatchLogEntry): string {
  const verb = OS_DISPATCH_KIND_LABELS[entry.kind];
  if (entry.kind === "unassign") return `${entry.osName} ${verb} заказ у ${entry.prevTechName ?? "технаря"}`;
  if (entry.kind === "move") return `${entry.osName} ${verb} заказ: ${entry.prevTechName ?? "—"} → ${entry.techName}`;
  return `${entry.osName} ${verb} заказ технарю ${entry.techName}`;
}

/**
 * Одна подписка на журнал «Выдачи ОС» на всё приложение — только у Owner и
 * Тимлида. Кормит счётчик в меню, саму вкладку и тост о новой выдаче (он
 * нужен: в полноэкранной таблице меню не видно).
 */
export function useOsDispatchLogWatch() {
  const { activeWorkspaceId } = useWorkspace();
  const { profile } = useAuth();
  const canSee = useCanSeeOsDispatchLog();
  const navigate = useNavigate();
  const uid = profile?.uid ?? null;

  useEffect(() => {
    if (!canSee || !activeWorkspaceId || !uid) return watchOsDispatchLog(null, null);
    return watchOsDispatchLog(activeWorkspaceId, uid, (fresh) => {
      const now = Date.now();
      const recent = fresh.filter((e) => now - e.createdAt < FRESH_MS && e.osUid !== uid);
      if (!recent.length) return;
      const first = recent[0];
      toast(recent.length === 1 ? "Выдача ОС" : `Выдачи ОС: ${recent.length}`, {
        description: recent.length === 1 ? `${describeOsDispatch(first)} · ${first.client}` : describeOsDispatch(first),
        action: { label: "Открыть", onClick: () => navigate("/os-dispatch") },
      });
    });
  }, [canSee, activeWorkspaceId, uid, navigate]);
}
