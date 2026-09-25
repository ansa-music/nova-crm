import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentPeriodKey } from "@/hooks/useCurrentPeriodKey";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { refreshDeskLoadFromRows, subscribeDeskLoadHistory, subscribeDeskLoads } from "@/services/deskLoadService";
import { currentMonthSubPageId, isMonthlyDesk } from "@/services/monthTabService";
import { subscribeOrderRatings, subscribeOrderRatingTotals, type OrderRatingsScope } from "@/services/orderRatingService";
import { useSbBackend, type SbBackend } from "@/services/sb/sbCollections";
import { subscribeTechSchedules } from "@/services/techScheduleService";
import { joinSharedSubscription } from "@/utils/sharedSubscription";
import type {
  DeskLoad,
  DeskLoadArchive,
  OrderRating,
  OrderRatingTotals,
  TechSchedule,
  WorkspacePage,
} from "@/types";

/**
 * Где счётчики столов этого workspace — Firestore или Supabase (правило в
 * services/sb/sbCollections.ts). `null` — документ workspace ещё не пришёл:
 * ждём, иначе старт читал бы Firestore и тут же переподписывался бы.
 */
function useDeskLoadsBackend(workspaceId: string | null): SbBackend | null {
  const { activeWorkspace } = useWorkspace();
  const same = Boolean(workspaceId && activeWorkspace?.id === workspaceId);
  const backend = useSbBackend(same ? activeWorkspace : null, "deskLoads");
  // Чужой (не активный) workspace — его настроек у вкладки нет: как раньше, Firestore.
  if (!activeWorkspace) return null;
  return same ? backend : "firestore";
}

/**
 * Из какого хранилища пришёл массив счётчиков — метка на САМОМ массиве:
 * пересчёт Owner получает `loads` от экрана (Дашборд, Технари, ABS) и должен
 * знать их происхождение без нового параметра у каждого вызова.
 */
const loadsSource = new WeakMap<DeskLoad[], SbBackend>();

/**
 * Every desk's month counts, live. `loads` stays null until the first
 * snapshot; a denied read sets `failed` — it is "unknown", never "empty".
 */
export function useDeskLoads(workspaceId: string | null, enabled: boolean) {
  const backend = useDeskLoadsBackend(workspaceId);
  const [loads, setLoads] = useState<DeskLoad[] | null>(null);
  const [failed, setFailed] = useState(false);
  // Снимок подтверждён сервером (а не из кэша — Firestore или снимка
  // Supabase в localStorage) — только по такому можно решать, какие столы
  // пересчитывать (useOwnerDeskRecount).
  const [synced, setSynced] = useState(false);
  // Из какого хранилища пришли `loads` — выставляется ВМЕСТЕ с ними. `backend`
  // меняется раньше: в коммите, где хранилище сменилось, `loads` ещё от
  // прежнего (сбросятся только в эффекте), и пересчёт Owner, решая по ним,
  // сверил бы стол с чужими цифрами и не записал бы его в новое хранилище.
  // И Supabase сам может уйти в Firestore (меня нет в копии прав).
  const [loadsBackend, setLoadsBackend] = useState<SbBackend | null>(null);
  useEffect(() => {
    setLoads(null);
    setFailed(false);
    setSynced(false);
    setLoadsBackend(null);
    if (!workspaceId || !enabled || !backend) return;
    return subscribeDeskLoads(
      workspaceId,
      (next, fromCache, source) => {
        loadsSource.set(next, source);
        setLoads(next);
        setLoadsBackend(source);
        setFailed(false);
        if (!fromCache) setSynced(true);
      },
      () => setFailed(true),
      backend
    );
  }, [workspaceId, enabled, backend]);
  return { loads, failed, synced, loadsBackend };
}

/**
 * Оценки, итоги оценок и график — общие подписки на вкладку, живут ещё
 * 25 минут после ухода последнего экрана. Дашборд ↔ «Технари» ↔ «Заказы»
 * иначе каждый раз заново читали бы ~60 оценок и ~80 итогов. 25 минут —
 * меньше жизни resume-токена Firestore (~30 мин): вернувшись позже, подписка
 * всё равно продолжит с кэша на диске и заплатит только за изменения.
 */
const SHARED_LINGER_MS = 25 * 60_000;
type SharedFeed<T> = { ok: true; value: T } | { ok: false };
/**
 * Отказ ломает подписку Firestore навсегда (onSnapshot сам не
 * переподключается), поэтому после отказа следующий экран получает НОВУЮ
 * подписку, а не залипший отказ (номер поколения в ключе).
 */
const sharedGeneration = new Map<string, number>();

function joinShared<T>(
  baseKey: string,
  start: (onData: (value: T) => void, onError: () => void) => () => void,
  onData: (value: T) => void,
  onError: () => void
) {
  const generation = sharedGeneration.get(baseKey) ?? 0;
  return joinSharedSubscription<SharedFeed<T>>(
    `${baseKey}#${generation}`,
    (emit) =>
      start(
        (value) => emit({ ok: true, value }),
        () => {
          if ((sharedGeneration.get(baseKey) ?? 0) === generation) sharedGeneration.set(baseKey, generation + 1);
          emit({ ok: false });
        }
      ),
    (feed) => (feed.ok ? onData(feed.value) : onError()),
    SHARED_LINGER_MS
  );
}

/**
 * Где оценки заказов этого workspace (ключ `ratings` в sbCollections):
 * Supabase `order_ratings` или откат в Firestore. `null` — документ
 * workspace ещё не пришёл.
 */
export function useRatingsBackend(workspaceId: string | null): SbBackend | null {
  const { activeWorkspace } = useWorkspace();
  const same = Boolean(workspaceId && activeWorkspace?.id === workspaceId);
  const backend = useSbBackend(same ? activeWorkspace : null, "ratings");
  if (!activeWorkspace) return null;
  return same ? backend : "firestore";
}

/**
 * Итоги оценок заказов по всем парам ОС↔Технарь — за `monthKey` и прошлый
 * месяц. Отказ в чтении — это «неизвестно», а не «оценок нет»: пустой список
 * вместо отказа показал бы всем технарям нулевой рейтинг, которого на самом
 * деле никто не ставил.
 */
export function useOrderRatingTotals(workspaceId: string | null, monthKey: string, enabled: boolean) {
  const backend = useRatingsBackend(workspaceId);
  const [totals, setTotals] = useState<OrderRatingTotals[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setTotals(null);
    setFailed(false);
    if (!workspaceId || !enabled || !backend) return;
    return joinShared<OrderRatingTotals[]>(
      `orderRatingTotals:${backend}:${workspaceId}:${monthKey}`,
      (onData, onError) => subscribeOrderRatingTotals(workspaceId, monthKey, backend, onData, onError),
      (next) => {
        setTotals(next);
        setFailed(false);
      },
      () => setFailed(true)
    );
  }, [workspaceId, monthKey, enabled, backend]);
  return { totals, failed };
}

/**
 * График на месяц. `schedules` — пустой массив и до первого снимка, и на
 * отказе, поэтому отдельно отдаём `loaded` и `failed`: «график не прочитан»
 * НЕЛЬЗЯ показывать как «у всех рабочий день» (см. «Критические уроки» в
 * CLAUDE.md). Раньше отказ так и маппился — на «Заказах» у выходных
 * открывались отклики и «Рандом», а шаблон недели на «Графике» считался от
 * пустой базы и при сохранении затирал «отпросился» и «пришёл».
 * onSnapshot после ошибки сам не переподключается — отсюда `retry`.
 */
export function useTechSchedules(workspaceId: string | null, monthKey: string, enabled: boolean) {
  const [schedules, setSchedules] = useState<TechSchedule[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setSchedules([]);
    setLoaded(false);
    setFailed(false);
    if (!workspaceId || !enabled) return;
    return joinShared<{ schedules: TechSchedule[]; fromServer: boolean }>(
      `techSchedules:${workspaceId}:${monthKey}`,
      (onData, onError) =>
        subscribeTechSchedules(workspaceId, monthKey, (next, fromServer) => onData({ schedules: next, fromServer }), onError),
      ({ schedules: next, fromServer }) => {
        setSchedules(next);
        // «Загружено» — только то, что подтвердил сервер. Снимок из кэша в
        // офлайне показываем, но править поверх него нельзя (см. сервис).
        if (fromServer) setLoaded(true);
        setFailed(false);
      },
      () => {
        setSchedules([]);
        setFailed(true);
      }
    );
  }, [workspaceId, monthKey, enabled, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { schedules, loaded, failed, retry };
}

/**
 * Сами оценки за `monthKey` и прошлый месяц: ОС — свои (балл у заказа),
 * Owner — все (подробности и снятие). `null` — ещё не пришли.
 */
export function useOrderRatings(
  workspaceId: string | null,
  scope: OrderRatingsScope | null,
  monthKey: string,
  enabled: boolean
) {
  const backend = useRatingsBackend(workspaceId);
  const [ratings, setRatings] = useState<OrderRating[] | null>(null);
  const [failed, setFailed] = useState(false);
  const scopeKey = scope ? (scope.kind === "os" ? `os:${scope.uid}` : "all") : "";
  useEffect(() => {
    setRatings(null);
    setFailed(false);
    if (!workspaceId || !enabled || !backend || !scopeKey) return;
    const current: OrderRatingsScope = scopeKey === "all" ? { kind: "all" } : { kind: "os", uid: scopeKey.slice(3) };
    return joinShared<OrderRating[]>(
      `orderRatings:${backend}:${workspaceId}:${scopeKey}:${monthKey}`,
      (onData, onError) => subscribeOrderRatings(workspaceId, current, monthKey, backend, onData, onError),
      (next) => {
        setRatings(next);
        setFailed(false);
      },
      () => setFailed(true)
    );
  }, [workspaceId, scopeKey, monthKey, enabled, backend]);
  return { ratings, failed, backend };
}

/**
 * Archived months from `fromMonthKey` on — разовое чтение при открытии (архив
 * меняется раз в месяц). Empty (not null) on a denied read — the chart just hides.
 */
export function useDeskLoadHistory(workspaceId: string | null, fromMonthKey: string, enabled: boolean) {
  const backend = useDeskLoadsBackend(workspaceId);
  const { activeWorkspace } = useWorkspace();
  // Счётчики в Firestore, а строки — в Supabase: это откат (или «SQL не
  // накатан»). Месяцы, заархивированные за время работы в Supabase, лежат
  // только там — дочитываем их (молча, если таблицы нет).
  const withSupabase =
    backend === "firestore" && activeWorkspace?.id === workspaceId && activeWorkspace?.rowsBackend === "supabase";
  const [history, setHistory] = useState<DeskLoadArchive[]>([]);
  useEffect(() => {
    setHistory([]);
    if (!workspaceId || !enabled || !backend) return;
    return subscribeDeskLoadHistory(workspaceId, fromMonthKey, setHistory, () => setHistory([]), backend, { withSupabase });
  }, [workspaceId, fromMonthKey, enabled, backend, withSupabase]);
  return history;
}

// Each desk's month tab at most this often per page load, shared by every
// screen that recounts. Keyed by the tab, so a desk the month autopilot
// rolls over while a screen is open gets counted right away.
const REFRESH_EVERY_MS = 5 * 60 * 1000;
/**
 * Стол, который недавно опубликовал счётчики САМ, пересчитывать незачем: пока
 * технарь работает, его сессия делает это живьём, а менять строки чужого
 * стола всё равно некому. Пересчёт же стоит дорого — он ЧИТАЕТ ВСЕ СТРОКИ
 * месячной вкладки каждого стола, и на бесплатном тарифе Firebase (50k чтений
 * в день) открытый весь день дашборд Owner в одиночку съедал дневную квоту:
 * 15 столов × ~100 строк каждые 5 минут — это ~18 000 чтений в час, после
 * чего в приложении перестают проходить ЛЮБЫЕ записи (resource-exhausted).
 */
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;
/**
 * Как часто пересчёт сам просыпается, пока экран открыт и на виду. Раньше он
 * запускался заново на КАЖДОЕ обновление `members` и `pages` из контекста —
 * это новые массивы на любой правке любой страницы и на каждом обновлении
 * списка участников. Теперь — по таймеру, при возвращении на вкладку и когда
 * реально поменялся набор столов или их месячные вкладки (`deskTabsKey`).
 */
const RECOUNT_TICK_MS = 15 * 60 * 1000;
const lastRefreshAt = new Map<string, number>();
/**
 * Когда строки вкладки (`pageId:subPageId`) последний раз сверили со
 * счётчиками — после КАЖДОГО пересчёта, в том числе «ничего не изменилось».
 * Без этого стол, где никто не работает, пересчитывался весь день каждые
 * 5 минут: цифры совпадали, публиковать было нечего, `updatedAt` документа
 * так и оставался старше 2 часов — и каждый следующий проход снова читал все
 * его строки (аудит квоты 22.09.2026: ~24 000 чтений в день).
 */
const verifiedAt = new Map<string, number>();
/**
 * `verifiedAt` переживает ПЕРЕЗАГРУЗКУ (localStorage): в памяти он жил до
 * первого F5 или автообновления после деплоя, и каждая новая вкладка Owner
 * снова читала все строки всех «тихих» столов — а перезагрузок в день десятки.
 * Это удобство одного браузера, не данные команды: потерялось — просто
 * пересчитаем лишний раз.
 */
const VERIFIED_KEY = "nova:desk-recount-verified";
function loadVerified() {
  if (verifiedAt.size > 0) return;
  try {
    const raw = JSON.parse(window.localStorage.getItem(VERIFIED_KEY) ?? "{}") as Record<string, number>;
    const cutoff = Date.now() - STALE_AFTER_MS;
    for (const [key, at] of Object.entries(raw)) if (Number(at) > cutoff) verifiedAt.set(key, Number(at));
  } catch {
    /* нет хранилища — живём с памятью вкладки */
  }
}
function saveVerified(key: string, at: number) {
  verifiedAt.set(key, at);
  try {
    const cutoff = Date.now() - STALE_AFTER_MS;
    const out: Record<string, number> = {};
    for (const [k, v] of verifiedAt) if (v > cutoff) out[k] = v;
    window.localStorage.setItem(VERIFIED_KEY, JSON.stringify(out));
  } catch {
    /* см. loadVerified */
  }
}

/**
 * Owner-only background recount: the Owner can read every desk, so desks
 * nobody opened lately still show the truth on «Технари» and «Дашборд».
 * Everyone else relies on the counts each desk publishes while its Технарь
 * works in it.
 */
export function useOwnerDeskRecount(loads: DeskLoad[] | null, synced = true) {
  const { activeWorkspace, activeWorkspaceId, members, pages } = useWorkspace();
  // Пересчёт пишет туда же, откуда читают экраны: `loads` пришли из того же
  // хранилища (useDeskLoads), и стол, которого там нет или он старше порога,
  // считается устаревшим — так Supabase после включения заполняется сам.
  const backend = useDeskLoadsBackend(activeWorkspaceId);
  const permissions = usePermissions();
  const { profile } = useAuth();
  const monthKey = useCurrentPeriodKey();
  const isOwner = permissions.upkeepOwner;
  const uid = profile?.uid ?? "";
  const loadsRef = useRef(loads);
  loadsRef.current = loads;
  const optionsRef = useRef(activeWorkspace?.responsibleOptions ?? []);
  optionsRef.current = activeWorkspace?.responsibleOptions ?? [];
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const membersRef = useRef(members);
  membersRef.current = members;
  // Только по снимку с СЕРВЕРА: кэш мог быть двухчасовой давности, и тогда
  // «устарели» оказались бы все столы разом (полный пересчёт). И только по
  // снимку ТОГО ЖЕ хранилища, куда пишем (см. loadsBackend в useDeskLoads).
  const loadsBackend = loads ? loadsSource.get(loads) ?? null : null;
  const loadsReady = loads !== null && synced && loadsBackend === backend;
  // Какие столы месячные и на какой они вкладке — одной строкой. Меняется,
  // только когда столов стало больше/меньше, участники догрузились или
  // автопилот перевёл стол на новую вкладку, — тогда пересчитываем сразу,
  // не дожидаясь таймера.
  const deskTabsKey = useMemo(
    () =>
      pages
        .filter((p) => isMonthlyDesk(p, members))
        .map((p) => `${p.id}:${currentMonthSubPageId(p, monthKey) ?? ""}`)
        .join("|"),
    [pages, members, monthKey]
  );

  useEffect(() => {
    if (!isOwner || !activeWorkspaceId || !uid || !loadsReady || !backend) return;
    const recount = () => {
      loadVerified();
      const startedAt = Date.now();
      const desks: { page: WorkspacePage; key: string }[] = [];
      for (const p of pagesRef.current) {
        const subPageId = currentMonthSubPageId(p, monthKey);
        if (!subPageId || !isMonthlyDesk(p, membersRef.current)) continue;
        // Сверка своя у каждого хранилища: стол, сверенный с Firestore, в
        // Supabase ещё пуст, и память Firestore не должна его там закрывать.
        const key = backend === "supabase" ? `sb:${p.id}:${subPageId}` : `${p.id}:${subPageId}`;
        if (startedAt - (lastRefreshAt.get(key) ?? 0) < REFRESH_EVERY_MS) continue;
        // Свежие счётчики этой же вкладки — читать строки не надо. Свежесть —
        // по последней публикации ИЛИ нашей последней сверке, что позже. Нет
        // документа или он про другую вкладку (сменился месяц) — в счёт идёт
        // только сверка этой вкладки; давно не сверяли — пересчитываем.
        const published = loadsRef.current?.find((l) => l.pageId === p.id);
        // Подмешанный из Firestore (в Supabase стола ещё нет) — устаревший:
        // пересчёт и заполняет Supabase.
        const publishedAt =
          published && published.subPageId === subPageId && !published.sbFallback ? published.updatedAt ?? 0 : 0;
        if (startedAt - Math.max(publishedAt, verifiedAt.get(key) ?? 0) < STALE_AFTER_MS) continue;
        lastRefreshAt.set(key, startedAt);
        desks.push({ page: p, key });
      }
      if (desks.length === 0) return;
      void (async () => {
        for (let i = 0; i < desks.length; i += 3) {
          await Promise.all(
            desks.slice(i, i + 3).map(async ({ page: desk, key }) => {
              const checkedAt = Date.now();
              try {
                await refreshDeskLoadFromRows(
                  desk,
                  monthKey,
                  uid,
                  loadsRef.current?.find((l) => l.pageId === desk.id),
                  optionsRef.current,
                  backend
                );
                // Опубликовал он или цифры и так совпали — строки на этот
                // момент сверены. Ошибка (например, та же квота) сверкой не
                // считается: повторим не раньше, чем через REFRESH_EVERY_MS.
                saveVerified(key, checkedAt);
              } catch (error) {
                console.warn(`Не удалось пересчитать стол ${desk.id}:`, error);
              }
            })
          );
        }
      })();
    };
    recount();
    // Свёрнутая вкладка по таймеру не пересчитывает — догонит, когда на неё
    // вернутся (как usePolledData).
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") recount();
    }, RECOUNT_TICK_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") recount();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [isOwner, activeWorkspaceId, uid, loadsReady, monthKey, deskTabsKey, backend]);
}
