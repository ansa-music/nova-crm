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
 * крупные заказы выдаются как обычно (очередь сохраняется); `paused[uid]` —
 * технарь на паузе до момента (мс) или «до снятия» (null). Истёкшая пауза =
 * активен, в базу ничего не пишется.
 */

export const DEFAULT_BIG_THRESHOLD = 300_000;

export interface BigQueueConfig {
  threshold: number;
  managers: string[];
  queue: string[];
  /** Функция работает (false — на паузе, выдача как обычно). */
  enabled: boolean;
  /** uid → до какого момента (мс) или null — «пока не снимут». */
  paused: Record<string, number | null>;
  pausedBy: string | null;
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

function pausedMap(v: unknown): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [uid, until] of Object.entries(v as Record<string, unknown>)) {
    if (!uid) continue;
    const n = typeof until === "number" ? until : until == null ? null : Number(until);
    out[uid] = n === null || !Number.isFinite(n) ? null : n;
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
    enabled: o.enabled !== false,
    paused: pausedMap(o.paused),
    pausedBy: typeof o.pausedBy === "string" ? o.pausedBy : null,
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

/** Технарь на паузе сейчас: «до снятия» или дата ещё не наступила. */
export function isPausedNow(cfg: BigQueueConfig | null, uid: string, now = Date.now()): boolean {
  if (!cfg || !Object.prototype.hasOwnProperty.call(cfg.paused, uid)) return false;
  const until = cfg.paused[uid];
  return until === null || until > now;
}

/** До какого момента пауза (null — «до снятия»); undefined — не на паузе. */
export function pauseUntil(cfg: BigQueueConfig | null, uid: string, now = Date.now()): number | null | undefined {
  if (!isPausedNow(cfg, uid, now)) return undefined;
  return cfg!.paused[uid] ?? null;
}

/** Очередь без тех, кто сейчас на паузе. */
export function activeQueue(cfg: BigQueueConfig, now = Date.now()): string[] {
  return cfg.queue.filter((uid) => !isPausedNow(cfg, uid, now));
}

/**
 * Для окон выдачи: порог и АКТИВНАЯ очередь. Функция на паузе — null, и окна
 * ведут себя как без очереди.
 */
export function bigQueueView(snap: BigQueueSnapshot, now = Date.now()): BigQueueView | null {
  if (snap.status !== "ready" || !snap.data || !snap.data.enabled) return null;
  return { threshold: snap.data.threshold, queue: activeQueue(snap.data, now) };
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
  if (msg.includes("not in queue")) return "Этого технаря уже нет в очереди.";
  if (msg.includes("bad pause date")) return "Дата паузы — в будущем и не дальше 90 дней.";
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

/** Технарь на паузе до `untilMs` (null — до снятия); `on: false` — вернуть. */
export function setBigQueuePause(ws: string, uid: string, on: boolean, untilMs: number | null = null): Promise<BigQueueConfig> {
  return applyOptimistic(
    ws,
    (cfg) => {
      const paused = { ...cfg.paused };
      if (on) paused[uid] = untilMs;
      else delete paused[uid];
      return { ...cfg, paused };
    },
    () =>
      supabaseRows.rpc("big_queue_set_pause", {
        p_workspace: ws,
        p_uid: uid,
        p_on: on,
        p_until_ms: on ? untilMs : null,
      }),
    on ? "Не удалось поставить на паузу" : "Не удалось снять паузу",
  );
}
