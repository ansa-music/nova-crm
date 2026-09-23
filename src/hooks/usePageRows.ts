import { useEffect, useState } from "react";
import { subscribeToRows } from "@/services/pageService";
import { subscribeToSubPageRows } from "@/services/subPageService";
import { sbPageAccess } from "@/services/rows/supabaseRowStore";
import { useRowsBackend } from "@/hooks/useRowsBackend";
import type { PageRow } from "@/types";

/**
 * Живые строки одной таблицы стола — из того хранилища, где они сейчас
 * живут (Firestore или Supabase, `workspace.rowsBackend`). Пока хранилище не
 * известно, таблица ждёт: иначе при строках в Supabase она успела бы
 * подписаться на замёрзшие строки Firestore. Переключили — переподписка.
 *
 * Прежнее зеркало `row_records` (Firestore + копия в Supabase) убрано: оно
 * читало стол ДВАЖДЫ и квоты Firestore не экономило вовсе.
 */
export function useSyncedTableRows(
  workspaceId: string | null,
  pageId: string | null,
  subPageId: string | null
) {
  const backend = useRowsBackend(workspaceId);
  const [rows, setRows] = useState<PageRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  /**
   * Последний снимок строк пришёл с сервера. Таблица рисуется и по кэшу
   * (`isLoading` снимается сразу), а решения «за стол» — публикация
   * счётчиков в «Технари» — ждут этого флага: с LRU-кэшем повторное открытие
   * стола сначала отдаёт строки с прошлого визита, сколько угодно старые.
   * У Supabase кэша нет — каждый снимок с сервера.
   */
  const [serverSynced, setServerSynced] = useState(false);
  /**
   * Строки в Supabase, а права на этот стол туда ещё не доехали (их копию
   * пишут сессии Owner/Тимлида). Политика в этом случае отдаёт пустоту —
   * без флага человек увидел бы «пустой стол» и начал бы вбивать заказы заново.
   */
  const [accessPending, setAccessPending] = useState(false);
  /**
   * Чьи строки сейчас в состоянии. Сброс флагов идёт в эффекте, то есть на
   * рендер ПОЗЖЕ смены вкладки, и в этот один рендер хук отдавал строки
   * прошлой вкладки как «загружены и с сервера» — публикация счётчиков успевала
   * посчитать их за новую вкладку. Флаги сверяем с ключом прямо в рендере.
   */
  const scopeKey =
    workspaceId && pageId && backend ? `${backend}:${workspaceId}/${pageId}/${subPageId ?? ""}` : "";
  const [dataKey, setDataKey] = useState("");

  useEffect(() => {
    if (!workspaceId || !pageId) {
      setRows([]);
      setServerSynced(false);
      setAccessPending(false);
      setIsLoading(false);
      return;
    }
    if (!backend) {
      // Хранилище ещё не известно — ждём, ничего не читая.
      setIsLoading(true);
      return;
    }

    setIsLoading(true);
    setServerSynced(false);
    setAccessPending(false);

    let cancelled = false;
    let accessChecked = false;
    const key = `${backend}:${workspaceId}/${pageId}/${subPageId ?? ""}`;
    const onData = (data: PageRow[], fromServer: boolean) => {
      if (cancelled) return;
      setDataKey(key);
      setRows(data);
      setServerSynced(fromServer);
      setIsLoading(false);
      if (backend === "supabase" && data.length > 0) setAccessPending(false);
      // Пусто в Supabase — проверим один раз: строк нет или прав ещё нет.
      if (backend === "supabase" && data.length === 0 && !accessChecked) {
        accessChecked = true;
        void sbPageAccess(workspaceId, pageId)
          .then((access) => {
            if (!cancelled) setAccessPending(!access.canRead);
          })
          .catch(() => undefined);
      }
    };
    const onError = () => {
      if (cancelled) return;
      setDataKey(key);
      setIsLoading(false);
    };

    const unsubscribe = subPageId
      ? subscribeToSubPageRows(workspaceId, pageId, subPageId, onData, onError)
      : subscribeToRows(workspaceId, pageId, onData, onError);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [workspaceId, pageId, subPageId, backend]);

  const current = scopeKey !== "" && dataKey === scopeKey;
  return {
    rows,
    isLoading: Boolean(workspaceId && pageId) && (isLoading || !current),
    serverSynced: serverSynced && current,
    accessPending: accessPending && current,
  };
}

export function usePageRows(workspaceId: string | null, pageId: string | null) {
  return useSyncedTableRows(workspaceId, pageId, null);
}
