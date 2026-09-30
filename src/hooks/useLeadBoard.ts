import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildLeadOrders,
  fetchLeadBoard,
  fetchLeadBoardHead,
  leadHeadOf,
  leadsTopic,
  recordKey,
  type LeadOrder,
  type LeadTable,
} from "@/services/leadBoardService";
import { listenTopic } from "@/services/sb/topicDoorbell";
import { listenRowsDoorbell } from "@/services/rows/rowsDoorbell";
import type { DeskRowRecord } from "@/services/rows/supabaseRowStore";
import type { WorkspacePage } from "@/types";

/** Номер правки берётся в начале записи, а виден при фиксации: курсор — с запасом. */
const REV_LAG_MS = 10_000;
const HEAD_POLL_MS = 15_000;
const RING_DEBOUNCE_MS = 300;

export interface LeadBoardState {
  orders: LeadOrder[];
  loaded: boolean;
  error: Error | null;
  /** Перечитать сейчас (дельта + сверка головы). */
  refresh: () => void;
  /** Своя правка — сразу на экран, до ответа базы. */
  patchLocal: (key: string, cells: Record<string, unknown>) => void;
  /**
   * Удаление — строки (ключи `page/tab/id`) пропадают сразу. Метка живёт,
   * пока выборка их ещё приносит: выборка, начатая до удаления, не вернёт
   * строку на экран. Не удалилось или «Вернуть» — `unhideLocal`.
   */
  hideLocal: (keys: readonly string[]) => void;
  unhideLocal: (keys: readonly string[]) => void;
}

/**
 * Живая «Общая таблица»: первая выборка, дальше дельта по rev. Голова
 * (число, max rev, md5 «page/tab/id:rev») приходит с каждой дельтой из того
 * же снимка базы: не сошлась со своей — полная перечитка (удаление, переезд,
 * обгон фиксаций). Будят: звонок `nova:{ws}:leads`, звонки столов ОС, опрос
 * головы раз в 15 с на видимой вкладке и возврат на вкладку.
 */
export function useLeadBoard(input: {
  workspaceId: string | null;
  tables: readonly LeadTable[];
  pages: readonly WorkspacePage[];
  enabled: boolean;
}): LeadBoardState {
  const { workspaceId, enabled } = input;
  const tablesSig = useMemo(() => input.tables.map((t) => `${t.kind}:${t.page}/${t.tab}`).join("|"), [input.tables]);
  const tablesRef = useRef(input.tables);
  tablesRef.current = input.tables;

  const [records, setRecords] = useState<Map<string, DeskRowRecord>>(() => new Map());
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const kickRef = useRef<() => void>(() => {});

  useEffect(() => {
    setRecords(new Map());
    setLoaded(false);
    setError(null);
    setHidden(new Set());
    if (!enabled || !workspaceId) return;
    let cancelled = false;
    let map = new Map<string, DeskRowRecord>();
    // Контрольные точки курсора: (когда увидели, наибольший rev на тот момент).
    let checkpoints: Array<{ at: number; rev: number }> = [];
    let running = false;
    let queued: "delta" | "full" | null = null;
    let ringTimer: number | null = null;

    const maxRev = () => {
      let rev = 0;
      for (const r of map.values()) rev = Math.max(rev, Number(r.rev ?? 0) || 0);
      return rev;
    };
    const cursor = () => {
      const now = Date.now();
      let c = 0;
      for (const cp of checkpoints) if (now - cp.at >= REV_LAG_MS) c = Math.max(c, cp.rev);
      return c;
    };
    const publish = () => {
      if (cancelled) return;
      checkpoints.push({ at: Date.now(), rev: maxRev() });
      if (checkpoints.length > 20) checkpoints = checkpoints.slice(-20);
      setRecords(new Map(map));
      setLoaded(true);
      setError(null);
      // База строку больше не отдаёт — метка удаления своё отслужила.
      setHidden((prev) => {
        if (prev.size === 0) return prev;
        const next = new Set([...prev].filter((key) => map.has(key)));
        return next.size === prev.size ? prev : next;
      });
    };

    const run = async (mode: "delta" | "full") => {
      if (running) {
        queued = queued === "full" || mode === "full" ? "full" : "delta";
        return;
      }
      running = true;
      try {
        const tables = tablesRef.current;
        if (mode === "full" || map.size === 0) {
          const res = await fetchLeadBoard(workspaceId, tables, 0);
          if (cancelled) return;
          map = new Map(res.rows.map((r) => [recordKey(r), r]));
          checkpoints = [];
          publish();
        } else {
          const res = await fetchLeadBoard(workspaceId, tables, cursor());
          if (cancelled) return;
          for (const r of res.rows) map.set(recordKey(r), r);
          const mine = leadHeadOf(map.values());
          if (mine.ids !== res.ids || mine.count !== res.count) {
            const full = await fetchLeadBoard(workspaceId, tables, 0);
            if (cancelled) return;
            map = new Map(full.rows.map((r) => [recordKey(r), r]));
            checkpoints = [];
          }
          publish();
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e : new Error(String(e)));
          setLoaded(true);
        }
      } finally {
        running = false;
        if (!cancelled && queued) {
          const next = queued;
          queued = null;
          void run(next);
        }
      }
    };

    const checkHead = async () => {
      if (running || document.visibilityState !== "visible") return;
      try {
        const head = await fetchLeadBoardHead(workspaceId, tablesRef.current);
        if (cancelled) return;
        const mine = leadHeadOf(map.values());
        if (mine.ids !== head.ids || mine.count !== head.count) void run("delta");
      } catch {
        // Опрос молчит: следующая попытка через 15 с.
      }
    };

    const ring = () => {
      if (ringTimer !== null) return;
      ringTimer = window.setTimeout(() => {
        ringTimer = null;
        void run("delta");
      }, RING_DEBOUNCE_MS);
    };
    kickRef.current = () => void run("delta");

    void run("full");
    const stopTopic = listenTopic(leadsTopic(workspaceId), ring);
    const osPages = [...new Set(tablesRef.current.filter((t) => t.kind === "os").map((t) => t.page))];
    const stopDesks = osPages.map((page) => listenRowsDoorbell(workspaceId, page, ring));
    const poll = window.setInterval(() => void checkHead(), HEAD_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void checkHead();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      kickRef.current = () => {};
      stopTopic();
      stopDesks.forEach((stop) => stop());
      window.clearInterval(poll);
      if (ringTimer !== null) window.clearTimeout(ringTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [workspaceId, enabled, tablesSig]);

  const refresh = useCallback(() => kickRef.current(), []);
  const patchLocal = useCallback((key: string, cells: Record<string, unknown>) => {
    setRecords((prev) => {
      const cur = prev.get(key);
      if (!cur) return prev;
      const next = new Map(prev);
      next.set(key, { ...cur, cells: { ...(cur.cells ?? {}), ...cells } as DeskRowRecord["cells"] });
      return next;
    });
  }, []);

  const hideLocal = useCallback((keys: readonly string[]) => {
    if (keys.length === 0) return;
    setHidden((prev) => new Set([...prev, ...keys]));
  }, []);
  const unhideLocal = useCallback((keys: readonly string[]) => {
    if (keys.length === 0) return;
    setHidden((prev) => {
      const next = new Set(prev);
      for (const key of keys) next.delete(key);
      return next.size === prev.size ? prev : next;
    });
  }, []);

  const pagesById = useMemo(() => new Map(input.pages.map((p) => [p.id, p])), [input.pages]);
  const orders = useMemo(
    () => {
      const shown = hidden.size ? [...records.values()].filter((r) => !hidden.has(recordKey(r))) : records.values();
      return buildLeadOrders(shown, { pagesById, tables: tablesRef.current });
    },
    // tablesSig — таблицы, по которым разбирается выборка.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [records, hidden, pagesById, tablesSig]
  );

  return { orders, loaded, error, refresh, patchLocal, hideLocal, unhideLocal };
}
