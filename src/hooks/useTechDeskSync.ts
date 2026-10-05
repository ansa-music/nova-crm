import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useRowsBackend } from "@/hooks/useRowsBackend";
import { useWorkspace } from "@/hooks/useWorkspace";
import { currentPeriodKeyOf } from "@/services/periodService";
import {
  enqueueTechSync,
  registerDeskRows,
  sbTechSyncScan,
  subscribeTechSyncMemory,
  TECH_SYNC_REASON_TEXT,
  techSyncAcksOf,
  techSyncActive,
  techSyncMemoryVersion,
  useTechSyncState,
} from "@/services/rows/techSync";
import {
  isRetryableTechCode,
  periodTabOf,
  planTechItems,
  techDeskKey,
  techFillsDesk,
  techKeysFor,
  techRowLinked,
  techSyncFingerprint,
  techUnlinkedBlock,
  TECH_SYNC_MAX_ITEMS,
  TECH_SYNC_RETRY_MS,
} from "@/utils/techSyncPlan";
import type { PageRow, WorkspacePage } from "@/types";

/**
 * Авто-передача ОС на открытом столе «Заполняет сам» (см.
 * `services/rows/techSync.ts`). Свои правки ловит мост в `AppLayout`
 * (`useTechSyncBridge`); здесь — то, чему нужны строки стола:
 *
 * - стол отдаёт очереди свои строки: по ним она не шлёт то, на что база уже
 *   ответила, и знает адрес источника на столе ОС;
 * - ДОГОН по состоянию строк: через 1–3 с после первых строк с сервера, при
 *   возврате на вкладку после минуты и при возврате сети — одна сверка
 *   статусов (`rows_tech_sync_scan`) и передача несвязанных строк с ником ОС,
 *   не больше 50 за заход. Так доезжает то, что не дошло: вкладку закрыли в
 *   паузе, строку заполнили до включения функции, источник был занят;
 * - отказы, которые проходят сами (у ОС ещё нет стола, не закреплён ник
 *   технаря), переспрашиваются раз в 2 минуты, пока стол на виду;
 * - `reasonOf(rowId)` — почему строка с ником ОС «не у ОС» (текст для метки).
 */

/** Первый догон — через столько после строк с сервера (со случайной добавкой: столы открывают разом). */
const CATCH_UP_FIRST_MS = 1_000;
const CATCH_UP_JITTER_MS = 2_000;
/** Вернулись на вкладку — догон, если прошлый был не меньше чем столько назад. */
const CATCH_UP_RETURN_MS = 60_000;
/** Строк больше лимита — следующая пачка через столько, не больше стольких пачек подряд. */
const CATCH_UP_MORE_MS = 4_000;
const CATCH_UP_CHAIN = 5;
/** Строку только что отправили — не отбирать её снова, пока база отвечает. */
const SENT_QUIET_MS = 30_000;

function sameCodes(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [id, code] of a) if (b.get(id) !== code) return false;
  return true;
}

function cellText(row: PageRow, key: string | undefined): string {
  if (!key) return "";
  const value = row.cells[key];
  return value === null || value === undefined ? "" : String(value).trim();
}

export function useTechDeskSync(args: {
  workspaceId: string | null | undefined;
  page: WorkspacePage | null | undefined;
  /** Открытая вкладка ('' — «Основная»). */
  tabId: string;
  rows: PageRow[];
  /** Стол «Заполняет сам», и этот человек вправе править его строки. */
  enabled: boolean;
  /** Строки пришли с сервера (не снимок с диска): по ним можно решать. */
  rowsFromServer: boolean;
}): {
  /** Авто-передача на этом столе работает. */
  active: boolean;
  /** Почему строка с ником ОС не у ОС — текст подсказки; null — причины нет. */
  reasonOf: (rowId: string) => string | null;
  /** То же кодом ответа (`TECH_SYNC_REASON_TEXT`). */
  codeOf: (rowId: string) => string | null;
} {
  const { workspaceId, page, rows, enabled, rowsFromServer } = args;
  const tab = args.tabId ?? "";
  const pageId = page?.id ?? "";
  const { members, activeWorkspace } = useWorkspace();
  const backend = useRowsBackend(workspaceId ?? null);
  const wanted = Boolean(
    enabled && workspaceId && page && backend === "supabase" && techFillsDesk(page, activeWorkspace)
  );
  const state = useTechSyncState(wanted ? workspaceId : null);
  const active = wanted && techSyncActive(state);
  const memory = useSyncExternalStore(subscribeTechSyncMemory, techSyncMemoryVersion, techSyncMemoryVersion);
  const key = workspaceId && pageId ? techDeskKey(workspaceId, pageId, tab) : "";
  // Период — по часам базы (она и решает), свои часы — пока ответа нет.
  const periodTabId = periodTabOf(page, state?.period ?? (workspaceId ? currentPeriodKeyOf(workspaceId) : null));

  const live = useRef({ rows, rowsFromServer, page, members, periodTabId });
  live.current = { rows, rowsFromServer, page, members, periodTabId };

  // Строки — очереди (только настоящие, с сервера).
  useEffect(() => {
    if (!active || !key) return;
    return registerDeskRows(key, () => (live.current.rowsFromServer ? live.current.rows : null));
  }, [active, key]);

  // Догон и повтор отказов.
  useEffect(() => {
    if (!active || !rowsFromServer || !workspaceId || !pageId || !key) return;
    let disposed = false;
    let running = false;
    let lastRunAt = 0;
    let moreTimer: number | null = null;
    let retryTimer: number | null = null;
    const sentAt = new Map<string, number>();

    const run = async (scan: boolean, depth = 0) => {
      if (disposed || running || document.visibilityState !== "visible") return;
      running = true;
      lastRunAt = Date.now();
      try {
        const found = scan ? await sbTechSyncScan(workspaceId, pageId, tab) : null;
        const cur = live.current;
        if (disposed || !cur.page || !cur.rowsFromServer) return;
        const now = Date.now();
        const plan = planTechItems({
          rows: cur.rows.filter((row) => now - (sentAt.get(row.id) ?? 0) >= SENT_QUIET_MS),
          page: cur.page,
          tabId: tab,
          periodTabId: cur.periodTabId,
          members: cur.members,
          acked: techSyncAcksOf(key),
          drift: new Set(found?.drift ?? []),
          now,
          limit: TECH_SYNC_MAX_ITEMS,
        });
        if (plan.items.length > 0) {
          for (const item of plan.items) sentAt.set(item.row, now);
          enqueueTechSync(
            workspaceId,
            pageId,
            tab,
            plan.items.map((item) => item.row),
            { own: false, check: false }
          );
        }
        if (plan.more && depth < CATCH_UP_CHAIN) {
          if (moreTimer !== null) window.clearTimeout(moreTimer);
          moreTimer = window.setTimeout(() => {
            moreTimer = null;
            void run(false, depth + 1);
          }, CATCH_UP_MORE_MS);
        }
      } finally {
        running = false;
      }
    };

    const armRetry = () => {
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      retryTimer = null;
      let next = Number.POSITIVE_INFINITY;
      for (const ack of techSyncAcksOf(key).values()) {
        if (isRetryableTechCode(ack.code)) next = Math.min(next, ack.at + TECH_SYNC_RETRY_MS);
      }
      if (!Number.isFinite(next)) return;
      retryTimer = window.setTimeout(
        () => {
          retryTimer = null;
          sentAt.clear();
          void run(false);
        },
        Math.max(1_000, next - Date.now() + 500)
      );
    };

    const first = window.setTimeout(() => void run(true), CATCH_UP_FIRST_MS + Math.random() * CATCH_UP_JITTER_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastRunAt >= CATCH_UP_RETURN_MS) void run(true);
    };
    const onOnline = () => {
      sentAt.clear();
      void run(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    const stopMemory = subscribeTechSyncMemory(armRetry);
    armRetry();
    return () => {
      disposed = true;
      window.clearTimeout(first);
      if (moreTimer !== null) window.clearTimeout(moreTimer);
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      stopMemory();
    };
  }, [active, rowsFromServer, workspaceId, pageId, tab, key]);

  // Почему строка с ником ОС ещё не у ОС: локальная причина или ответ базы на
  // нынешний вид строки (строку поправили — прежний ответ уже не про неё).
  const codes = useMemo(() => {
    const out = new Map<string, string>();
    if (!active || !page || !key) return out;
    const keys = techKeysFor(page, tab);
    // Столбец ОС этой вкладки неизвестен (не вкладка периода) — метить нечего.
    if (!keys?.os) return out;
    const ctx = { page, tabId: tab, periodTabId, members };
    const acked = techSyncAcksOf(key);
    for (const row of rows) {
      if (techRowLinked(row) || !cellText(row, keys.os)) continue;
      const block = techUnlinkedBlock(row, ctx);
      if (block) {
        if (block in TECH_SYNC_REASON_TEXT) out.set(row.id, block);
        continue;
      }
      const ack = acked.get(row.id);
      if (ack && ack.code in TECH_SYNC_REASON_TEXT && ack.fp === techSyncFingerprint(row, keys)) out.set(row.id, ack.code);
    }
    return out;
    // `memory` — счётчик ответов базы: по нему пересчитываем.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, page, key, tab, periodTabId, members, rows, memory]);

  // Те же причины — тот же объект: `reasonOf` не меняется на каждую правку строки.
  const stable = useRef(codes);
  if (!sameCodes(stable.current, codes)) stable.current = codes;
  const current = stable.current;

  const codeOf = useCallback((rowId: string) => current.get(rowId) ?? null, [current]);
  const reasonOf = useCallback(
    (rowId: string) => {
      const code = current.get(rowId);
      return code ? (TECH_SYNC_REASON_TEXT[code] ?? null) : null;
    },
    [current]
  );

  return { active, reasonOf, codeOf };
}
