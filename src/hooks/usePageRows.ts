import { useEffect, useRef, useState } from "react";
import { subscribeToRows } from "@/services/pageService";
import { subscribeToSubPageRows } from "@/services/subPageService";
import { sbPageAccess } from "@/services/rows/supabaseRowStore";
import { firestoreErrorText } from "@/utils/dbError";

/**
 * Текст про ЧТЕНИЕ строк: общий `firestoreErrorText` написан под записи
 * («База отклонила запись…»), а здесь человек ничего не сохранял — он просто
 * открыл стол.
 */
function readErrorText(error: unknown): string {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
  if (code === "permission-denied") return "Нет доступа к строкам этого стола — возможно, доступ изменился.";
  if (code === "unauthenticated") return "Вход устарел — обновите страницу.";
  if (code === "unavailable") return "Нет связи с базой строк.";
  if (code === "resource-exhausted") return firestoreErrorText(error, "Не удалось прочитать строки стола");
  return firestoreErrorText(error, "Не удалось прочитать строки стола");
}
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
  /** Права на стол доехали после плашки — переподписаться и перечитать строки. */
  const [reloadNonce, setReloadNonce] = useState(0);
  /**
   * Строки не прочитались. Хранилище повторяет само (3 → 30 с), но МОЛЧА:
   * человек видел пустой скелет таблицы без единого слова и не понимал, ждать
   * ему или звать на помощь. Текст берём от самой ошибки — «нет прав», «нет
   * связи», «кончилась квота» лечатся по-разному.
   */
  const [readError, setReadError] = useState<string | null>(null);
  /** Какой таблицы эта ошибка — чтобы не показывать её на соседней вкладке. */
  const [errorKey, setErrorKey] = useState("");
  /**
   * Таблица, право читать которую уже подтверждено. Пустая выборка и проверка
   * прав — два запроса, и права могли доехать МЕЖДУ ними: выборка отдала
   * пустоту по старым правам, проверка — «читать можно». Поэтому после
   * подтверждения таблица перечитывается ещё раз, и только эта, вторая
   * пустота значит «стол пустой». Ключ — чтобы перечитать один раз, а не по кругу.
   */
  const confirmedKey = useRef("");

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
    setReadError(null);

    let cancelled = false;
    /** Supabase: право читать стол подтверждено — пустота значит «строк нет». */
    const key = `${backend}:${workspaceId}/${pageId}/${subPageId ?? ""}`;
    let accessConfirmed = confirmedKey.current === key;
    let accessChecking = false;
    let accessTimer: number | null = null;

    // Пока плашка «права не доехали» — перепроверяем раз в 15 с (Supabase
    // такие запросы не тарифицирует): запись прав событием строк не приходит,
    // и без опроса стол открылся бы только после возврата на вкладку.
    const checkAccess = () => {
      if (cancelled || accessChecking) return;
      accessChecking = true;
      void sbPageAccess(workspaceId, pageId)
        .then((access) => {
          if (cancelled) return;
          if (access.canRead) {
            accessConfirmed = true;
            confirmedKey.current = key;
            setAccessPending(false);
            setReloadNonce((n) => n + 1); // перечитать уже с подтверждёнными правами
            return;
          }
          setAccessPending(true);
          accessTimer = window.setTimeout(checkAccess, 15_000);
        })
        .catch(() => {
          if (!cancelled) accessTimer = window.setTimeout(checkAccess, 15_000);
        })
        .finally(() => {
          accessChecking = false;
        });
    };

    const onData = (data: PageRow[], fromServer: boolean) => {
      if (cancelled) return;
      setDataKey(key);
      setRows(data);
      setIsLoading(false);
      if (backend === "supabase" && data.length === 0 && !accessConfirmed) {
        // Пустая выборка Supabase — это и «строк нет», и отказ политики (RLS
        // отказ не называет). Пока право читать не подтверждено, это НЕ
        // «данные с сервера»: иначе стол опубликовал бы нулевые счётчики в
        // «Технари» и дашборд поверх настоящих («отказ = не подтверждено»).
        setServerSynced(false);
        if (accessTimer === null) checkAccess();
        return;
      }
      if (backend === "supabase" && data.length > 0) {
        accessConfirmed = true;
        confirmedKey.current = key;
        setAccessPending(false);
      }
      setReadError(null);
      setServerSynced(fromServer);
    };
    // Ошибка чтения — таблица остаётся «загружается» (хранилище повторит само),
    // а НЕ показывает строки прошлой вкладки как строки этой: правка такой
    // «чужой» строки завела бы её копию здесь. Но человеку об этом говорим:
    // молчаливый пустой скелет неотличим от «стол пустой».
    const onError = (error: unknown) => {
      if (cancelled) return;
      setErrorKey(key);
      setReadError(readErrorText(error));
    };

    const unsubscribe = subPageId
      ? subscribeToSubPageRows(workspaceId, pageId, subPageId, onData, onError)
      : subscribeToRows(workspaceId, pageId, onData, onError);

    return () => {
      cancelled = true;
      if (accessTimer !== null) window.clearTimeout(accessTimer);
      unsubscribe();
    };
  }, [workspaceId, pageId, subPageId, backend, reloadNonce]);

  const current = scopeKey !== "" && dataKey === scopeKey;
  return {
    rows,
    isLoading: Boolean(workspaceId && pageId) && (isLoading || !current),
    serverSynced: serverSynced && current,
    accessPending: accessPending && current,
    readError: scopeKey !== "" && errorKey === scopeKey ? readError : null,
    /** «Повторить» — переподписка сразу, не дожидаясь очередного повтора хранилища. */
    retry: () => {
      setReadError(null);
      setReloadNonce((n) => n + 1);
    },
  };
}

export function usePageRows(workspaceId: string | null, pageId: string | null) {
  return useSyncedTableRows(workspaceId, pageId, null);
}
