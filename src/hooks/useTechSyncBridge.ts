import { useEffect, useMemo, useRef } from "react";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useRowsBackend } from "@/hooks/useRowsBackend";
import { useWorkspace } from "@/hooks/useWorkspace";
import { ensureMonthTabDocById, monthTabColumnsFor } from "@/services/monthTabService";
import { sendNotification } from "@/services/notificationService";
import { ringRowsDoorbell } from "@/services/rows/rowsDoorbell";
import { usesSupabaseRows } from "@/services/rows/rowsBackend";
import { onOwnRowWrite, type OwnRowWrite } from "@/services/rows/supabaseRowStore";
import {
  enqueueTechSync,
  fetchTechSyncState,
  onTechSyncLinked,
  sbSetTechSync,
  techSyncActive,
  techSyncDeskRows,
  useTechSyncState,
  type TechSyncLinkedEvent,
  type TechSyncState,
} from "@/services/rows/techSync";
import { fetchSubPages } from "@/services/subPageService";
import { useSiteConfig } from "@/config/siteTerms";
import { isModuleEnabled } from "@/types/siteConfig";
import { deskRowHref } from "@/utils/deskLinks";
import { myDisplayName } from "@/utils/displayName";
import { personLabel } from "@/utils/peopleDesks";
import { periodOfTabId } from "@/utils/periods";
import {
  compareOsDeskKeys,
  techDeskKey,
  techEditTouchesOs,
  techFillsDesk,
  techKeysFor,
  techRowLinked,
  techStatusKeyOf,
} from "@/utils/techSyncPlan";
import type { PageColumn, SubPage, WorkspaceMember, WorkspacePage } from "@/types";

/**
 * Авто-передача ОС — мост «свои правки строк → очередь» и обслуживание Owner.
 * Стоит один раз в `AppLayout`, а не в столе: строку технаря пишут и мимо
 * открытого стола (заезд заказа с «Заказов», карточка строки с другого
 * экрана, «Общая таблица»), и всё это должно доехать до ОС.
 *
 * 1. Своя удачная запись строки (`onOwnRowWrite`) в стол «Заполняет сам»,
 *    который этот человек вправе править:
 *    - у ведомой ОС строки поменяли ТОЛЬКО статус — статус уже увёз триггер
 *      базы той же записью, столу ОС хватит звонка; строка уходит на проверку
 *      с ближайшим вызовом (или через 20 с);
 *    - всё остальное — в очередь `rows_tech_sync` (один вызов на серию).
 * 2. Заказ лёг на стол ОС — этому ОС уведомление, не чаще раза в 2 минуты.
 * 3. Сессия Owner (по НАСТОЯЩЕЙ роли): первое включение после самопроверки
 *    «сайт и база одинаково читают столбцы столов ОС», выключение, если они
 *    разошлись, и документы вкладок, куда база уже положила заказы.
 *
 * В остальных режимах («Заказы ведёт ОС», «Смешанный» без переключателя у
 * стола) хук ничего не слушает и ничего не спрашивает.
 */

/** Самопроверка Owner — через столько после входа и дальше раз в полчаса на виду. */
const UPKEEP_FIRST_MS = 6_000;
const UPKEEP_EVERY_MS = 30 * 60_000;
/** Ключи столов ОС разошлись — перепроверить через столько, прежде чем что-то решать. */
const UPKEEP_CONFIRM_MS = 30_000;
/** Уведомление ОС о новом заказе от технаря — не чаще раза в столько на браузер. */
const NOTIFY_GAP_MS = 2 * 60_000;

// ---------------------------------------------------------------------------
// 1. Свои правки строк.
// ---------------------------------------------------------------------------

export interface OwnWriteRouteContext {
  /** Все столы workspace. */
  pages: readonly WorkspacePage[];
  workspace: { techFillsAll?: boolean } | null | undefined;
  /** Вправе ли человек править строки этого стола. */
  canEdit: (page: WorkspacePage) => boolean;
}

export type OwnWriteRoute = "ignore" | "ring" | "enqueue";

/**
 * Что сделать со своей записью строки (состояние функции уже проверено):
 * `ignore` — стол не «Заполняет сам» или не наш; `ring` — только статус ведомой
 * ОС строки: звонок столу ОС сразу, строка — на проверку; `enqueue` — в очередь.
 */
export function routeOwnRowWrite(event: OwnRowWrite, ctx: OwnWriteRouteContext): OwnWriteRoute {
  const page = ctx.pages.find((p) => p.id === event.pageId);
  if (!page || !techFillsDesk(page, ctx.workspace) || !ctx.canEdit(page)) return "ignore";
  // Стол открыт — строки известны, и про ведомые ОС строки можно решить сразу.
  const rows = techSyncDeskRows(techDeskKey(event.workspaceId, event.pageId, event.tab));
  if (rows) {
    const keys = techKeysFor(page, event.tab);
    const touched = event.rowIds.map((id) => rows.find((r) => r.id === id));
    if (touched.every((row) => row && techRowLinked(row))) {
      const linked = touched as typeof rows;
      // Правка не про ОС (своя ссылка, примечание, дата) — слать нечего.
      if (!linked.some((row) => techEditTouchesOs(row, keys, event.cellKeys, event.extras))) return "ignore";
      const row = linked.length === 1 ? linked[0] : null;
      if (row?.srcPageId && event.cellKeys.length === 1 && !event.extras && event.cellKeys[0] === techStatusKeyOf(row, keys)) {
        ringRowsDoorbell(event.workspaceId, row.srcPageId, row.srcTabId ?? "");
        // Проверка: триггер мог не дождаться занятого источника — тогда статус
        // допишет сам вызов (и позвонит столу ОС ещё раз, уже по делу).
        enqueueTechSync(event.workspaceId, event.pageId, event.tab, [row.id], { lazy: true });
        return "ring";
      }
    }
  }
  enqueueTechSync(event.workspaceId, event.pageId, event.tab, event.rowIds);
  return "enqueue";
}

/**
 * Своя запись строки → решение. Сначала дешёвые отказы (не тот стол, нет
 * прав), потом состояние функции: свежее отдаётся без запроса, несвежее —
 * один `rows_tech_sync_state` (не чаще раза в 5 минут).
 */
export async function handleOwnRowWrite(event: OwnRowWrite, ctx: OwnWriteRouteContext): Promise<OwnWriteRoute> {
  if (!usesSupabaseRows(event.workspaceId)) return "ignore";
  const page = ctx.pages.find((p) => p.id === event.pageId);
  if (!page || !techFillsDesk(page, ctx.workspace) || !ctx.canEdit(page)) return "ignore";
  const state = await fetchTechSyncState(event.workspaceId);
  if (!techSyncActive(state)) return "ignore";
  return routeOwnRowWrite(event, ctx);
}

// ---------------------------------------------------------------------------
// 2. Уведомление ОС о новом заказе.
// ---------------------------------------------------------------------------

function notifyAllowed(workspaceId: string, osUid: string, now: number): boolean {
  const key = `nova:tech-sync-notified:${workspaceId}:${osUid}`;
  try {
    const last = Number(window.localStorage.getItem(key)) || 0;
    if (now - last < NOTIFY_GAP_MS) return false;
    window.localStorage.setItem(key, String(now));
  } catch {
    /* без localStorage — уведомляем: лишнее уведомление лучше потерянного */
  }
  return true;
}

export interface LinkedNotifyContext {
  uid: string;
  fromName: string;
  pages: readonly WorkspacePage[];
  members: readonly WorkspaceMember[];
}

/** «Новый заказ от технаря {ник}: {клиент}» — каждому ОС, чьи заказы только что легли, одно на серию. */
export async function notifyOsAboutLinked(event: TechSyncLinkedEvent, ctx: LinkedNotifyContext): Promise<number> {
  const page = ctx.pages.find((p) => p.id === event.pageId);
  const tech = page?.responsibleUserId ? ctx.members.find((m) => m.uid === page.responsibleUserId) : undefined;
  const techNick = tech?.techNick || personLabel(tech) || ctx.fromName;
  const clientKey = techKeysFor(page, event.tab)?.client;
  const rows = techSyncDeskRows(techDeskKey(event.workspaceId, event.pageId, event.tab));
  const byOs = new Map<string, TechSyncLinkedEvent["items"]>();
  for (const item of event.items) {
    if (!item.osUid || item.osUid === ctx.uid) continue;
    byOs.set(item.osUid, [...(byOs.get(item.osUid) ?? []), item]);
  }
  let sent = 0;
  const now = Date.now();
  for (const [osUid, list] of byOs) {
    if (!notifyAllowed(event.workspaceId, osUid, now)) continue;
    const first = list[0];
    const row = rows?.find((r) => r.id === first.row);
    const client = row && clientKey ? String(row.cells[clientKey] ?? "").trim() : "";
    await sendNotification(
      {
        workspaceId: event.workspaceId,
        title: `Новый заказ от технаря ${techNick}${client ? `: ${client}` : ""}`,
        body: list.length > 1 ? `и ещё ${list.length - 1} — заказы уже на вашем столе` : "Заказ уже на вашем столе",
        priority: "normal",
        fromUid: ctx.uid,
        fromName: ctx.fromName,
        target: "selected",
        selectedUids: [osUid],
        pageId: first.srcPage ?? null,
        href: first.srcPage && first.srcRow ? deskRowHref(first.srcPage, first.srcTab || null, first.srcRow) : null,
      },
      [osUid]
    ).catch(() => undefined);
    sent += 1;
  }
  return sent;
}

// ---------------------------------------------------------------------------
// 3. Обслуживание Owner: включение после самопроверки, вкладки стола ОС.
// ---------------------------------------------------------------------------

export type TechSyncUpkeepOutcome =
  /** Функций в базе нет / ядро не в Supabase / Owner выключил — делать нечего. */
  | "unsupported"
  | "no_core"
  | "off"
  /** База не прислала столы ОС или стол не найден на сайте — проверить нечем, ничего не меняем. */
  | "unverified"
  /** Сайт и база читают столбцы по-разному: не включили (или ждём второго захода, чтобы выключить). */
  | "mismatch"
  /** Расхождение подтвердилось вторым заходом — выключили уже работавшую. */
  | "switched_off"
  | "activated"
  | "ok";

export interface TechSyncUpkeepContext {
  workspaceId: string;
  /** Все столы ОС workspace. */
  osDesks: readonly WorkspacePage[];
  /** Для проверок: подмена чтения вкладок и заведения документа вкладки. */
  loadSubPages?: (pageId: string) => Promise<SubPage[]>;
  ensureTab?: (page: WorkspacePage, periodKey: string) => Promise<void>;
}

export interface TechSyncUpkeepResult {
  outcome: TechSyncUpkeepOutcome;
  /** Где разошлись ключи: стол, вкладка, роли столбцов. */
  mismatches: { page: string; tab: string; keys: string[] }[];
  /** Сколько документов вкладок попросили завести. */
  tabs: number;
}

const toldUpkeep = new Set<string>();
/** Расхождение ключей, увиденное в прошлый заход (по workspace) — см. ниже про два захода. */
const seenMismatch = new Map<string, string>();

function tellOnce(key: string, title: string, description: string) {
  if (toldUpkeep.has(key)) return;
  toldUpkeep.add(key);
  toast.warning(title, { description, duration: 15_000 });
}

/** Для проверок: забыть «уже сказали» и прошлое расхождение. */
export function resetTechSyncUpkeepMemory() {
  toldUpkeep.clear();
  seenMismatch.clear();
}

/**
 * Один заход Owner:
 * - авто-передачу ещё не включали (`on === null`), ядро в Supabase — сверить
 *   ключи КАЖДОГО стола ОС (`resolveOsDeskKeys` сайта против ключей базы) и
 *   включить; разошлись — оставить выключенной;
 * - уже включена, а ключи разошлись (поменяли столбцы, разъехался код) —
 *   выключить и сказать Owner: база писала бы заказ не в те ячейки;
 * - включена и всё сходится — завести документы вкладок ТЕКУЩЕГО периода,
 *   в которых база уже держит строки, а документа вкладки ещё нет (`orphans`).
 *   Одного «вкладка только намечена» (`planned`) мало: без заказов её заведёт
 *   сам ОС, когда откроет стол. Вкладки прошлых периодов не оживляем: строки
 *   без документа там — след удалённой вкладки, а не работа авто-передачи.
 */
export async function runTechSyncOwnerUpkeep(ctx: TechSyncUpkeepContext): Promise<TechSyncUpkeepResult> {
  const { workspaceId } = ctx;
  const result: TechSyncUpkeepResult = { outcome: "ok", mismatches: [], tabs: 0 };
  const state: TechSyncState = await fetchTechSyncState(workspaceId, { force: true });
  if (!state.supported) return { ...result, outcome: "unsupported" };
  if (!state.core) return { ...result, outcome: "no_core" };
  if (state.on === false) return { ...result, outcome: "off" };
  if (!state.desks) return { ...result, outcome: "unverified" };

  const loadSubPages = ctx.loadSubPages ?? ((pageId: string) => fetchSubPages(workspaceId, pageId));
  const subPagesCache = new Map<string, Promise<SubPage[]>>();
  const subPagesOf = (pageId: string) => {
    let cached = subPagesCache.get(pageId);
    if (!cached) {
      cached = loadSubPages(pageId);
      subPagesCache.set(pageId, cached);
    }
    return cached;
  };

  let unknownDesk = false;
  const names: string[] = [];
  for (const desk of state.desks) {
    // База не вывела ключей этого стола (нет документа стола, период неизвестен):
    // заказ туда она и не положит (`no_os_map`) — сверять нечего.
    if (Object.keys(desk.keys).length === 0) continue;
    const page = ctx.osDesks.find((p) => p.id === desk.page);
    if (!page) {
      unknownDesk = true;
      continue;
    }
    let columns: PageColumn[];
    if (!desk.tab) {
      columns = page.columns;
    } else {
      const subPages = await subPagesOf(page.id);
      const tab = subPages.find((s) => s.id === desk.tab);
      // Вкладки ещё нет — столбцы, с которыми она заведётся.
      columns = tab ? (tab.columns?.length ? tab.columns : page.columns) : monthTabColumnsFor(page, subPages);
    }
    const diff = compareOsDeskKeys(desk.keys, columns);
    if (diff.length > 0) {
      result.mismatches.push({ page: desk.page, tab: desk.tab, keys: diff });
      names.push(page.name);
    }
  }

  if (result.mismatches.length > 0) {
    // Один раз могло и показаться: столбцы стола ОС только что поменяли, и до
    // этой вкладки новый документ ещё не доехал. Решаем по ДВУМ заходам подряд
    // с одним и тем же расхождением (хук повторяет заход через полминуты).
    const signature = JSON.stringify(result.mismatches);
    const confirmed = seenMismatch.get(workspaceId) === signature;
    seenMismatch.set(workspaceId, signature);
    if (!confirmed) return { ...result, outcome: "mismatch" };
    console.warn("[tech-sync] сайт и база по-разному читают столбцы столов ОС", result.mismatches);
    const where = `«${names[0]}»${names.length > 1 ? ` и ещё ${names.length - 1}` : ""}`;
    if (state.on === true) {
      await sbSetTechSync(workspaceId, false);
      tellOnce(
        `${workspaceId}:switched_off`,
        `Авто-передача ОС выключена: сайт и база по-разному читают столбцы стола ОС ${where}`,
        "Заказы снова передаются кнопкой «Передать ОС» на «Правке столов»."
      );
      return { ...result, outcome: "switched_off" };
    }
    tellOnce(
      `${workspaceId}:mismatch`,
      `Авто-передача ОС не включена: сайт и база по-разному читают столбцы стола ОС ${where}`,
      "Заказы передаются по-старому — «Правка столов» → «Передать ОС»."
    );
    return { ...result, outcome: "mismatch" };
  }
  seenMismatch.delete(workspaceId);

  if (state.on === null) {
    // Включаем, только проверив КАЖДЫЙ стол: список столов мог ещё не загрузиться.
    if (unknownDesk) return { ...result, outcome: "unverified" };
    const set = await sbSetTechSync(workspaceId, true);
    if (!set) return { ...result, outcome: "unsupported" };
    console.info("[tech-sync] авто-передача ОС включена: ключи столов ОС сверены", state.desks.length);
    result.outcome = "activated";
  }

  // Вкладки текущего периода, куда база уже положила заказы, а документа вкладки ещё нет.
  const ensureTab = ctx.ensureTab ?? ((page: WorkspacePage, periodKey: string) => ensureMonthTabDocById(workspaceId, page, periodKey));
  for (const desk of state.desks) {
    const page = ctx.osDesks.find((p) => p.id === desk.page);
    if (!page) continue;
    const periods = new Set<string>();
    for (const tabId of desk.orphans) {
      const key = periodOfTabId(tabId);
      // Только текущий период по часам базы; период неизвестен — ничего не заводим.
      if (key && key === state.period) periods.add(key);
    }
    for (const key of periods) {
      result.tabs += 1;
      await ensureTab(page, key).catch((error) => console.warn("[tech-sync] вкладка стола ОС не завелась", page.id, key, error));
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Хук.
// ---------------------------------------------------------------------------

export function useTechSyncBridge(): void {
  const { profile } = useAuth();
  const permissions = usePermissions();
  const { activeWorkspaceId, activeWorkspace, allPages, osDesks, members, isLoadingWorkspaceData } = useWorkspace();
  const backend = useRowsBackend(activeWorkspaceId);
  const uid = permissions.uid ?? "";
  const resolved = permissions.isResolved;
  const canEditPageData = permissions.canEditPageData;
  const techFillsAll = Boolean(activeWorkspace?.techFillsAll);

  // Есть ли вообще столы «Заполняет сам» — и хоть один, который правит этот человек.
  const scopedCount = useMemo(
    () => allPages.filter((p) => techFillsDesk(p, { techFillsAll })).length,
    [allPages, techFillsAll]
  );
  const mine = useMemo(
    () => resolved && allPages.some((p) => techFillsDesk(p, { techFillsAll }) && canEditPageData(p)),
    [allPages, techFillsAll, resolved, canEditPageData]
  );
  // Раздел «Стол ОС» выключен в «Конструкторе» — столов ОС нет, передавать некуда.
  const osDeskOn = isModuleEnabled(useSiteConfig(), "osDesk");
  const supabase = Boolean(osDeskOn && activeWorkspaceId && backend === "supabase");
  const listening = Boolean(supabase && uid && mine);
  const owner = Boolean(supabase && uid && resolved && permissions.upkeepOwner && scopedCount > 0 && !isLoadingWorkspaceData);

  // Состояние функции держим свежим, только когда оно кому-то здесь нужно.
  useTechSyncState(listening || owner ? activeWorkspaceId : null);

  const latest = useRef({ pages: allPages, osDesks, members, techFillsAll, canEditPageData, profile });
  latest.current = { pages: allPages, osDesks, members, techFillsAll, canEditPageData, profile };

  useEffect(() => {
    if (!listening || !activeWorkspaceId) return;
    const workspaceId = activeWorkspaceId;
    const stopWrites = onOwnRowWrite((event) => {
      if (event.workspaceId !== workspaceId) return;
      const cur = latest.current;
      void handleOwnRowWrite(event, {
        pages: cur.pages,
        workspace: { techFillsAll: cur.techFillsAll },
        canEdit: cur.canEditPageData,
      }).catch((error) => console.warn("[tech-sync] своя правка не ушла в очередь", error));
    });
    const stopLinked = onTechSyncLinked((event) => {
      if (event.workspaceId !== workspaceId) return;
      const cur = latest.current;
      void notifyOsAboutLinked(event, {
        uid,
        fromName: myDisplayName(cur.profile, cur.members),
        pages: cur.pages,
        members: cur.members,
      }).catch(() => undefined);
    });
    return () => {
      stopWrites();
      stopLinked();
    };
  }, [listening, activeWorkspaceId, uid]);

  useEffect(() => {
    if (!owner || !activeWorkspaceId) return;
    const workspaceId = activeWorkspaceId;
    let disposed = false;
    let running = false;
    let lastRunAt = 0;
    let confirmTimer: number | null = null;
    const run = async (confirming = false) => {
      if (disposed || running || document.visibilityState !== "visible") return;
      running = true;
      lastRunAt = Date.now();
      try {
        const { outcome } = await runTechSyncOwnerUpkeep({ workspaceId, osDesks: latest.current.osDesks });
        // Расхождение ключей решается вторым заходом — один повтор, не цепочка.
        if (outcome === "mismatch" && !confirming && !disposed) {
          confirmTimer = window.setTimeout(() => {
            confirmTimer = null;
            void run(true);
          }, UPKEEP_CONFIRM_MS);
        }
      } catch (error) {
        console.warn("[tech-sync] обслуживание авто-передачи не удалось", error);
      } finally {
        running = false;
      }
    };
    const first = window.setTimeout(() => void run(), UPKEEP_FIRST_MS);
    const every = window.setInterval(() => void run(), UPKEEP_EVERY_MS);
    // Таймер мог сработать на свёрнутой вкладке — доделаем при возврате.
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastRunAt >= UPKEEP_EVERY_MS) void run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      window.clearTimeout(first);
      window.clearInterval(every);
      if (confirmTimer !== null) window.clearTimeout(confirmTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [owner, activeWorkspaceId]);
}
