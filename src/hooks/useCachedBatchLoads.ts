import { useEffect, useState } from "react";

/**
 * Разовые чтения «Дашборда» (строки столов, вкладка по умолчанию, её
 * строки) — партиями и с кэшем на модуле на 15 минут.
 *
 * Зачем кэш: раньше КАЖДЫЙ заход на «Дашборд» заново читал строки всех
 * столов (у Owner — всех столов пространства), а туда-обратно по меню
 * ходят десятки раз в день. На Spark (50 000 чтений в сутки) это один из
 * главных пожирателей квоты. 15 минут — компромисс: «Дашборд» — сводка, а
 * не живая таблица; сама таблица стола по-прежнему живая. Упавшее чтение
 * в кэш не кладём — следующий заход попробует снова.
 */
export const DASHBOARD_LOAD_TTL_MS = 15 * 60_000;

export interface OneShotLoadCache<T> {
  peek(key: string, now?: number): T | undefined;
  load(key: string, run: () => Promise<T>): Promise<T>;
}

export function createOneShotLoadCache<T>(ttlMs = DASHBOARD_LOAD_TTL_MS): OneShotLoadCache<T> {
  const values = new Map<string, { at: number; value: T }>();
  // Одно и то же чтение, запрошенное повторно до ответа сервера (список
  // столов пришёл сначала из кэша, потом с сервера; повторный монтаж),
  // идёт в сеть один раз.
  const pending = new Map<string, Promise<T>>();
  return {
    peek(key, now = Date.now()) {
      const hit = values.get(key);
      return hit && now - hit.at < ttlMs ? hit.value : undefined;
    },
    load(key, run) {
      const inFlight = pending.get(key);
      if (inFlight) return inFlight;
      const promise = run()
        .then((value) => {
          values.set(key, { at: Date.now(), value });
          return value;
        })
        .finally(() => {
          pending.delete(key);
        });
      pending.set(key, promise);
      return promise;
    },
  };
}

export interface BatchLoadState<T> {
  /** Упавшее чтение тоже здесь — пустым значением, чтобы экран не ждал вечно. */
  data: Record<string, T>;
  /**
   * Ключи, чьё чтение упало. Их пустое значение — «не знаем», а не «ноль»:
   * публиковать такие числа нельзя (см. leaderboard в PersonalDeskSection).
   */
  failed: Record<string, true>;
  /**
   * Ключи, прочитанные с СЕРВЕРА в этот заход (не из 15-минутного кэша).
   * Публиковать в общий leaderboard можно только их: из кэша ушли бы цифры
   * до 15 минут давности поверх свежих, записанных самим технарём.
   */
  fresh: Record<string, true>;
}

export interface BatchLoadSpec<I, T> {
  /** Ключ результата в `data` — такой, какой ждёт progressForPage. */
  keyOf: (item: I) => string;
  /** Ключ кэша внутри пространства: `pageId` или `pageId:subPageId`. */
  cacheKeyOf: (item: I) => string;
  load: (workspaceId: string, item: I) => Promise<T>;
  empty: T;
  cache: OneShotLoadCache<T>;
  batch: number;
  /**
   * Версия ключа кэша ДЛЯ ЭТОГО workspace — строки могли переехать между
   * Firestore и Supabase, и прочитанное из прежнего хранилища показывать
   * нельзя. Вынесено сюда, а не в `cacheKeyOf`: тому workspaceId не передают,
   * и общий счётчик версий сбрасывал бы кэш чужих пространств.
   */
  versionOf?: (workspaceId: string) => string | number;
}

function cacheKey<I, T>(workspaceId: string, item: I, spec: BatchLoadSpec<I, T>): string {
  const version = spec.versionOf ? `${spec.versionOf(workspaceId)}:` : "";
  return `${workspaceId}/${version}${spec.cacheKeyOf(item)}`;
}

/** Ключ прочитан с сервера в этот заход (см. BatchLoadState.fresh). */
export function isFresh<T>(state: BatchLoadState<T>, key: string): boolean {
  return Boolean(state.fresh[key]);
}

/** Есть ли у ключа настоящие данные: прочитан и чтение не упало. */
export function isLoadedOk<T>(state: BatchLoadState<T>, key: string): boolean {
  return key in state.data && !state.failed[key];
}

function yieldPaint() {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

function fromCache<I, T>(
  workspaceId: string | null,
  items: I[],
  spec: BatchLoadSpec<I, T>,
  bypass?: (item: I) => boolean
): BatchLoadState<T> {
  const data: Record<string, T> = {};
  if (workspaceId) {
    const now = Date.now();
    for (const item of items) {
      if (bypass?.(item)) continue;
      const hit = spec.cache.peek(cacheKey(workspaceId, item, spec), now);
      if (hit !== undefined) data[spec.keyOf(item)] = hit;
    }
  }
  return { data, failed: {}, fresh: {} };
}

/**
 * One-shot getDocs in small batches — never an onSnapshot per desk (Spark
 * cannot afford N live row listeners). Уже прочитанное за последние 15
 * минут отдаётся сразу, с первого же рендера: повторный заход не мигает
 * нулями и ничего не читает.
 */
export function useCachedBatchLoads<I, T>(
  workspaceId: string | null,
  items: I[],
  spec: BatchLoadSpec<I, T>,
  /**
   * Мимо кэша — СВОИ столы: после своей правки человек сразу идёт на
   * «Дашборд» и видел бы цифры 15-минутной давности. Своих столов 1–2,
   * экономию кэш делает на чужих (у Owner их десятки).
   */
  bypass?: (item: I) => boolean
): BatchLoadState<T> {
  const [state, setState] = useState<BatchLoadState<T>>(() => fromCache(workspaceId, items, spec, bypass));
  const version = workspaceId && spec.versionOf ? spec.versionOf(workspaceId) : "";
  const key = `${version}|${items.map((item) => spec.cacheKeyOf(item)).join(",")}`;
  const bypassKey = bypass ? items.filter(bypass).map(spec.cacheKeyOf).join(",") : "";

  useEffect(() => {
    if (!workspaceId || items.length === 0) {
      setState({ data: {}, failed: {}, fresh: {} });
      return;
    }

    let cancelled = false;
    const initial = fromCache(workspaceId, items, spec, bypass);
    setState(initial);
    const missing = items.filter((item) => !(spec.keyOf(item) in initial.data));

    async function loadSlice(slice: I[]) {
      await Promise.all(
        slice.map(async (item) => {
          const k = spec.keyOf(item);
          try {
            const value = await spec.cache.load(cacheKey(workspaceId as string, item, spec), () =>
              spec.load(workspaceId as string, item)
            );
            if (!cancelled)
              setState((prev) => ({ ...prev, data: { ...prev.data, [k]: value }, fresh: { ...prev.fresh, [k]: true } }));
          } catch {
            if (!cancelled)
              setState((prev) => ({
                data: { ...prev.data, [k]: prev.data[k] ?? spec.empty },
                failed: { ...prev.failed, [k]: true },
                fresh: prev.fresh,
              }));
          }
        })
      );
    }

    void (async () => {
      await loadSlice(missing.slice(0, spec.batch));
      for (let i = spec.batch; i < missing.length; i += spec.batch) {
        if (cancelled) return;
        await yieldPaint();
        if (cancelled) return;
        await loadSlice(missing.slice(i, i + spec.batch));
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, key, bypassKey]);

  return state;
}
