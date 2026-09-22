import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentMonthKey } from "@/hooks/useCurrentMonthKey";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { refreshDeskLoadFromRows, subscribeDeskLoadHistory, subscribeDeskLoads } from "@/services/deskLoadService";
import { currentMonthSubPageId, isMonthlyDesk } from "@/services/monthTabService";
import { subscribeMyOrderRatings, subscribeOrderRatingTotals } from "@/services/orderRatingService";
import { subscribeTechRatings } from "@/services/techRatingService";
import { subscribeTechSchedules } from "@/services/techScheduleService";
import type {
  DeskLoad,
  DeskLoadArchive,
  OrderRating,
  OrderRatingTotals,
  TechRating,
  TechSchedule,
  WorkspacePage,
} from "@/types";

/**
 * Every desk's month counts, live. `loads` stays null until the first
 * snapshot; a denied read sets `failed` — it is "unknown", never "empty".
 */
export function useDeskLoads(workspaceId: string | null, enabled: boolean) {
  const [loads, setLoads] = useState<DeskLoad[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setLoads(null);
    setFailed(false);
    if (!workspaceId || !enabled) return;
    return subscribeDeskLoads(
      workspaceId,
      (next) => {
        setLoads(next);
        setFailed(false);
      },
      () => setFailed(true)
    );
  }, [workspaceId, enabled]);
  return { loads, failed };
}

/**
 * ОС-оценки технарей за `monthKey` и прошлый месяц, live — больше ни один
 * экран не показывает (см. subscribeTechRatings).
 */
export function useTechRatings(workspaceId: string | null, monthKey: string, enabled: boolean) {
  const [ratings, setRatings] = useState<TechRating[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setRatings(null);
    setFailed(false);
    if (!workspaceId || !enabled) return;
    return subscribeTechRatings(
      workspaceId,
      monthKey,
      (next) => {
        setRatings(next);
        setFailed(false);
      },
      () => setFailed(true)
    );
  }, [workspaceId, monthKey, enabled]);
  return { ratings, failed };
}

/**
 * Итоги оценок за заказы по всем парам ОС↔Технарь — за `monthKey` и прошлый
 * месяц. Отказ в чтении — это «неизвестно», а не «оценок нет»: пустой список
 * вместо отказа показал бы всем технарям нулевой рейтинг, которого на самом
 * деле никто не ставил.
 */
export function useOrderRatingTotals(workspaceId: string | null, monthKey: string, enabled: boolean) {
  const [totals, setTotals] = useState<OrderRatingTotals[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setTotals(null);
    setFailed(false);
    if (!workspaceId || !enabled) return;
    return subscribeOrderRatingTotals(
      workspaceId,
      monthKey,
      (next) => {
        setTotals(next);
        setFailed(false);
      },
      () => setFailed(true)
    );
  }, [workspaceId, monthKey, enabled]);
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
    return subscribeTechSchedules(
      workspaceId,
      monthKey,
      (next, fromServer) => {
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

/** Оценки заказов за `monthKey`, которые поставил САМ смотрящий ОС — чтобы показать их в «Мои заказы». */
export function useMyOrderRatings(workspaceId: string | null, osUid: string, monthKey: string, enabled: boolean) {
  const [ratings, setRatings] = useState<OrderRating[]>([]);
  useEffect(() => {
    setRatings([]);
    if (!workspaceId || !osUid || !enabled) return;
    return subscribeMyOrderRatings(workspaceId, osUid, monthKey, setRatings, () => setRatings([]));
  }, [workspaceId, osUid, monthKey, enabled]);
  return ratings;
}

/** Archived months from `fromMonthKey` on. Empty (not null) on a denied read — the chart just hides. */
export function useDeskLoadHistory(workspaceId: string | null, fromMonthKey: string, enabled: boolean) {
  const [history, setHistory] = useState<DeskLoadArchive[]>([]);
  useEffect(() => {
    setHistory([]);
    if (!workspaceId || !enabled) return;
    return subscribeDeskLoadHistory(workspaceId, fromMonthKey, setHistory, () => setHistory([]));
  }, [workspaceId, fromMonthKey, enabled]);
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
 * Owner-only background recount: the Owner can read every desk, so desks
 * nobody opened lately still show the truth on «Технари» and «Дашборд».
 * Everyone else relies on the counts each desk publishes while its Технарь
 * works in it.
 */
export function useOwnerDeskRecount(loads: DeskLoad[] | null) {
  const { activeWorkspace, activeWorkspaceId, members, pages } = useWorkspace();
  const permissions = usePermissions();
  const { profile } = useAuth();
  const monthKey = useCurrentMonthKey();
  const isOwner = permissions.hasFullDeskAccess;
  const uid = profile?.uid ?? "";
  const loadsRef = useRef(loads);
  loadsRef.current = loads;
  const optionsRef = useRef(activeWorkspace?.responsibleOptions ?? []);
  optionsRef.current = activeWorkspace?.responsibleOptions ?? [];
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const membersRef = useRef(members);
  membersRef.current = members;
  const loadsReady = loads !== null;
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
    if (!isOwner || !activeWorkspaceId || !uid || !loadsReady) return;
    const recount = () => {
      const startedAt = Date.now();
      const desks: { page: WorkspacePage; key: string }[] = [];
      for (const p of pagesRef.current) {
        const subPageId = currentMonthSubPageId(p, monthKey);
        if (!subPageId || !isMonthlyDesk(p, membersRef.current)) continue;
        const key = `${p.id}:${subPageId}`;
        if (startedAt - (lastRefreshAt.get(key) ?? 0) < REFRESH_EVERY_MS) continue;
        // Свежие счётчики этой же вкладки — читать строки не надо. Свежесть —
        // по последней публикации ИЛИ нашей последней сверке, что позже. Нет
        // документа или он про другую вкладку (сменился месяц) — в счёт идёт
        // только сверка этой вкладки; давно не сверяли — пересчитываем.
        const published = loadsRef.current?.find((l) => l.pageId === p.id);
        const publishedAt = published && published.subPageId === subPageId ? published.updatedAt ?? 0 : 0;
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
                  optionsRef.current
                );
                // Опубликовал он или цифры и так совпали — строки на этот
                // момент сверены. Ошибка (например, та же квота) сверкой не
                // считается: повторим не раньше, чем через REFRESH_EVERY_MS.
                verifiedAt.set(key, checkedAt);
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
  }, [isOwner, activeWorkspaceId, uid, loadsReady, monthKey, deskTabsKey]);
}
