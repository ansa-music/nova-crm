import { useCallback, useEffect, useState } from "react";
import { sbFetchMyOrderRows } from "@/services/rows/supabaseRowStore";
import { usesSupabaseRows } from "@/services/rows/rowsBackend";
import type { PageRow } from "@/types";

/**
 * Заказы ЭТОГО ОС в столах технарей — один запрос на весь стол ОС.
 *
 * Заказ живёт строкой в столе технаря (там его считают «Технари», дашборд и
 * оценки), а ОС видит у себя строку-источник. Чтобы показать ему настоящий
 * статус и понять, доехала ли правка, читаем его строки одним запросом:
 * политика Supabase отдаёт ровно строки с его `os_uid`, доступ к самим столам
 * для этого не нужен. Читаем разово (при открытии стола и после действий), а
 * не подпиской: столов у технарей полтора десятка, живой канал на каждый —
 * лишний трафик.
 */
export function useMyOrderRows(workspaceId: string | null, osUid: string | null, enabled: boolean) {
  const [rows, setRows] = useState<PageRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const active = Boolean(enabled && workspaceId && osUid && usesSupabaseRows(workspaceId));

  useEffect(() => {
    if (!active || !workspaceId || !osUid) {
      setRows([]);
      return;
    }
    let cancelled = false;
    let retry: number | null = null;
    let attempt = 0;
    const load = () => {
      setLoading(true);
      void sbFetchMyOrderRows(workspaceId, osUid)
        .then((list) => {
          if (cancelled) return;
          attempt = 0;
          setRows(list);
          setError(null);
        })
        .catch((e) => {
          if (cancelled) return;
          setError(e instanceof Error ? e.message : "Не удалось прочитать свои заказы");
          // Отказ (плохая сеть, истёк токен, SQL ещё не накатан) — не навсегда:
          // без повтора проход стола ОС молча стоял бы до перезагрузки.
          attempt += 1;
          retry = window.setTimeout(load, Math.min(30_000, 3_000 * 2 ** (attempt - 1)));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };
    load();
    const onVisible = () => {
      if (document.visibilityState === "visible" && retry !== null) {
        window.clearTimeout(retry);
        retry = null;
        load();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      if (retry !== null) window.clearTimeout(retry);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, workspaceId, osUid, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  /** Заказ по id строки-ИСТОЧНИКА (строки стола ОС). */
  const bySource = new Map(rows.filter((r) => r.srcRowId).map((r) => [r.srcRowId as string, r]));
  return { rows, bySource, loading, error, refresh };
}
