import { useEffect, useMemo, useRef } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { usePermissions } from "@/hooks/usePermissions";
import { useRowsBackend } from "@/hooks/useRowsBackend";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { fetchDeskObservers } from "@/services/deskObserverService";
import {
  desiredMemberRows,
  desiredPageRow,
  noteAclSync,
  syncRowAcl,
} from "@/services/rows/rowAclService";

/** Пауза после последнего изменения: правка доступа — это обычно серия щелчков. */
const DEBOUNCE_MS = 1500;

/**
 * Держит копию прав в Supabase равной Firestore, пока строки живут там.
 *
 * Участники и столы и так живые в памяти у каждой сессии, поэтому сверка не
 * стоит ни одного чтения Firestore — кроме списка наблюдателей у Owner, один
 * раз за сессию. Сверка запускается на ИЗМЕНЕНИЕ прав (подпись ниже), а не на
 * каждый снимок столов: документ стола меняется и от ширины столбца.
 */
export function useRowAclSync() {
  const { activeWorkspace, members, allPages } = useWorkspace();
  const permissions = usePermissions();
  const workspaceId = activeWorkspace?.id ?? null;
  const backend = useRowsBackend(workspaceId);
  const rosterWorkspaceId = useWorkspaceStore((s) => s.rosterWorkspaceId);
  const rosterComplete = Boolean(workspaceId && rosterWorkspaceId === workspaceId);
  const realRole = permissions.realRole;
  const me = permissions.uid ?? "";
  const ownerId = activeWorkspace?.ownerId ?? "";
  const management = realRole === "owner" || realRole === "teamlead";
  const observersRef = useRef<{ workspaceId: string; uids: string[] } | null>(null);

  // Подпись того, что сверяем: при её смене — сверка.
  const signature = useMemo(() => {
    if (!workspaceId || backend !== "supabase" || !permissions.isResolved || !me) return "";
    // Admin смотрит все столы: он переназначает ответственного и у чужих.
    const pageSig = allPages
      .filter((p) => management || realRole === "admin" || p.responsibleUserId === me)
      .map((p) => JSON.stringify(desiredPageRow(p)))
      .sort()
      .join("|");
    const memberSig = management
      ? desiredMemberRows(members)
          .map((m) => `${m.uid}:${m.role}:${m.extra_roles.join(",")}`)
          .sort()
          .join("|")
      : "";
    return `${workspaceId}#${realRole}#${rosterComplete ? 1 : 0}#${memberSig}#${pageSig}`;
  }, [workspaceId, backend, permissions.isResolved, me, management, realRole, rosterComplete, members, allPages]);

  const latest = useRef({ members, allPages, rosterComplete, ownerId, realRole, me });
  latest.current = { members, allPages, rosterComplete, ownerId, realRole, me };

  useEffect(() => {
    if (!signature || !workspaceId) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        const ctx = latest.current;
        try {
          let observers: string[] | null = null;
          if (ctx.realRole === "owner") {
            if (observersRef.current?.workspaceId !== workspaceId) {
              const list = await fetchDeskObservers(workspaceId);
              observersRef.current = { workspaceId, uids: list.map((o) => o.uid) };
            }
            observers = observersRef.current.uids;
          }
          const report = await syncRowAcl({
            workspaceId,
            ownerId: ctx.ownerId,
            me: ctx.me,
            realRole: ctx.realRole,
            members: ctx.members,
            rosterComplete: ctx.rosterComplete,
            pages: ctx.allPages,
            observers,
          });
          if (cancelled) return;
          noteAclSync({ at: Date.now(), ok: report.errors.length === 0, report, error: null });
          if (report.errors.length) console.warn("[rows-acl] сверка прав с ошибками", report.errors);
        } catch (error) {
          if (cancelled) return;
          const message = error instanceof Error ? error.message : String(error);
          noteAclSync({ at: Date.now(), ok: false, report: null, error: message });
          console.warn("[rows-acl] сверка прав не прошла", error);
        }
      })();
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [signature, workspaceId]);
}
