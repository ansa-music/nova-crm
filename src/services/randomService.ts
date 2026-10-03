import { useEffect, useSyncExternalStore } from "react";
import { supabaseRows } from "@/lib/supabaseRows";
import { isSbMissingError } from "@/services/sb/sbCollections";
import { ringTopic } from "@/services/sb/topicDoorbell";
import { updateRandomSettings } from "@/services/workspaceService";
import { randomSettingsKey, sanitizeRandomSettings, type RandomSettings } from "@/types/randomSettings";

/**
 * «Рандом» на сервере (03.10.2026, SQL 20261044_random_server.sql).
 *
 * Просьба Nurba: шансы — «только у Owner, никто другой не должен про них
 * знать», а барабан — «все видят, если на сайте; кто не на сайте, не видят».
 *
 * - Шансы лежат в Supabase `random_settings`; читает и пишет только Owner
 *   (`random_settings_get/set`). Раньше было поле `workspace.randomSettings`,
 *   которое читали все участники: сессия Owner переносит его сюда и стирает
 *   (`useRandomSettings`, один раз).
 * - Бросок делает база (`random_draw`): выдающий присылает пул и сумму чека,
 *   победителя база выбирает по скрытым шансам и пишет «спин». Нет функции
 *   (SQL не накатан) — `null`, и окно крутит поровну, как раньше.
 * - После броска — звонок `nova:{ws}:wheel` без данных. Открытые вкладки
 *   спрашивают последний спин (`random_spin_latest`) и показывают барабан,
 *   только если ему меньше 15 секунд по часам базы (`useLiveWheel`).
 */

export const WHEEL_TOPIC = (ws: string) => `nova:${ws}:wheel`;
export const WHEEL_FRESH_MS = 15_000;

// ---------------------------------------------------------------- шансы (Owner)

export type RandomSettingsStatus = "idle" | "loading" | "ready" | "missing" | "error";

export interface RandomSettingsSnapshot {
  status: RandomSettingsStatus;
  data: RandomSettings;
}

const IDLE: RandomSettingsSnapshot = { status: "idle", data: {} };
const STALE_MS = 2 * 60_000;

interface Entry {
  snap: RandomSettingsSnapshot;
  loadedAt: number;
  inflight: Promise<void> | null;
  migrated: boolean;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();

function entryOf(ws: string): Entry {
  let entry = entries.get(ws);
  if (!entry) {
    entry = { snap: IDLE, loadedAt: 0, inflight: null, migrated: false };
    entries.set(ws, entry);
  }
  return entry;
}

function setSnap(ws: string, snap: RandomSettingsSnapshot) {
  entryOf(ws).snap = snap;
  for (const l of listeners) l();
}

function errorText(error: { code?: string; message?: string } | null | undefined, fallback: string): string {
  if (!error) return fallback;
  if (isSbMissingError(error)) return "Шансы ещё не включены в базе — обновите SQL.";
  if (error.code === "42501") return "Шансы «Рандома» видит и правит только Owner.";
  return error.message || fallback;
}

/**
 * Перенос старого поля `workspace.randomSettings` (его читали все) в закрытую
 * таблицу и стирание поля. Один раз на вкладку, только у Owner.
 */
async function migrateLegacy(ws: string, legacy: RandomSettings | null | undefined, exists: boolean) {
  const entry = entryOf(ws);
  if (entry.migrated || legacy === undefined || legacy === null) return;
  entry.migrated = true;
  try {
    const clean = sanitizeRandomSettings(legacy);
    if (!exists && Object.keys(clean).length > 0) {
      const { error } = await supabaseRows.rpc("random_settings_set", { p_workspace: ws, p_data: clean });
      if (error) throw error;
      setSnap(ws, { status: "ready", data: clean });
    }
    await updateRandomSettings(ws, {});
  } catch (error) {
    entry.migrated = false;
    console.warn("[random] legacy settings move failed", error);
  }
}

function load(ws: string, legacy: RandomSettings | null | undefined): Promise<void> {
  const entry = entryOf(ws);
  if (entry.inflight) return entry.inflight;
  if (entry.snap.status === "idle") setSnap(ws, { status: "loading", data: {} });
  entry.inflight = (async () => {
    try {
      const { data, error } = await supabaseRows.rpc("random_settings_get", { p_workspace: ws });
      if (error) {
        const missing = isSbMissingError(error);
        if (!missing) console.warn("[random] settings read failed", error);
        setSnap(ws, { status: missing ? "missing" : "error", data: entry.snap.data });
        return;
      }
      const row = (data ?? {}) as { data?: RandomSettings; exists?: boolean };
      entry.loadedAt = Date.now();
      setSnap(ws, { status: "ready", data: sanitizeRandomSettings(row.data) });
      void migrateLegacy(ws, legacy, Boolean(row.exists));
    } catch (error) {
      console.warn("[random] settings read failed", error);
      setSnap(ws, { status: "error", data: entry.snap.data });
    } finally {
      entry.inflight = null;
    }
  })();
  return entry.inflight;
}

/**
 * Шансы «Рандома» — только для Owner (`enabled = actsAsOwner`). `legacy` —
 * старое поле из документа workspace: если оно есть, переносится и стирается.
 */
export function useRandomSettings(
  ws: string | null | undefined,
  enabled: boolean,
  legacy?: RandomSettings | null
): RandomSettingsSnapshot {
  const active = Boolean(ws && enabled);
  const legacyKey = legacy ? randomSettingsKey(legacy) : "";
  useEffect(() => {
    if (!ws || !enabled) return;
    const entry = entryOf(ws);
    if (entry.snap.status === "idle" || entry.snap.status === "error" || Date.now() - entry.loadedAt > STALE_MS) {
      void load(ws, legacy);
    } else if (legacy) {
      void migrateLegacy(ws, legacy, true);
    }
    // legacy сравниваем по подписи — объект пересобирается на каждый снимок.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws, enabled, legacyKey]);
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => (active && ws ? entryOf(ws).snap : IDLE)
  );
}

export async function saveRandomSettings(ws: string, settings: RandomSettings): Promise<RandomSettings> {
  const clean = sanitizeRandomSettings(settings);
  const { error } = await supabaseRows.rpc("random_settings_set", { p_workspace: ws, p_data: clean });
  if (error) throw new Error(errorText(error, "Не удалось сохранить шансы"));
  entryOf(ws).loadedAt = Date.now();
  setSnap(ws, { status: "ready", data: clean });
  return clean;
}

// ---------------------------------------------------------------- бросок

export interface DrawPoolEntry {
  uid: string;
  name: string;
  /** Заказов за текущий период — для «меньше заказов — выше шанс». */
  count: number;
}

export class RandomNoWinnerError extends Error {}

/** Спины, которые крутила ЭТА вкладка: свой звонок её барабан второй раз не открывает. */
const ownSpins = new Set<string>();
export function isOwnSpin(id: string): boolean {
  return ownSpins.has(id);
}

/**
 * Бросок на сервере. `null` — функции в базе нет (SQL не накатан): крутим
 * поровну в браузере, как раньше.
 */
export async function drawOnServer(args: {
  ws: string;
  orderId: string | null;
  title: string;
  pool: DrawPoolEntry[];
  checkTotal: number | null;
  byName: string;
}): Promise<{ spinId: string; winnerUid: string } | null> {
  const { data, error } = await supabaseRows.rpc("random_draw", {
    p_workspace: args.ws,
    p_order_id: args.orderId,
    p_title: args.title,
    p_pool: args.pool.map((p) => ({ uid: p.uid, name: p.name, count: p.count })),
    p_check: args.checkTotal && args.checkTotal > 0 ? args.checkTotal : null,
    p_by_name: args.byName,
  });
  if (error) {
    // Нет функции (SQL не накатан) или компания без копии прав в Supabase
    // (строки в Firestore) — крутим поровну в браузере, как раньше.
    if (isSbMissingError(error) || (error.message ?? "").includes("не участник workspace")) return null;
    const text = `${error.message ?? ""} ${(error as { hint?: string }).hint ?? ""}`;
    if (text.includes("all_zero") || text.includes("некому выпасть")) {
      throw new RandomNoWinnerError("Выпасть некому — выдайте заказ вручную");
    }
    throw new Error(errorText(error, "Не удалось крутить барабан"));
  }
  const row = (data ?? {}) as { id?: unknown; winner?: unknown };
  if (typeof row.id !== "string" || typeof row.winner !== "string") throw new Error("База не вернула победителя");
  ownSpins.add(row.id);
  return { spinId: row.id, winnerUid: row.winner };
}

/** Позвать всех, у кого открыт сайт, посмотреть на барабан. */
export function announceSpin(ws: string) {
  ringTopic(WHEEL_TOPIC(ws));
}

// ---------------------------------------------------------------- смотреть чужой спин

export interface LiveSpin {
  id: string;
  orderId: string | null;
  title: string;
  pool: { uid: string; name: string }[];
  winnerUid: string;
  byUid: string | null;
  byName: string;
  ageMs: number;
}

export function parseSpin(raw: unknown): LiveSpin | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.winner !== "string" || !Array.isArray(r.pool)) return null;
  const pool = r.pool
    .map((p) => (p && typeof p === "object" ? (p as Record<string, unknown>) : null))
    .filter((p): p is Record<string, unknown> => Boolean(p && typeof p.uid === "string"))
    .map((p) => ({ uid: String(p.uid), name: typeof p.name === "string" ? p.name : "" }));
  if (pool.length === 0) return null;
  return {
    id: r.id,
    orderId: typeof r.orderId === "string" ? r.orderId : null,
    title: typeof r.title === "string" ? r.title : "",
    pool,
    winnerUid: r.winner,
    byUid: typeof r.byUid === "string" ? r.byUid : null,
    byName: typeof r.byName === "string" ? r.byName : "",
    ageMs: typeof r.ageMs === "number" ? r.ageMs : Number(r.ageMs ?? Infinity),
  };
}

export async function fetchLatestSpin(ws: string): Promise<LiveSpin | null> {
  const { data, error } = await supabaseRows.rpc("random_spin_latest", { p_workspace: ws });
  if (error) {
    if (!isSbMissingError(error)) console.warn("[random] spin read failed", error);
    return null;
  }
  return parseSpin(data);
}
