import { useEffect, useSyncExternalStore } from "react";
import { supabaseRows } from "@/lib/supabaseRows";
import { isSbMissingError } from "@/services/sb/sbCollections";
import { listenTopic, ringTopic } from "@/services/sb/topicDoorbell";

/**
 * «Заказы от 300к+» (28.09.2026, SQL 20261038_big_orders.sql).
 *
 * Owner назначает ответственных и порог суммы чека; ответственный (и Owner)
 * ведёт очередь технарей по номерам — №1 в приоритете. Заказ с чеком от
 * порога ОС отдаёт только технарю из очереди, выходные и занятость на эту
 * выдачу не действуют. Очередь хранит база (`big_queue_*`), «только из
 * очереди» держит интерфейс — как запреты на отклик.
 *
 * Состояние одно на вкладку: выборка `big_queue_get` при первом читателе,
 * перечитка при возврате на вкладку (не чаще раза в 2 минуты), раз в 10 минут
 * на виду и по звонку `nova:{ws}:bigq` после чужой правки.
 *
 * Пауза (29.09.2026, SQL 20261039): `enabled: false` — вся функция на паузе,
 * крупные заказы выдаются как обычно (очередь сохраняется). Паузу у отдельного
 * технаря убрали (просьба Nurba): колонка `paused` в базе осталась, клиент её
 * не читает — очередь при выдаче = вся `queue`.
 *
 * Группа (29.09.2026, SQL 20261040): `pool` — заранее отобранные технари, которые
 * сейчас НЕ в активной очереди. Переносы между очередью и группой и порядок
 * пишутся одним `big_queue_set_lists` (оба списка разом).
 *
 * Получил — ушёл (29.09.2026, SQL 20261041): технарь из очереди, получивший
 * крупный заказ, сам уходит в начало группы (`big_queue_took`, может тот, кто
 * выдаёт заказы), `taken[uid]` — когда (мс сервера). Зовут окна выдачи ПОСЛЕ
 * удачной записи технаря — `noteBigQueuePick`.
 *
 * Счётчик (там же): сколько крупных заказов человек получил с последнего сброса
 * (`counts`, считает база по журналу «заказ → технарь»: повторная выдача того же
 * заказа не считается, переданный заказ переходит к новому). Сбрасывает только
 * Owner (`resetBigQueueCounts`).
 */

export const DEFAULT_BIG_THRESHOLD = 300_000;

export interface BigQueueConfig {
  threshold: number;
  managers: string[];
  queue: string[];
  /** Группа: отобраны, но сейчас не в очереди. */
  pool: string[];
  /** Функция работает (false — на паузе, выдача как обычно). */
  enabled: boolean;
  /** Кто последним переключал «работает / на паузе». */
  pausedBy: string | null;
  /** uid → когда получил крупный заказ (мс сервера). */
  taken: Record<string, number>;
  /** uid → сколько крупных заказов получил с последнего сброса. */
  counts: Record<string, number>;
  /** С какого момента считаем (мс сервера); null — ещё ни одного. */
  countsSince: number | null;
  countsResetBy: string | null;
  updatedAt: number | null;
  updatedBy: string | null;
}

export type BigQueueStatus = "idle" | "loading" | "ready" | "missing" | "error";

export interface BigQueueSnapshot {
  status: BigQueueStatus;
  data: BigQueueConfig | null;
}

const IDLE: BigQueueSnapshot = { status: "idle", data: null };
const STALE_MS = 2 * 60_000;
const POLL_MS = 10 * 60_000;
const topicOf = (ws: string) => `nova:${ws}:bigq`;

interface Entry {
  snap: BigQueueSnapshot;
  loadedAt: number;
  inflight: Promise<void> | null;
  users: number;
  stopRing: (() => void) | null;
  timer: ReturnType<typeof setInterval> | null;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();

function entryOf(ws: string): Entry {
  let entry = entries.get(ws);
  if (!entry) {
    entry = { snap: IDLE, loadedAt: 0, inflight: null, users: 0, stopRing: null, timer: null };
    entries.set(ws, entry);
  }
  return entry;
}

function setSnap(ws: string, snap: BigQueueSnapshot) {
  entryOf(ws).snap = snap;
  for (const listener of [...listeners]) listener();
}

function asObject(data: unknown): Record<string, unknown> {
  if (typeof data === "string") {
    try {
      return JSON.parse(data) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
}

function takenMap(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [uid, at] of Object.entries(v as Record<string, unknown>)) {
    const n = typeof at === "number" ? at : Number(at);
    if (uid && Number.isFinite(n) && n > 0) out[uid] = n;
  }
  return out;
}

export function parseBigQueue(data: unknown): BigQueueConfig {
  const o = asObject(data);
  const threshold = typeof o.threshold === "number" ? o.threshold : Number(o.threshold);
  const updatedAt = typeof o.updatedAt === "number" ? o.updatedAt : Number(o.updatedAt);
  return {
    threshold: Number.isFinite(threshold) && threshold > 0 ? threshold : DEFAULT_BIG_THRESHOLD,
    managers: strings(o.managers),
    queue: strings(o.queue),
    pool: strings(o.pool).filter((uid) => !strings(o.queue).includes(uid)),
    enabled: o.enabled !== false,
    pausedBy: typeof o.pausedBy === "string" ? o.pausedBy : null,
    taken: takenMap(o.taken),
    counts: takenMap(o.counts),
    countsSince: Number.isFinite(Number(o.countsSince)) && Number(o.countsSince) > 0 ? Number(o.countsSince) : null,
    countsResetBy: typeof o.countsResetBy === "string" ? o.countsResetBy : null,
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : null,
    updatedBy: typeof o.updatedBy === "string" ? o.updatedBy : null,
  };
}

async function load(ws: string): Promise<void> {
  const entry = entryOf(ws);
  if (entry.inflight) return entry.inflight;
  if (entry.snap.status === "idle") setSnap(ws, { ...entry.snap, status: "loading" });
  entry.inflight = (async () => {
    try {
      const { data, error } = await supabaseRows.rpc("big_queue_get", { p_workspace: ws });
      if (error) {
        const missing = isSbMissingError(error);
        if (!missing) console.warn("[big-orders] read failed", error);
        setSnap(ws, entry.snap.data ? entry.snap : { status: missing ? "missing" : "error", data: null });
        return;
      }
      entry.loadedAt = Date.now();
      setSnap(ws, { status: "ready", data: parseBigQueue(data) });
    } catch (error) {
      console.warn("[big-orders] read failed", error);
      if (!entry.snap.data) setSnap(ws, { status: "error", data: null });
    } finally {
      entry.inflight = null;
    }
  })();
  return entry.inflight;
}

let visibilityBound = false;
function bindVisibility() {
  if (visibilityBound || typeof document === "undefined") return;
  visibilityBound = true;
  const onBack = () => {
    if (document.visibilityState !== "visible") return;
    for (const [ws, entry] of entries) {
      if (entry.users > 0 && Date.now() - entry.loadedAt > STALE_MS) void load(ws);
    }
  };
  document.addEventListener("visibilitychange", onBack);
  window.addEventListener("focus", onBack);
}

function retain(ws: string) {
  const entry = entryOf(ws);
  entry.users += 1;
  if (!entry.stopRing) entry.stopRing = listenTopic(topicOf(ws), () => void load(ws));
  if (!entry.timer) {
    entry.timer = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") void load(ws);
    }, POLL_MS);
  }
  bindVisibility();
  if (entry.snap.status === "idle" || entry.snap.status === "error" || Date.now() - entry.loadedAt > STALE_MS) void load(ws);
  return () => {
    entry.users -= 1;
    if (entry.users <= 0) {
      entry.users = 0;
      entry.stopRing?.();
      entry.stopRing = null;
      if (entry.timer) clearInterval(entry.timer);
      entry.timer = null;
    }
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Очередь и настройка. `enabled: false` — не читать (экран без выдачи). */
export function useBigOrderQueue(ws: string | null | undefined, enabled = true): BigQueueSnapshot {
  const active = Boolean(ws && enabled);
  useEffect(() => {
    if (!ws || !enabled) return;
    return retain(ws);
  }, [ws, enabled]);
  return useSyncExternalStore(subscribe, () => (active && ws ? entryOf(ws).snap : IDLE));
}

/** Что показывать при выдаче: порог и очередь, пока функция работает. */
export interface BigQueueView {
  threshold: number;
  queue: string[];
}

/**
 * Для окон выдачи: порог и очередь. Функция на паузе — null, и окна ведут себя
 * как без очереди.
 */
export function bigQueueView(snap: BigQueueSnapshot): BigQueueView | null {
  if (snap.status !== "ready" || !snap.data || !snap.data.enabled) return null;
  return { threshold: snap.data.threshold, queue: snap.data.queue };
}

/** Чек от порога (включительно) — выдача только из очереди. */
export function isBigCheck(total: number | null | undefined, threshold: number): boolean {
  return typeof total === "number" && Number.isFinite(total) && total > 0 && total >= threshold;
}

export function canManageBigQueue(uid: string | null | undefined, cfg: BigQueueConfig | null, actsAsOwner: boolean): boolean {
  if (actsAsOwner) return true;
  return Boolean(uid && cfg?.managers.includes(uid));
}

/** «300 тыс» / «1,2 млн» — для подписей «Заказы от 300к+». */
export function shortMoney(value: number): string {
  if (value >= 1_000_000) return `${String(Math.round(value / 100_000) / 10).replace(".", ",")} млн`;
  if (value >= 1_000) return `${Math.round(value / 1_000)} тыс`;
  return String(value);
}

function queueErrorText(error: { code?: string; message?: string }, fallback: string): string {
  const msg = error.message ?? "";
  if (isSbMissingError(error)) return "Очередь ещё не включена в базе — Owner должен обновить SQL.";
  if (msg.includes("read-only")) return "Доступ компании приостановлен.";
  if (msg.includes("only owner")) return "Это может только Owner.";
  if (msg.includes("not a queue manager")) return "Очередь правят только ответственные и Owner.";
  if (msg.includes("too many managers")) return "Ответственных — не больше 10.";
  if (msg.includes("bad threshold")) return "Порог — от 1 000.";
  if (msg.includes("queue too long")) return "В очереди — не больше 50 человек.";
  if (msg.includes("pool too long")) return "В группе — не больше 100 человек.";
  if (msg.includes("cannot issue orders")) return "Нет права выдавать заказы.";
  if (msg.includes("only owner")) return "Сбросить счётчик может только Owner.";
  if (error.code === "42501") return "Нет права.";
  return `${fallback}${error.code ? ` (${error.code})` : ""}.`;
}

export async function saveBigQueue(ws: string, queue: string[]): Promise<BigQueueConfig> {
  const entry = entryOf(ws);
  const before = entry.snap;
  if (before.data) setSnap(ws, { status: "ready", data: { ...before.data, queue } });
  const { data, error } = await supabaseRows.rpc("big_queue_set", { p_workspace: ws, p_queue: queue });
  if (error) {
    setSnap(ws, before);
    throw new Error(queueErrorText(error, "Не удалось сохранить очередь"));
  }
  const saved = parseBigQueue(data);
  entry.loadedAt = Date.now();
  setSnap(ws, { status: "ready", data: saved });
  ringTopic(topicOf(ws));
  return saved;
}

export async function saveBigConfig(ws: string, managers: string[], threshold: number): Promise<BigQueueConfig> {
  const { data, error } = await supabaseRows.rpc("big_queue_set_config", {
    p_workspace: ws,
    p_managers: managers,
    p_threshold: threshold,
  });
  if (error) throw new Error(queueErrorText(error, "Не удалось сохранить настройку"));
  const saved = parseBigQueue(data);
  entryOf(ws).loadedAt = Date.now();
  setSnap(ws, { status: "ready", data: saved });
  ringTopic(topicOf(ws));
  return saved;
}


async function applyOptimistic(
  ws: string,
  patch: (cfg: BigQueueConfig) => BigQueueConfig,
  rpc: () => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>,
  fallback: string,
): Promise<BigQueueConfig> {
  const entry = entryOf(ws);
  const before = entry.snap;
  if (before.data) setSnap(ws, { status: "ready", data: patch(before.data) });
  const { data, error } = await rpc();
  if (error) {
    setSnap(ws, before);
    throw new Error(queueErrorText(error, fallback));
  }
  const saved = parseBigQueue(data);
  entry.loadedAt = Date.now();
  setSnap(ws, { status: "ready", data: saved });
  ringTopic(topicOf(ws));
  return saved;
}

/** Вся функция: работает / на паузе. */
export function setBigQueueEnabled(ws: string, on: boolean): Promise<BigQueueConfig> {
  return applyOptimistic(
    ws,
    (cfg) => ({ ...cfg, enabled: on }),
    () => supabaseRows.rpc("big_queue_set_enabled", { p_workspace: ws, p_on: on }),
    on ? "Не удалось включить очередь" : "Не удалось поставить очередь на паузу",
  );
}

/**
 * Очередь и группа одной записью. Нет функции (SQL 20261040 ещё не накатан) —
 * очередь пишется по-старому, группа остаётся прежней.
 */
export async function saveBigLists(ws: string, queue: string[], pool: string[]): Promise<BigQueueConfig> {
  const inQueue = new Set(queue);
  const cleanPool = pool.filter((uid, i) => !inQueue.has(uid) && pool.indexOf(uid) === i);
  try {
    return await applyOptimistic(
      ws,
      (cfg) => ({ ...cfg, queue, pool: cleanPool }),
      () => supabaseRows.rpc("big_queue_set_lists", { p_workspace: ws, p_queue: queue, p_pool: cleanPool }),
      "Не удалось сохранить очередь",
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Очередь ещё не включена")) {
      if (cleanPool.length) throw new Error("Группа ещё не включена в базе — Owner должен обновить SQL.");
      return saveBigQueue(ws, queue);
    }
    throw error;
  }
}

/**
 * Технарь получил крупный заказ: +1 к счётчику (по ключу заказа) и, пока
 * функция работает, из очереди в начало группы.
 */
export function markBigQueueTaken(ws: string, uid: string, orderKey: string | null = null): Promise<BigQueueConfig> {
  return applyOptimistic(
    ws,
    (cfg) =>
      cfg.enabled && cfg.queue.includes(uid)
        ? {
            ...cfg,
            queue: cfg.queue.filter((u) => u !== uid),
            pool: [uid, ...cfg.pool.filter((u) => u !== uid)],
            taken: { ...cfg.taken, [uid]: Date.now() },
          }
        : cfg,
    () => supabaseRows.rpc("big_queue_took", { p_workspace: ws, p_uid: uid, p_order_key: orderKey }),
    "Не удалось отметить крупный заказ",
  );
}

/** Сбросить счётчик — только Owner. */
export function resetBigQueueCounts(ws: string): Promise<BigQueueConfig> {
  return applyOptimistic(
    ws,
    (cfg) => ({ ...cfg, counts: {}, countsSince: Date.now() }),
    () => supabaseRows.rpc("big_queue_reset_counts", { p_workspace: ws }),
    "Не удалось сбросить счётчик",
  );
}

const recentPicks = new Map<string, number>();

/** Ключ заказа для счётчика: адрес строки стола ОС или id заказа биржи. */
export function bigOrderRowKey(pageId: string, rowId: string): string {
  return `row:${pageId}:${rowId}`;
}

/**
 * Окна выдачи зовут ПОСЛЕ удачной записи технаря: чек от порога — +1 к счётчику
 * технаря и (пока функция работает и он в очереди) переход в группу. Выдача уже
 * прошла, поэтому ошибки только в консоль (нет функции в базе — молча).
 */
export function noteBigQueuePick(
  ws: string | null | undefined,
  uid: string | null | undefined,
  check: number | null | undefined,
  orderKey: string | null,
): void {
  if (!ws || !uid) return;
  const cfg = entryOf(ws).snap.data;
  if (!cfg || !isBigCheck(check, cfg.threshold)) return;
  // Одна выдача может дойти сюда дважды (окно выбора и страница «Заказы») —
  // база и так не считает её второй раз, но лишний запрос не нужен.
  const sig = `${ws}|${uid}|${orderKey ?? ""}`;
  const now = Date.now();
  if ((recentPicks.get(sig) ?? 0) > now - 10_000) return;
  recentPicks.set(sig, now);
  markBigQueueTaken(ws, uid, orderKey).catch((error) => {
    if (!(error instanceof Error && error.message.startsWith("Очередь ещё не включена"))) {
      console.warn("[big-orders] took failed", error);
    }
  });
}
