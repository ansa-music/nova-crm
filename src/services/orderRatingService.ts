import { onSnapshot, query, runTransaction, where, type DocumentData, type FirestoreError } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { getDocsResumable, paths, withErrorReporting } from "@/firebase/firestore";
import { supabaseRows } from "@/lib/supabaseRows";
import { previousMonthKey } from "@/services/monthTabService";
import { isSbMissingError, markSbTableMissing, markSbTablePresent, type SbBackend } from "@/services/sb/sbCollections";
import { listenTopic, ringTopic } from "@/services/sb/topicDoorbell";
import type { OrderRating, OrderRatingTotals } from "@/types";

/**
 * Оценка заказа, 1–10 — одна система (25.09.2026).
 *
 * Где лежит — ключ `ratings` в sbCollections (`useSbBackend(ws, "ratings")`):
 *  • Supabase — таблица `order_ratings`, пишет ТОЛЬКО `rate_order()`: право
 *    «это мой заказ» база проверяет по самой строке заказа в desk_rows
 *    (заказ ведёт этот ОС или в столбце ОС стоит его ник). Квоты Firestore
 *    это не тратит — 25.09 ОС не могли оценить именно из-за неё;
 *  • Firestore — откат, пока SQL не вставлен (или строки не в Supabase):
 *    прежние `orderRatings` + `orderRatingTotals` с полем `score` (1–10) и
 *    `scale: 10` у итогов. Старые документы (`stars` 1–5, итоги без
 *    `scale`) читаются ×2 — средний балл не прыгает от смены шкалы.
 * В режиме Supabase старые оценки Firestore этого и прошлого месяца
 * подмешиваются (разово): иначе всё, что поставили до переезда, пропало бы.
 */

export function orderRatingId(pageId: string, rowId: string) {
  return `${pageId}_${rowId}`;
}

function orderRatingTotalsId(osUid: string, technicianUid: string, monthKey: string) {
  return `${osUid}_${technicianUid}_${monthKey}`;
}

const ratingsTopic = (workspaceId: string) => `nova:${workspaceId}:ratings`;

/** Балл в 1–10; старые 1–5 из Firestore — ×2. */
function clampScore(value: number) {
  return Math.max(1, Math.min(10, Math.round(value)));
}

function fsRatingOf(id: string, data: DocumentData): OrderRating | null {
  const score =
    typeof data.score === "number" ? data.score : typeof data.stars === "number" ? data.stars * 2 : null;
  if (score === null) return null;
  return {
    id: orderRatingId(String(data.pageId ?? ""), String(data.rowId ?? "")) || id,
    workspaceId: String(data.workspaceId ?? ""),
    pageId: String(data.pageId ?? ""),
    tabId: String(data.tabId ?? ""),
    rowId: String(data.rowId ?? ""),
    osUid: String(data.osUid ?? ""),
    osValue: String(data.osValue ?? ""),
    technicianUid: String(data.technicianUid ?? ""),
    score: clampScore(score),
    monthKey: String(data.monthKey ?? ""),
    title: String(data.title ?? ""),
    createdAt: Number(data.createdAt ?? 0),
    updatedAt: Number(data.updatedAt ?? 0),
    source: "firestore",
  };
}

function fsTotalsOf(id: string, data: DocumentData): OrderRatingTotals {
  const count = Number(data.count ?? 0);
  const sum = Number(data.sum ?? 0);
  return {
    id,
    osUid: String(data.osUid ?? ""),
    technicianUid: String(data.technicianUid ?? ""),
    monthKey: String(data.monthKey ?? ""),
    count,
    sum: data.scale === 10 ? sum : sum * 2,
  };
}

interface SbRatingRow {
  workspace_id: string;
  page_id: string;
  tab_id: string;
  row_id: string;
  os_uid: string;
  os_value: string;
  tech_uid: string;
  score: number;
  month_key: string;
  title: string;
  created_at: number;
  updated_at: number;
}

function sbRatingOf(row: SbRatingRow): OrderRating {
  return {
    id: orderRatingId(row.page_id, row.row_id),
    workspaceId: row.workspace_id,
    pageId: row.page_id,
    tabId: row.tab_id ?? "",
    rowId: row.row_id,
    osUid: row.os_uid,
    osValue: row.os_value ?? "",
    technicianUid: row.tech_uid,
    score: clampScore(Number(row.score)),
    monthKey: row.month_key,
    title: row.title ?? "",
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
    source: "supabase",
  };
}

/** Оценки из Supabase побеждают старые из Firestore на том же заказе. */
function mergeRatings(sb: OrderRating[], fs: OrderRating[]): OrderRating[] {
  const byId = new Map<string, OrderRating>();
  for (const r of fs) byId.set(r.id, r);
  for (const r of sb) byId.set(r.id, r);
  return [...byId.values()];
}

// ---------------------------------------------------------------------
// Живость Supabase: звонок после своей записи + опрос раз в минуту на виду.
// ---------------------------------------------------------------------
const POLL_MS = 60_000;

function liveSupabase(workspaceId: string, refetch: () => void): () => void {
  // Звонок = кто-то оценил. Его запись могла снять и старую оценку из
  // Firestore — память старых дочитываем заново, иначе заказ посчитался бы
  // дважды (в Supabase и в памяти).
  const stopRing = listenTopic(ratingsTopic(workspaceId), () => {
    dropLegacyCache(workspaceId);
    refetch();
  });
  const timer = window.setInterval(() => {
    if (document.visibilityState === "visible") refetch();
  }, POLL_MS);
  const onVisible = () => {
    if (document.visibilityState === "visible") refetch();
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    stopRing();
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

/** Старые оценки/итоги Firestore — разово, память на вкладку 15 минут. */
const LEGACY_TTL_MS = 15 * 60_000;
const legacyCache = new Map<string, { at: number; value: Promise<unknown> }>();

function dropLegacyCache(workspaceId: string) {
  for (const key of [...legacyCache.keys()]) {
    if (key.includes(`:${workspaceId}:`)) legacyCache.delete(key);
  }
}

function legacyOnce<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = legacyCache.get(key);
  if (hit && Date.now() - hit.at < LEGACY_TTL_MS) return hit.value as Promise<T>;
  const value = load().catch(() => {
    legacyCache.delete(key);
    return [] as unknown as T;
  });
  legacyCache.set(key, { at: Date.now(), value });
  return value;
}

function monthsOf(monthKey: string) {
  return [previousMonthKey(monthKey), monthKey];
}

// ---------------------------------------------------------------------
// Итоги — всем участникам.
// ---------------------------------------------------------------------

function subscribeTotalsFirestore(
  workspaceId: string,
  monthKey: string,
  onData: (totals: OrderRatingTotals[]) => void,
  onError?: (error: FirestoreError) => void
) {
  if (!db) {
    onData([]);
    return () => {};
  }
  return onSnapshot(
    query(paths.orderRatingTotalsAll(workspaceId), where("monthKey", "in", monthsOf(monthKey))),
    (snapshot) => onData(snapshot.docs.map((d) => fsTotalsOf(d.id, d.data()))),
    withErrorReporting(onError)
  );
}

function legacyTotals(workspaceId: string, monthKey: string): Promise<OrderRatingTotals[]> {
  if (!db) return Promise.resolve([]);
  return legacyOnce(`totals:${workspaceId}:${monthKey}`, async () => {
    const snap = await getDocsResumable(
      query(paths.orderRatingTotalsAll(workspaceId), where("monthKey", "in", monthsOf(monthKey)))
    );
    return snap.docs.map((d) => fsTotalsOf(d.id, d.data()));
  });
}

/**
 * Итоги за `monthKey` и прошлый месяц (карточка «итог прошлого месяца»).
 * Отказ — `onError` («неизвестно»), а не пустой список: нули у всех
 * технарей выглядели бы как настоящие оценки.
 */
export function subscribeOrderRatingTotals(
  workspaceId: string,
  monthKey: string,
  backend: SbBackend,
  onData: (totals: OrderRatingTotals[]) => void,
  onError?: (error: unknown) => void
): () => void {
  if (backend === "firestore") return subscribeTotalsFirestore(workspaceId, monthKey, onData, onError);
  let cancelled = false;
  let fallback: (() => void) | null = null;
  let running = false;
  let again = false;
  const refetch = async () => {
    if (cancelled || fallback) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      const [{ data, error }, legacy] = await Promise.all([
        supabaseRows.rpc("order_rating_totals", { p_workspace: workspaceId, p_months: monthsOf(monthKey) }),
        legacyTotals(workspaceId, monthKey),
      ]);
      if (cancelled) return;
      if (error) {
        if (isSbMissingError(error)) {
          markSbTableMissing("ratings");
          stopLive();
          fallback = subscribeTotalsFirestore(workspaceId, monthKey, onData, onError);
          return;
        }
        onError?.(error);
        return;
      }
      markSbTablePresent("ratings");
      const rows = (Array.isArray(data) ? data : []) as {
        os_uid: string;
        tech_uid: string;
        month_key: string;
        cnt: number;
        total: number;
      }[];
      const fresh: OrderRatingTotals[] = rows.map((r) => ({
        id: `sb:${orderRatingTotalsId(r.os_uid, r.tech_uid, r.month_key)}`,
        osUid: r.os_uid,
        technicianUid: r.tech_uid,
        monthKey: r.month_key,
        count: Number(r.cnt ?? 0),
        sum: Number(r.total ?? 0),
      }));
      onData([...fresh, ...legacy]);
    } catch (error) {
      if (!cancelled) onError?.(error);
    } finally {
      running = false;
      if (again && !cancelled) {
        again = false;
        void refetch();
      }
    }
  };
  const stopLive = liveSupabase(workspaceId, () => void refetch());
  void refetch();
  return () => {
    cancelled = true;
    stopLive();
    fallback?.();
  };
}

// ---------------------------------------------------------------------
// Сами оценки: свои (ОС) или все (Owner — подробности и снятие).
// ---------------------------------------------------------------------

export type OrderRatingsScope = { kind: "os"; uid: string } | { kind: "all" };

function ratingsQueryFs(workspaceId: string, scope: OrderRatingsScope, months: string[]) {
  const base = paths.orderRatingsAll(workspaceId);
  // Правило чтения пускает ОС только к своим — запрос обязан повторять его
  // ровно, иначе неоднородные права уронят весь list (см. CLAUDE.md).
  return scope.kind === "os"
    ? query(base, where("osUid", "==", scope.uid), where("monthKey", "in", months))
    : query(base, where("monthKey", "in", months));
}

function subscribeRatingsFirestore(
  workspaceId: string,
  scope: OrderRatingsScope,
  monthKey: string,
  onData: (ratings: OrderRating[]) => void,
  onError?: (error: FirestoreError) => void
) {
  if (!db) {
    onData([]);
    return () => {};
  }
  return onSnapshot(
    ratingsQueryFs(workspaceId, scope, monthsOf(monthKey)),
    (snapshot) =>
      onData(snapshot.docs.map((d) => fsRatingOf(d.id, d.data())).filter((r): r is OrderRating => r !== null)),
    withErrorReporting(onError)
  );
}

function legacyRatings(workspaceId: string, scope: OrderRatingsScope, monthKey: string): Promise<OrderRating[]> {
  if (!db) return Promise.resolve([]);
  const key = `ratings:${workspaceId}:${scope.kind === "os" ? scope.uid : "*"}:${monthKey}`;
  return legacyOnce(key, async () => {
    const snap = await getDocsResumable(ratingsQueryFs(workspaceId, scope, monthsOf(monthKey)));
    return snap.docs.map((d) => fsRatingOf(d.id, d.data())).filter((r): r is OrderRating => r !== null);
  });
}

/**
 * Оценки за `monthKey` и прошлый месяц: ОС — свои (показать балл у заказа),
 * Owner — все (кто кому что поставил, снять несправедливую). Тимлиду
 * самих оценок не показываем: в них названия заказов.
 */
export function subscribeOrderRatings(
  workspaceId: string,
  scope: OrderRatingsScope,
  monthKey: string,
  backend: SbBackend,
  onData: (ratings: OrderRating[]) => void,
  onError?: (error: unknown) => void
): () => void {
  if (backend === "firestore") return subscribeRatingsFirestore(workspaceId, scope, monthKey, onData, onError);
  let cancelled = false;
  let fallback: (() => void) | null = null;
  let running = false;
  let again = false;
  const refetch = async () => {
    if (cancelled || fallback) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      let request = supabaseRows
        .from("order_ratings")
        .select("*")
        .eq("workspace_id", workspaceId)
        .in("month_key", monthsOf(monthKey))
        .limit(2000);
      if (scope.kind === "os") request = request.eq("os_uid", scope.uid);
      const [{ data, error }, legacy] = await Promise.all([request, legacyRatings(workspaceId, scope, monthKey)]);
      if (cancelled) return;
      if (error) {
        if (isSbMissingError(error)) {
          markSbTableMissing("ratings");
          stopLive();
          fallback = subscribeRatingsFirestore(workspaceId, scope, monthKey, onData, onError);
          return;
        }
        onError?.(error);
        return;
      }
      markSbTablePresent("ratings");
      onData(mergeRatings(((data ?? []) as SbRatingRow[]).map(sbRatingOf), legacy));
    } catch (error) {
      if (!cancelled) onError?.(error);
    } finally {
      running = false;
      if (again && !cancelled) {
        again = false;
        void refetch();
      }
    }
  };
  const stopLive = liveSupabase(workspaceId, () => void refetch());
  void refetch();
  return () => {
    cancelled = true;
    stopLive();
    fallback?.();
  };
}

// ---------------------------------------------------------------------
// Запись.
// ---------------------------------------------------------------------

export class RatingDeniedError extends Error {
  constructor(message = "Оценить этот заказ может только его ОС") {
    super(message);
    this.name = "RatingDeniedError";
  }
}

export interface RateOrderInput {
  workspaceId: string;
  backend: SbBackend;
  pageId: string;
  tabId: string;
  rowId: string;
  osUid: string;
  osValue: string;
  technicianUid: string;
  /** 1–10; null — снять оценку. */
  score: number | null;
  title: string;
  monthKey: string;
  /** Оценка, которая стоит сейчас (из подписки) — чтобы снять старую из Firestore. */
  previous?: OrderRating | null;
}

function deniedCode(error: unknown): boolean {
  const code = String((error as { code?: unknown })?.code ?? "");
  return code === "42501" || code === "P0002" || code === "permission-denied";
}

/**
 * Поставить, сменить или снять оценку. В режиме Supabase старая оценка того
 * же заказа из Firestore снимается следом (без неё среднее посчитало бы
 * заказ дважды); не вышло — не беда, это лишь старый архив.
 */
export async function rateOrder(input: RateOrderInput): Promise<void> {
  if (input.backend === "supabase") {
    const { error } = await supabaseRows.rpc("rate_order", {
      p_workspace: input.workspaceId,
      p_page: input.pageId,
      p_tab: input.tabId,
      p_row: input.rowId,
      p_score: input.score === null ? null : clampScore(input.score),
      p_title: input.title.slice(0, 120),
      p_month: input.monthKey,
    });
    if (!error) {
      markSbTablePresent("ratings");
      if (input.previous?.source === "firestore") {
        await removeOrderRatingFirestore(input.workspaceId, input.previous.id).catch(() => {});
      }
      dropLegacyCache(input.workspaceId);
      ringTopic(ratingsTopic(input.workspaceId));
      return;
    }
    if (!isSbMissingError(error)) {
      if (deniedCode(error)) throw new RatingDeniedError();
      throw error;
    }
    markSbTableMissing("ratings");
  }
  if (input.score === null) {
    await removeOrderRatingFirestore(input.workspaceId, orderRatingId(input.pageId, input.rowId));
    return;
  }
  try {
    await rateOrderFirestore({ ...input, score: clampScore(input.score) });
  } catch (error) {
    if (deniedCode(error)) {
      throw new RatingDeniedError("Не получилось: база не видит свежего заказа с вашим ником ОС у этого технаря");
    }
    throw error;
  }
}

/**
 * Firestore: оценка и итоги пары ОДНОЙ транзакцией (итоги — счётчик, и
 * «прочитал-посчитал-записал» двумя вкладками разъехался бы навсегда).
 * Старый документ (`stars`) переписывается в `score`, старые итоги (без
 * `scale`) переводятся в 10-балльную шкалу той же записью.
 */
async function rateOrderFirestore(input: RateOrderInput & { score: number }) {
  if (!db) return;
  const ratingRef = paths.orderRating(input.workspaceId, orderRatingId(input.pageId, input.rowId));
  const now = Date.now();
  await runTransaction(db, async (tx) => {
    const ratingSnap = await tx.get(ratingRef);
    const previous = ratingSnap.exists() ? fsRatingOf(ratingSnap.id, ratingSnap.data()) : null;
    const monthKey = previous?.monthKey || input.monthKey;
    const technicianUid = previous?.technicianUid || input.technicianUid;
    const totalsRef = paths.orderRatingTotals(input.workspaceId, orderRatingTotalsId(input.osUid, technicianUid, monthKey));
    const totalsSnap = await tx.get(totalsRef);
    const legacyRaw = ratingSnap.exists() && typeof ratingSnap.data().score !== "number";
    if (previous?.score === input.score && !legacyRaw) return;

    tx.set(ratingRef, {
      workspaceId: input.workspaceId,
      pageId: input.pageId,
      tabId: input.tabId,
      rowId: input.rowId,
      osUid: input.osUid,
      osValue: input.osValue,
      technicianUid,
      score: input.score,
      monthKey,
      title: input.title.slice(0, 120),
      createdAt: previous?.createdAt || now,
      updatedAt: now,
    });

    const current = totalsSnap.exists() ? fsTotalsOf(totalsSnap.id, totalsSnap.data()) : null;
    // Прежняя оценка лежала в итогах ЭТОГО ОС только если её ставил он же.
    const counted = previous && previous.osUid === input.osUid ? previous : null;
    tx.set(totalsRef, {
      workspaceId: input.workspaceId,
      osUid: input.osUid,
      technicianUid,
      monthKey,
      count: Math.max(0, (current?.count ?? 0) + (counted ? 0 : 1)),
      sum: Math.max(0, (current?.sum ?? 0) + input.score - (counted?.score ?? 0)),
      scale: 10,
      updatedAt: now,
    });
  });
}

/** Снять оценку в Firestore и поправить итоги той же транзакцией. */
async function removeOrderRatingFirestore(workspaceId: string, ratingId: string) {
  if (!db) return;
  const ratingRef = paths.orderRating(workspaceId, ratingId);
  await runTransaction(db, async (tx) => {
    const ratingSnap = await tx.get(ratingRef);
    if (!ratingSnap.exists()) return;
    const previous = fsRatingOf(ratingSnap.id, ratingSnap.data());
    if (!previous) {
      tx.delete(ratingRef);
      return;
    }
    const totalsRef = paths.orderRatingTotals(
      workspaceId,
      orderRatingTotalsId(previous.osUid, previous.technicianUid, previous.monthKey)
    );
    const totalsSnap = await tx.get(totalsRef);
    tx.delete(ratingRef);
    const current = totalsSnap.exists() ? fsTotalsOf(totalsSnap.id, totalsSnap.data()) : null;
    const count = Math.max(0, (current?.count ?? 1) - 1);
    const sum = Math.max(0, (current?.sum ?? previous.score) - previous.score);
    tx.set(totalsRef, {
      workspaceId,
      osUid: previous.osUid,
      technicianUid: previous.technicianUid,
      monthKey: previous.monthKey,
      count,
      // Правила держат count ≤ sum ≤ 10·count.
      sum: Math.min(count * 10, Math.max(count, sum)),
      scale: 10,
      updatedAt: Date.now(),
    });
  });
}

/**
 * Снять оценку, где бы она ни лежала (ОС — свою, Owner/Тимлид — любую:
 * кто вправе, решает база).
 */
export async function removeOrderRating(workspaceId: string, rating: OrderRating): Promise<void> {
  if (rating.source === "firestore") {
    await removeOrderRatingFirestore(workspaceId, rating.id);
    return;
  }
  const { error } = await supabaseRows.rpc("rate_order", {
    p_workspace: workspaceId,
    p_page: rating.pageId,
    p_tab: rating.tabId,
    p_row: rating.rowId,
    p_score: null,
    p_title: "",
    p_month: rating.monthKey,
  });
  if (error) {
    if (deniedCode(error)) throw new RatingDeniedError("Снять оценку может её ОС, Owner или Тимлид");
    throw error;
  }
  ringTopic(ratingsTopic(workspaceId));
}
