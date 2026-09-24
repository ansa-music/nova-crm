import { useEffect, useRef } from "react";
import { toast } from "@/components/ui/sonner";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { currentMonthKey } from "@/services/monthTabService";
import { sendNotification } from "@/services/notificationService";
import { osDeskId } from "@/services/osDeskService";
import { openOsDeskCurrentTab, type OsDeskTab } from "@/services/rows/osDeskIssue";
import { buildClaimSource } from "@/services/rows/osOrderAdoption";
import {
  CLAIM_MAX_PER_RUN,
  ClaimUnsupportedError,
  nudgeOpenDesk,
  OS_CLAIM_KICK_EVENT,
  OS_CLAIMED_EVENT,
  pickClaims,
  sbClaimOsOrder,
  sbFetchOsClaimable,
  sbFetchReturnedSources,
  type ClaimPick,
  type ClaimSeenMemory,
} from "@/services/rows/osOrderClaim";
import { putPageAcl } from "@/services/rows/rowAclService";
import { usesSupabaseRows } from "@/services/rows/rowsBackend";
import { deskRowHref } from "@/utils/deskLinks";
import { personLabel } from "@/utils/peopleDesks";
import type { WorkspaceMember, WorkspacePage } from "@/types";

/**
 * Сессия ОС сама забирает к себе на стол заказы, которые технари (и любой, у
 * кого есть стол) записали с её ником в столбце ОС (жалоба Nurba 24.09.2026).
 * Как и зачем — в `services/rows/osOrderClaim.ts`.
 *
 * Когда спрашиваем базу (один крошечный запрос, обычно пустой ответ):
 * - через ~3 с после того, как столы и участники загрузились;
 * - дальше раз в 2 минуты, пока вкладка на виду;
 * - при возврате на вкладку (не чаще раза в минуту);
 * - когда ОС открыл свой стол (`OS_CLAIM_KICK_EVENT`).
 * Один заход за раз, а между вкладками одного браузера — «аренда» в
 * localStorage: две вкладки не спрашивают базу одновременно (а если и
 * спросят, база ответит второй «уже взят»).
 *
 * Строка забирается, только когда «отлежалась» 3 минуты (`CLAIM_QUIET_MS`):
 * после забора она у технаря под замком, и ловить её посреди набора нельзя.
 */
const FIRST_RUN_MS = 3_000;
const EVERY_MS = 120_000;
const ON_RETURN_MIN_GAP_MS = 60_000;
const KICK_MIN_GAP_MS = 10_000;
const LEASE_MS = 90_000;
/** SQL не вставлен — спросим снова через столько. */
const UNSUPPORTED_RECHECK_MS = 10 * 60_000;
/** Вкладка месяца стола ОС читается из Firestore — держим её 5 минут. */
const OS_TAB_TTL_MS = 5 * 60_000;

let unsupportedAt = 0;
let toldNoNick = false;
const TAB_ID = Math.random().toString(36).slice(2);

/** Для проверок: забыть «функции нет» и «уже сказали». */
export function resetOsClaimMemory() {
  unsupportedAt = 0;
  toldNoNick = false;
}

function claimsUnsupported(now: number): boolean {
  return unsupportedAt > 0 && now - unsupportedAt < UNSUPPORTED_RECHECK_MS;
}

/**
 * Свободна ли «аренда» заходов для этой вкладки: запись `вкладка@до` чужой
 * вкладки, срок которой не вышел, — занята.
 */
export function claimLeaseFree(raw: string | null, tabId: string, now: number): boolean {
  if (!raw) return true;
  const at = raw.lastIndexOf("@");
  const owner = at > 0 ? raw.slice(0, at) : "";
  const until = Number(raw.slice(at + 1));
  return owner === tabId || !Number.isFinite(until) || until <= now;
}

function takeLease(key: string, now: number): boolean {
  try {
    if (!claimLeaseFree(window.localStorage.getItem(key), TAB_ID, now)) return false;
    window.localStorage.setItem(key, `${TAB_ID}@${now + LEASE_MS}`);
  } catch {
    // Без localStorage — заходы только в пределах вкладки.
  }
  return true;
}

export interface OsClaimContext {
  workspaceId: string;
  uid: string;
  osNickValue: string;
  /** Подпись ОС — в уведомление технарю и имя нового стола. */
  osName: string;
  /** Все столы, включая столы ОС. */
  pages: readonly WorkspacePage[];
  members: readonly WorkspaceMember[];
  seen: ClaimSeenMemory;
  osTabCache: { current: { monthKey: string; at: number; tab: OsDeskTab } | null };
}

export interface OsClaimPassResult {
  claimed: number;
  /** Когда зайти снова (мс): строка ещё «отлёживается» или остались отложенные. */
  waitMs: number | null;
}

async function osTabFor(ctx: OsClaimContext, monthKey: string, now: number): Promise<OsDeskTab> {
  const cached = ctx.osTabCache.current;
  if (cached && cached.monthKey === monthKey && now - cached.at < OS_TAB_TTL_MS) return cached.tab;
  const tab = await openOsDeskCurrentTab({
    workspaceId: ctx.workspaceId,
    uid: ctx.uid,
    name: ctx.osName,
    osDesks: ctx.pages.filter((p) => p.osDesk),
    createIfMissing: true,
  });
  if (!tab) throw new Error("Стол ОС не открылся");
  ctx.osTabCache.current = { monthKey, at: now, tab };
  return tab;
}

function cellOf(row: ClaimPick["candidate"]["row"], key: string | undefined): string {
  if (!key) return "";
  const value = row.cells[key];
  return value === null || value === undefined ? "" : String(value).trim();
}

/**
 * Один заход: спросить базу, отобрать годные строки, забрать (не больше
 * `CLAIM_MAX_PER_RUN`), сказать ОС и технарям. `ClaimUnsupportedError` —
 * наружу (SQL не вставлен).
 */
export async function runOsClaimPass(ctx: OsClaimContext): Promise<OsClaimPassResult> {
  const candidates = await sbFetchOsClaimable(ctx.workspaceId);
  if (candidates.length === 0) {
    ctx.seen.clear();
    return { claimed: 0, waitMs: null };
  }
  const monthKey = currentMonthKey();
  const now = Date.now();
  const base = { candidates, pages: ctx.pages, members: ctx.members, monthKey, now, seen: ctx.seen };
  let pick = pickClaims({ ...base, limit: Number.POSITIVE_INFINITY });
  if (pick.ready.length === 0) return { claimed: 0, waitMs: pick.waitMs };
  // Заказы, которые Owner вернул технарю, — не забираем снова (см. sbFetchReturnedSources).
  const returned = await sbFetchReturnedSources(
    ctx.workspaceId,
    osDeskId(ctx.uid),
    pick.ready.map((p) => p.srcId)
  );
  pick = pickClaims({ ...base, returned, limit: CLAIM_MAX_PER_RUN });
  if (pick.deferred > 0) {
    console.info(`[os-claim] заказов с вашим ником больше ${CLAIM_MAX_PER_RUN} — ещё ${pick.deferred} заберу следующим заходом`);
  }
  if (pick.ready.length === 0) return { claimed: 0, waitMs: pick.waitMs };

  const osTab = await osTabFor(ctx, monthKey, now);
  const claimed: ClaimPick[] = [];
  for (const p of pick.ready) {
    const src = buildClaimSource({
      techRow: p.candidate.row,
      techKeys: p.techKeys,
      osKeys: osTab.keys,
      osNickValue: ctx.osNickValue,
      techNick: p.techNick,
    });
    let status: string;
    try {
      status = (
        await sbClaimOsOrder({
          workspaceId: ctx.workspaceId,
          pageId: p.candidate.pageId,
          tabId: p.candidate.tabId,
          rowId: p.candidate.row.id,
          expectRev: p.candidate.rev,
          srcTabId: osTab.tabId,
          cells: src.cells,
          extras: src.extras,
          syncHash: src.syncHash,
          orderAt: src.orderAt,
          srcStatusKey: osTab.keys.status,
        })
      ).status;
    } catch (error) {
      if (error instanceof ClaimUnsupportedError) throw error;
      console.warn("[os-claim] заказ не забрался", p.candidate.row.id, error);
      continue;
    }
    if (status === "claimed") {
      claimed.push(p);
      continue;
    }
    if (status === "no_os_desk") {
      // Записи о своём столе ОС в копии прав ещё нет — заводим, забор — в следующий заход.
      await putPageAcl(ctx.workspaceId, osTab.page).catch(() => undefined);
      ctx.osTabCache.current = null;
      break;
    }
    if (status === "no_nick") {
      if (!toldNoNick) {
        toldNoNick = true;
        toast.info("Ваш ник ОС ещё не дошёл до базы строк", {
          description: "Заказы технарей с вашим ником приедут на стол, когда Owner или Тимлид откроют приложение.",
        });
      }
      break;
    }
    // stale / taken / gone / already / not_mine / released / … — строка
    // поменялась, уже чья-то или её вернул технарю Owner: спросим в следующий
    // заход (released база больше не отдаст — фильтр выше тот же).
  }

  if (claimed.length > 0) {
    nudgeOpenDesk(ctx.workspaceId, osTab.page.id, osTab.tabId);
    window.dispatchEvent(new CustomEvent(OS_CLAIMED_EVENT, { detail: { count: claimed.length } }));
    const techName = (p: ClaimPick) => personLabel(ctx.members.find((m) => m.uid === p.techUid)) || p.techNick;
    if (claimed.length === 1) {
      const p = claimed[0];
      const client = cellOf(p.candidate.row, p.techKeys.client);
      toast.success(`Заказ «${client}» от технаря ${techName(p)} — на вашем столе`, {
        description: "Дальше статус и поля ведёте вы.",
      });
    } else {
      toast.success(`На ваш стол пришли заказы технарей: ${claimed.length}`, {
        description: "Дальше статус и поля ведёте вы.",
      });
    }
    await notifyTechs(ctx, claimed);
  }
  return { claimed: claimed.length, waitMs: pick.deferred > 0 ? 5_000 : pick.waitMs };
}

/**
 * Технарю — ОДНО уведомление на заход (сколько бы его строк ни забрали):
 * строка у него только что закрылась замком, и без объяснения это похоже на
 * поломку. Не ушло — не страшно, заказ уже на месте.
 */
async function notifyTechs(ctx: OsClaimContext, claimed: readonly ClaimPick[]): Promise<void> {
  const byTech = new Map<string, ClaimPick[]>();
  for (const p of claimed) byTech.set(p.techUid, [...(byTech.get(p.techUid) ?? []), p]);
  for (const [techUid, list] of byTech) {
    const first = list[0];
    const client = cellOf(first.candidate.row, first.techKeys.client);
    const more = list.length > 1 ? ` и ещё ${list.length - 1}` : "";
    await sendNotification(
      {
        workspaceId: ctx.workspaceId,
        title: `Заказ ведёт ОС: ${client}${more}`,
        body:
          list.length > 1
            ? `ОС ${ctx.osName} взял заказы себе на стол — статус и поля теперь ведёт он`
            : `ОС ${ctx.osName} взял заказ себе на стол — статус и поля теперь ведёт он`,
        priority: "normal",
        fromUid: ctx.uid,
        fromName: ctx.osName,
        target: "selected",
        selectedUids: [techUid],
        pageId: first.page.id,
        href: deskRowHref(first.page.id, first.candidate.tabId || null, first.candidate.row.id),
      },
      [techUid]
    ).catch(() => undefined);
  }
}

export function useOsOrderClaims() {
  const permissions = usePermissions();
  const { activeWorkspaceId, allPages, members, membersLoadState } = useWorkspace();
  const uid = permissions.uid ?? "";
  const me = members.find((m) => m.uid === uid);
  const osNickValue = me?.osNickValue ?? "";
  const osName = personLabel(me) || osNickValue;
  const enabled = Boolean(
    activeWorkspaceId &&
      uid &&
      permissions.isResolved &&
      permissions.hasRole("os") &&
      osNickValue &&
      usesSupabaseRows(activeWorkspaceId)
  );
  // Столы и участники загрузились — без них годную строку не отличить от чужой.
  const ready = enabled && allPages.length > 0 && members.length > 0 && membersLoadState === "ready";
  const latest = useRef({ pages: allPages, members, osNickValue, osName });
  latest.current = { pages: allPages, members, osNickValue, osName };

  useEffect(() => {
    if (!ready || !activeWorkspaceId || !uid) return;
    const workspaceId = activeWorkspaceId;
    const leaseKey = `nova:os-claim-lease:${workspaceId}:${uid}`;
    const seen: ClaimSeenMemory = new Map();
    const osTabCache: OsClaimContext["osTabCache"] = { current: null };
    let disposed = false;
    let running = false;
    let lastRunAt = 0;
    let waitTimer: number | null = null;

    const schedule = (ms: number) => {
      if (waitTimer !== null) window.clearTimeout(waitTimer);
      waitTimer = window.setTimeout(() => {
        waitTimer = null;
        void run();
      }, Math.min(EVERY_MS, Math.max(5_000, ms)));
    };

    async function run() {
      if (disposed || running) return;
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (claimsUnsupported(now)) return;
      if (!takeLease(leaseKey, now)) return;
      running = true;
      lastRunAt = now;
      try {
        const cur = latest.current;
        const result = await runOsClaimPass({
          workspaceId,
          uid,
          osNickValue: cur.osNickValue,
          osName: cur.osName,
          pages: cur.pages,
          members: cur.members,
          seen,
          osTabCache,
        });
        unsupportedAt = 0;
        if (!disposed && result.waitMs !== null) schedule(result.waitMs + 1_000);
      } catch (error) {
        if (error instanceof ClaimUnsupportedError) {
          // SQL 20261002 не вставлен — молча ждём 10 минут.
          unsupportedAt = Date.now();
        } else {
          console.warn("[os-claim] заход не удался", error);
        }
      } finally {
        running = false;
      }
    }

    const first = window.setTimeout(() => void run(), FIRST_RUN_MS);
    const every = window.setInterval(() => void run(), EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastRunAt >= ON_RETURN_MIN_GAP_MS) void run();
    };
    const onKick = () => {
      if (Date.now() - lastRunAt >= KICK_MIN_GAP_MS) void run();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(OS_CLAIM_KICK_EVENT, onKick);
    return () => {
      disposed = true;
      window.clearTimeout(first);
      window.clearInterval(every);
      if (waitTimer !== null) window.clearTimeout(waitTimer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(OS_CLAIM_KICK_EVENT, onKick);
    };
  }, [ready, activeWorkspaceId, uid]);
}
