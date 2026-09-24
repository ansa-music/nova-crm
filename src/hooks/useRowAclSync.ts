import { useEffect, useMemo, useRef } from "react";
import { reconcileSupabaseOsExempt } from "@/services/rows/osExempt";
import { useWorkspace } from "@/hooks/useWorkspace";
import { usePermissions } from "@/hooks/usePermissions";
import { useRowsBackend } from "@/hooks/useRowsBackend";
import { fetchDeskObserverUidsFresh } from "@/services/deskObserverService";
import { fetchMembersFresh } from "@/services/memberService";
import { desiredPageRow, noteAclSync, syncRowAcl, type AclSyncInput } from "@/services/rows/rowAclService";
import { reconcileSupabaseLive, reconcileSupabaseOsManaged } from "@/services/rows/rowsMigrationService";
import type { Role } from "@/types";

/** Пауза после последнего изменения: правка доступа — это обычно серия щелчков. */
const DEBOUNCE_MS = 1500;
/**
 * Участники и наблюдатели сверяются по СВЕЖЕМУ чтению с сервера — при
 * загрузке и потом не чаще этого (~40 чтений Firestore за раз). Мгновенные
 * изменения (роль, одобрение, «убрать», наблюдатель) действие само пишет в
 * копию; сверка — страховка, а не основной путь.
 *
 * 25, а не 30 минут: свежее чтение идёт через resume-токен
 * (`getDocsResumable`), а он живёт ~30 минут. Ровно 30 почти всегда
 * промахивались мимо него, и сервер брал за весь ростер. С пульсом
 * присутствия в Supabase member-документы почти не меняются, и чтение в
 * живой токен стоит единицы документов.
 */
const MEMBERS_EVERY_MS = 25 * 60 * 1000;

/**
 * Держит копию прав в Supabase равной Firestore, пока строки живут там.
 *
 * Столы — по живой подписке (она и так есть у каждой сессии): сверка идёт на
 * ИЗМЕНЕНИЕ прав столов (подпись ниже), а не на каждый снимок — документ
 * стола меняется и от ширины столбца. Участники и наблюдатели — только по
 * свежему чтению с сервера (см. MEMBERS_EVERY_MS): ростер, прочитанный при
 * загрузке вкладки, через час врёт, и сверка по нему вернула бы права
 * убранному человеку.
 */
export function useRowAclSync() {
  const { activeWorkspace, allPages } = useWorkspace();
  const permissions = usePermissions();
  const workspaceId = activeWorkspace?.id ?? null;
  const backend = useRowsBackend(workspaceId);
  const realRole = permissions.realRole;
  const me = permissions.uid ?? "";
  const ownerId = activeWorkspace?.ownerId ?? "";
  const management = realRole === "owner" || realRole === "teamlead";
  const active = Boolean(workspaceId && backend === "supabase" && permissions.isResolved && me);

  // Подпись прав столов: при её смене — сверка столов.
  const pageSignature = useMemo(() => {
    if (!active) return "";
    return allPages
      // Admin смотрит все столы: он переназначает ответственного и у чужих.
      .filter((p) => management || realRole === "admin" || p.responsibleUserId === me)
      .map((p) => JSON.stringify(desiredPageRow(p)))
      .sort()
      .join("|");
  }, [active, allPages, management, realRole, me]);

  const osManaged = Boolean(activeWorkspace?.osManagedDesks);
  const latest = useRef({ allPages, ownerId, realRole, me, osManaged });
  latest.current = { allPages, ownerId, realRole, me, osManaged };

  const run = useRef(async (wsId: string, withMembers: boolean) => {
    const ctx = latest.current;
    try {
      let members: AclSyncInput["members"] = null;
      let observers: string[] | null = null;
      if (withMembers && (ctx.realRole === "owner" || ctx.realRole === "teamlead")) {
        members = await fetchMembersFresh(wsId);
        if (ctx.realRole === "owner") {
          observers = await fetchDeskObserverUidsFresh(wsId);
          if (await reconcileSupabaseLive(wsId).catch(() => false)) {
            console.warn("[rows] хранилище Supabase было заперто без переноса — открыто");
          }
          // Флаг «заказы ведёт ОС» мог остаться только в Firestore — например
          // его включили до того, как накатили SQL. Молчащий замок хуже
          // отсутствующего: технарь думает, что статус закрыт, а он открыт.
          if (await reconcileSupabaseOsManaged(wsId, ctx.osManaged).catch(() => false)) {
            console.warn("[rows] флаг «заказы ведёт ОС» в Supabase догнал Firestore");
          }
          // Столы, где технарь правит сам (page.techEditable), — та же сверка.
          const exemptFixed = await reconcileSupabaseOsExempt(wsId, ctx.allPages).catch(() => null);
          if (exemptFixed) console.warn(`[rows] исключения «правит сам» в Supabase догнали Firestore: ${exemptFixed}`);
        }
      }
      const report = await syncRowAcl({
        workspaceId: wsId,
        ownerId: ctx.ownerId,
        me: ctx.me,
        realRole: ctx.realRole as Role,
        members,
        pages: ctx.allPages,
        observers,
      });
      noteAclSync({ at: Date.now(), ok: report.errors.length === 0, report, error: null });
      if (report.errors.length) console.warn("[rows-acl] сверка прав с ошибками", report.errors);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      noteAclSync({ at: Date.now(), ok: false, report: null, error: message });
      console.warn("[rows-acl] сверка прав не прошла", error);
    }
  });

  // Столы — на изменение прав.
  useEffect(() => {
    if (!active || !workspaceId || !pageSignature) return;
    const timer = window.setTimeout(() => void run.current(workspaceId, false), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [active, workspaceId, pageSignature]);

  // Участники и наблюдатели — свежим чтением: при загрузке и раз в 25 минут.
  useEffect(() => {
    if (!active || !workspaceId || !management) return;
    const first = window.setTimeout(() => void run.current(workspaceId, true), DEBOUNCE_MS);
    const every = window.setInterval(() => {
      if (document.visibilityState === "visible") void run.current(workspaceId, true);
    }, MEMBERS_EVERY_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
    };
  }, [active, workspaceId, management]);
}
