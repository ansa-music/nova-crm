import { useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentMonthKey } from "@/hooks/useCurrentMonthKey";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  deskLoadSignatureKey,
  forgetPublishedSignature,
  isPublishedSignature,
  osOrdersSignatureKey,
  publishDeskLoad,
  rememberPublishedSignature,
} from "@/services/deskLoadService";
import { sendNotification } from "@/services/notificationService";
import { publishOsOrders } from "@/services/osOrdersService";
import { DEFAULT_STATUS_OPTIONS } from "@/utils/columnOptions";
import { myDisplayName } from "@/utils/displayName";
import { collectOsOrders, countDeskLoad, deskLoadSignature, osOrdersSignature } from "@/utils/techLoad";
import type { OsOrderItem, PageRow, StatusOption, SubPage, WorkspacePage } from "@/types";

const NO_OPTIONS: StatusOption[] = [];

/**
 * Сколько цифры должны простоять без изменений, прежде чем уйти в базу.
 * Было 1,5 с — и каждая пачка правок за столом (поменял статус, поправил,
 * вернул) давала по записи в deskLoad и в каждый затронутый osOrders; аудит
 * квоты 22.09.2026 насчитал на этом ~2 500 записей в день. ОС всё равно не
 * успевает переключиться на «Технари» быстрее десяти секунд.
 */
const PUBLISH_DEBOUNCE_MS = 10_000;
/**
 * Уходя со стола (размонтирование, закрытие вкладки, переход на другую
 * вкладку/стол) отложенную публикацию дописываем сразу, а не выбрасываем —
 * иначе с паузой в 10 с терялись бы последние правки. Но только если стол к
 * этому моменту был открыт хотя бы 1,5 с (прежняя пауза): сразу после
 * открытия снимок из кэша бывает пустым, и такой миг нельзя отправить ОС как
 * «0 заказов».
 */
const MIN_SETTLED_MS = 1500;

/** One publish waiting out PUBLISH_DEBOUNCE_MS. */
type PendingPublish = {
  /** `${pageId}:${subPageId}` the data was counted from. */
  target: string;
  signature: string;
  /** Since when the desk has been open with rows loaded (for MIN_SETTLED_MS). */
  liveSince: number;
  timer: number;
  run: () => void;
};
type PendingSlot = { current: PendingPublish | null };

function cancelPending(slot: PendingSlot) {
  const pending = slot.current;
  if (!pending) return;
  slot.current = null;
  window.clearTimeout(pending.timer);
}

/**
 * Свернули вкладку: дописать сразу — только на тач-устройствах и только
 * «устоявшееся» (MIN_SETTLED_MS). На телефоне свёрнутый браузер замораживает
 * таймеры (а pagehide часто не шлёт вовсе), и запись иначе ждала бы
 * следующего открытия. На десктопе 10-секундный таймер в фоновой вкладке
 * работает, и сброс на каждое переключение вкладки (переписал из WhatsApp —
 * вернулся — дописал) писал бы промежуточное состояние по разу на переход.
 * Молодую запись не выбрасываем, как на уходе со стола, а оставляем в очереди.
 */
function flushSettledOnHide(slot: PendingSlot) {
  const pending = slot.current;
  if (!pending || Date.now() - pending.liveSince < MIN_SETTLED_MS) return;
  flushPending(slot);
}

function isTouchDevice(): boolean {
  try {
    return window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

function flushPending(slot: PendingSlot) {
  const pending = slot.current;
  if (!pending) return;
  slot.current = null;
  window.clearTimeout(pending.timer);
  if (Date.now() - pending.liveSince >= MIN_SETTLED_MS) pending.run();
}

/**
 * Trailing debounce keyed by the signature: data with the SAME signature
 * only refreshes the payload and doesn't push the timer back — otherwise
 * every rows snapshot (other cells being typed) would postpone the publish
 * indefinitely. A pending publish of another desk/tab is flushed first.
 */
function schedulePending(slot: PendingSlot, target: string, signature: string, liveSince: number, run: () => void) {
  const current = slot.current;
  if (current && current.target === target && current.signature === signature) {
    current.run = run;
    return;
  }
  if (current && current.target !== target) flushPending(slot);
  else cancelPending(slot);
  const pending: PendingPublish = { target, signature, liveSince, timer: 0, run };
  pending.timer = window.setTimeout(() => {
    if (slot.current !== pending) return;
    slot.current = null;
    pending.run();
  }, PUBLISH_DEBOUNCE_MS);
  slot.current = pending;
}

/** What each order looked like at the last publish — to tell the ОС what changed. */
type OrderSnapshot = { pageId: string; subPageId: string; byRow: Map<string, { status: string; title: string; os: string[] }> };

/**
 * Keeps «Технари» current from the desk itself: while this month's tab is
 * open with its rows loaded, every change to the order counts is published
 * as the desk's DeskLoad, and each ОС's own order list as their OsOrders.
 * Nothing is written when the numbers didn't change — and "didn't change"
 * is remembered per browser (localStorage, see deskLoadService), so a
 * remount, a second tab or the Owner opening the desk doesn't rewrite the
 * same numbers. Debounced (PUBLISH_DEBOUNCE_MS) — a snapshot can briefly
 * come back empty from cache before the real rows, and that blip must not
 * reach the ОС as «0 заказов»; a pending publish is flushed on leaving the
 * desk (MIN_SETTLED_MS).
 *
 * When a published order's status changes, the ОС who gave it gets a
 * notification — from this session's baseline on, never on first load.
 */
export function useDeskLoadPublisher({
  page,
  subPage,
  rows,
  rowsLoading,
  rowsFromServer,
  canEdit,
  uid,
  responsibleOptions = NO_OPTIONS,
}: {
  page: WorkspacePage | null;
  subPage: SubPage | null;
  rows: PageRow[];
  rowsLoading: boolean;
  /**
   * Строки подтверждены сервером (useSyncedTableRows.serverSynced). По кэшу
   * НЕ считаем и не ставим в очередь: с LRU-кэшем повторное открытие стола
   * сначала отдаёт строки прошлого визита, и отложенная запись (таймер или
   * уход со стола до ответа сервера) затирала бы свежие счётчики, которые
   * записал сам технарь с телефона, — а пересчёт Owner по свежему updatedAt
   * два часа такой стол не трогает.
   */
  rowsFromServer: boolean;
  canEdit: boolean;
  uid: string;
  /** Shared «Ответственный» list — resolves ОС columns to option values. */
  responsibleOptions?: StatusOption[];
}) {
  const monthKey = useCurrentMonthKey();
  const { members, activeWorkspace, allPages } = useWorkspace();
  const { profile } = useAuth();
  const lastSignatureRef = useRef("");
  const lastOsSignaturesRef = useRef(new Map<string, string>());
  /** All ОС lists as of the last fired publish — the notification baseline moves only then. */
  const lastOsFiredRef = useRef("");
  const lastOrdersRef = useRef<OrderSnapshot | null>(null);
  const pendingDeskRef = useRef<PendingPublish | null>(null);
  const pendingOsRef = useRef<PendingPublish | null>(null);
  const liveSinceRef = useRef(0);

  const isMonthTab = Boolean(
    page?.responsibleUserId &&
      subPage &&
      page.autoMonthKey === monthKey &&
      page.autoMonthSubPageId === subPage.id
  );
  const active = isMonthTab && canEdit && !rowsLoading && rowsFromServer && Boolean(uid);

  const counts = useMemo(
    () => (active && subPage ? countDeskLoad(subPage.columns, rows, responsibleOptions, monthKey) : null),
    [active, subPage, rows, responsibleOptions, monthKey]
  );
  const osOrders = useMemo(
    () => (active && subPage ? collectOsOrders(subPage.columns, rows, responsibleOptions) : null),
    [active, subPage, rows, responsibleOptions]
  );

  const pageId = page?.id;
  const pageName = page?.name ?? "";
  const workspaceId = page?.workspaceId;
  const responsibleUserId = page?.responsibleUserId;
  const subPageId = subPage?.id;
  const statusOptions = activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS;
  const membersRef = useRef(members);
  membersRef.current = members;
  const fromName = myDisplayName(profile, members);
  const liveTabRef = useRef({ page, allPages, monthKey });
  liveTabRef.current = { page, allPages, monthKey };

  /**
   * Отложенная публикация уходит через 10 с или при уходе со стола — к этому
   * моменту месяц мог смениться, а автопилот перевести стол на новую
   * вкладку. Старые цифры тогда не пишем: первая публикация прежнего месяца
   * поверх нового ещё и отправила бы новый месяц в архив (deskLoadHistory).
   */
  /**
   * `atSchedule` — стол, каким он был, когда запись поставили в очередь: стол,
   * открытый по ссылке, в сторе может и не лежать, и после перехода на другой
   * стол отложенную запись иначе выбросило бы вместо того, чтобы дописать.
   */
  function stillMonthTab(
    targetPageId: string,
    targetSubPageId: string,
    targetMonthKey: string,
    atSchedule?: { id: string; autoMonthKey?: string; autoMonthSubPageId?: string } | null
  ): boolean {
    const now = liveTabRef.current;
    if (now.monthKey !== targetMonthKey) return false;
    const live =
      (now.page?.id === targetPageId ? now.page : now.allPages.find((p) => p.id === targetPageId)) ??
      (atSchedule?.id === targetPageId ? atSchedule : null);
    return Boolean(live && live.autoMonthKey === targetMonthKey && live.autoMonthSubPageId === targetSubPageId);
  }

  // Память браузера «уже записал» спрашиваем только для ПЕРВОГО расчёта после
  // открытия стола (повторное открытие, вторая вкладка, Owner заглянул) —
  // дальше в сессии сравниваем со своим последним расчётом, а совпадения с
  // сервером отсекает транзакция publishDeskLoad (1 чтение, без записи).
  // Иначе чужая более свежая запись навсегда оставалась бы в базе, стоило
  // цифрам этого браузера совпасть с тем, что он писал когда-то.
  const trustDeskMemoryRef = useRef(true);
  const trustOsMemoryRef = useRef(true);
  useEffect(() => {
    trustDeskMemoryRef.current = true;
    trustOsMemoryRef.current = true;
  }, [pageId, subPageId]);

  // С какого момента стол открыт с загруженными строками — для MIN_SETTLED_MS.
  // Объявлен раньше эффектов публикации: в одном коммите он срабатывает первым.
  useEffect(() => {
    liveSinceRef.current = active && pageId && subPageId ? Date.now() : 0;
  }, [active, pageId, subPageId]);

  // Ушли со стола или закрыли вкладку — дописать отложенное, а не выбросить.
  // Телефон, свернув браузер, pagehide часто не шлёт вовсе — только
  // `visibilitychange` → hidden, после чего таймеры стоят; страница в этот
  // момент ещё жива, и транзакция deskLoad (ей сначала нужен ответ сервера)
  // успевает пройти. См. flushSettledOnHide.
  useEffect(() => {
    const flushAll = () => {
      flushPending(pendingDeskRef);
      flushPending(pendingOsRef);
    };
    const onVisibility = () => {
      if (document.visibilityState !== "hidden" || !isTouchDevice()) return;
      flushSettledOnHide(pendingDeskRef);
      flushSettledOnHide(pendingOsRef);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flushAll);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flushAll);
      flushAll();
    };
  }, []);

  useEffect(() => {
    if (!counts || !pageId || !workspaceId || !responsibleUserId || !subPageId) return;
    const target = `${pageId}:${subPageId}`;
    const memoryKey = deskLoadSignatureKey(pageId, subPageId);
    const signature = deskLoadSignature({ ...counts, subPageId, monthKey, responsibleUserId });
    const trustMemory = trustDeskMemoryRef.current;
    trustDeskMemoryRef.current = false;
    if (signature === lastSignatureRef.current || (trustMemory && isPublishedSignature(memoryKey, signature))) {
      // Цифры снова такие, какие уже в базе, — промежуточное состояние этого
      // же стола писать незачем. Совпадение с памятью браузера запоминаем
      // как «последнее записанное»: иначе второй такой же расчёт (строки
      // приходят снимками, Supabase догоняет) уже без доверия к памяти
      // поставил бы ту же запись в очередь.
      lastSignatureRef.current = signature;
      if (pendingDeskRef.current?.target === target) cancelPending(pendingDeskRef);
      return;
    }
    const load = {
      pageId,
      workspaceId,
      responsibleUserId,
      monthKey,
      subPageId,
      total: counts.total,
      statusCounts: counts.statusCounts,
      osCounts: counts.osCounts,
      osStatusCounts: counts.osStatusCounts,
      osLastOrderAt: counts.osLastOrderAt,
      grandTotal: counts.grandTotal,
      statusSums: counts.statusSums,
      dayCounts: counts.dayCounts,
      daySums: counts.daySums,
      updatedBy: uid,
    };
    const pageAtSchedule = liveTabRef.current.page?.id === pageId ? liveTabRef.current.page : null;
    schedulePending(pendingDeskRef, target, signature, liveSinceRef.current, () => {
      if (!stillMonthTab(pageId, subPageId, monthKey, pageAtSchedule)) return;
      lastSignatureRef.current = signature;
      publishDeskLoad(load).then(
        // Помним только то, что принял сервер: вкладку закрывают посреди
        // записи (pagehide), и «запомненная», но не дошедшая запись осталась
        // бы в базе старой — следующее открытие стола её бы уже не повторило.
        () => rememberPublishedSignature(memoryKey, signature),
        (error) => {
          lastSignatureRef.current = "";
          forgetPublishedSignature(memoryKey, signature);
          console.warn(`Не удалось обновить загрузку стола ${pageId}:`, error);
        }
      );
    });
  }, [counts, pageId, workspaceId, responsibleUserId, subPageId, monthKey, uid]);

  useEffect(() => {
    if (!osOrders || !pageId || !workspaceId || !responsibleUserId || !subPageId) return;
    const target = `${pageId}:${subPageId}`;
    const lists = Object.entries(osOrders).map(([osValue, orders]) => ({
      osValue,
      orders,
      signature: osOrdersSignature(orders, subPageId, monthKey, responsibleUserId),
    }));
    const signature = JSON.stringify(lists.map((l) => [l.osValue, l.signature]));
    if (signature === lastOsFiredRef.current) {
      if (pendingOsRef.current?.target === target) cancelPending(pendingOsRef);
      return;
    }
    // Память браузера — только для первого расчёта после открытия стола, и
    // спрашиваем её СРАЗУ, а не в отложенной записи: второй расчёт в те же
    // 10 с подменяет запись в очереди, и доверие первого расчёта терялось —
    // каждое открытие стола переписывало все списки ОС. Подтверждённое
    // памятью кладём в «уже записано» этой сессии.
    if (trustOsMemoryRef.current) {
      trustOsMemoryRef.current = false;
      for (const { osValue, signature: listSignature } of lists) {
        if (isPublishedSignature(osOrdersSignatureKey(pageId, osValue), listSignature)) {
          lastOsSignaturesRef.current.set(`${pageId}:${osValue}`, listSignature);
        }
      }
    }
    const pageAtScheduleOs = liveTabRef.current.page?.id === pageId ? liveTabRef.current.page : null;
    schedulePending(pendingOsRef, target, signature, liveSinceRef.current, () => {
      if (!stillMonthTab(pageId, subPageId, monthKey, pageAtScheduleOs)) return;
      lastOsFiredRef.current = signature;
      for (const { osValue, orders, signature: listSignature } of lists) {
        const key = `${pageId}:${osValue}`;
        if (lastOsSignaturesRef.current.get(key) === listSignature) continue;
        lastOsSignaturesRef.current.set(key, listSignature);
        const memoryKey = osOrdersSignatureKey(pageId, osValue);
        publishOsOrders({ pageId, workspaceId, responsibleUserId, osValue, monthKey, subPageId, orders, updatedBy: uid }).then(
          () => rememberPublishedSignature(memoryKey, listSignature),
          (error) => {
            lastOsSignaturesRef.current.delete(key);
            forgetPublishedSignature(memoryKey, listSignature);
            // Следующий же снимок строк повторит запись, как и раньше.
            lastOsFiredRef.current = "";
            console.warn(`Не удалось обновить заказы ОС на столе ${pageId}:`, error);
          }
        );
      }
      notifyStatusChanges(osOrders);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [osOrders, pageId, workspaceId, responsibleUserId, subPageId, monthKey, uid]);

  function statusLabel(raw: string) {
    if (!raw) return "без статуса";
    return statusOptions.find((o) => o.value === raw)?.label ?? raw;
  }

  function notifyStatusChanges(current: Record<string, OsOrderItem[]>) {
    if (!pageId || !workspaceId || !subPageId) return;
    const byRow = new Map<string, { status: string; title: string; os: string[] }>();
    for (const [osValue, orders] of Object.entries(current)) {
      for (const order of orders) {
        const entry = byRow.get(order.rowId) ?? { status: order.status, title: order.title, os: [] };
        entry.os.push(osValue);
        byRow.set(order.rowId, entry);
      }
    }
    const previous = lastOrdersRef.current;
    lastOrdersRef.current = { pageId, subPageId, byRow };
    if (!previous || previous.pageId !== pageId || previous.subPageId !== subPageId) return;

    const linesByOs = new Map<string, string[]>();
    for (const [rowId, now] of byRow) {
      const before = previous.byRow.get(rowId);
      if (!before || before.status === now.status) continue;
      const line = `«${now.title || "Без названия"}»: ${statusLabel(before.status)} → ${statusLabel(now.status)}`;
      for (const os of now.os) {
        if (!before.os.includes(os)) continue;
        const lines = linesByOs.get(os) ?? [];
        lines.push(line);
        linesByOs.set(os, lines);
      }
    }
    for (const [osValue, lines] of linesByOs) {
      const targets = membersRef.current
        .filter((m) => m.status === "active" && m.osNickValue === osValue && m.uid && m.uid !== uid)
        .map((m) => m.uid);
      if (targets.length === 0) continue;
      sendNotification(
        {
          workspaceId,
          title: lines.length === 1 ? `Статус вашего заказа · ${pageName}` : `${lines.length} заказа сменили статус · ${pageName}`,
          body: lines.slice(0, 6).join("\n") + (lines.length > 6 ? `\n…и ещё ${lines.length - 6}` : ""),
          priority: "normal",
          fromUid: uid,
          fromName,
          target: "selected",
          selectedUids: targets,
          pageId,
          href: "/technicians",
        },
        targets
      ).catch((error) => console.warn("Не удалось уведомить ОС о смене статуса:", error));
    }
  }
}
