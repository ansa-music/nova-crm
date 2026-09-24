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
 *
 * `fetchedAtLocal` — когда (performance.now()) НАЧАЛОСЬ чтение, результат
 * которого сейчас в `rows`; публикуется вместе со строками. По нему проход
 * стола ОС видит, что строка поменялась уже после того, как список пошёл
 * читаться, и не решает по нему «статус сменили у технаря» / «копии нет»
 * (гонка 24.09.2026: старый статус технаря возвращался поверх нового).
 * 0 — список ещё ни разу не прочитан.
 */
export function useMyOrderRows(workspaceId: string | null, osUid: string | null, enabled: boolean) {
  const [state, setState] = useState<{ rows: PageRow[]; fetchedAtLocal: number }>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const active = Boolean(enabled && workspaceId && osUid && usesSupabaseRows(workspaceId));

  useEffect(() => {
    if (!active || !workspaceId || !osUid) {
      setState(EMPTY);
      return;
    }
    let cancelled = false;
    let retry: number | null = null;
    let attempt = 0;
    const load = () => {
      setLoading(true);
      // Отметка — ДО запроса: правка, сделанная, пока он летел, в ответ могла
      // не попасть, и список считается старше неё.
      const startedAt = performance.now();
      void sbFetchMyOrderRows(workspaceId, osUid)
        .then((list) => {
          if (cancelled) return;
          attempt = 0;
          setState({ rows: list, fetchedAtLocal: startedAt });
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
  const { rows, fetchedAtLocal } = state;
  /** Заказ по id строки-ИСТОЧНИКА (строки стола ОС). */
  const bySource = new Map(rows.filter((r) => r.srcRowId).map((r) => [r.srcRowId as string, r]));
  return {
    rows,
    bySource,
    loading,
    error,
    refresh,
    /** performance.now() начала чтения, результат которого в `rows` (0 — не читали). */
    fetchedAtLocal,
    /** То же, что `fetchedAtLocal` (имя из разбора гонки). */
    loadStartedAt: fetchedAtLocal,
  };
}

const EMPTY: { rows: PageRow[]; fetchedAtLocal: number } = { rows: [], fetchedAtLocal: 0 };
