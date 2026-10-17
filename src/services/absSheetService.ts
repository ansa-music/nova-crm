import { useEffect, useSyncExternalStore } from "react";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase";
import { supabaseRows } from "@/lib/supabaseRows";
import { isSbMissingError } from "@/services/sb/sbCollections";
import { listenTopic, ringTopic } from "@/services/sb/topicDoorbell";
import { ABS_SHEET_IDLE as IDLE, applyAbsSheetResponse, type AbsSheetState } from "@/utils/absSheet";
import { buildAbsSheetScript } from "@/utils/absSheetScript";

export type { AbsSheetState, AbsSheetStatus } from "@/utils/absSheet";

/**
 * ABS → «Таблица» (17.10.2026, SQL 20261051_abs_sheet.sql): живая копия листов
 * Google-таблицы фин. отчёта. Пишет её скрипт внутри таблицы (Apps Script,
 * текст — src/utils/absSheetScript.ts) при каждой правке и раз в 5 минут; база
 * хранит последнюю копию, участники читают её `abs_sheet_get`.
 *
 * Живость: скрипт после передачи звонит в тему `nova:{ws}:abssheet` (солёную) —
 * открытая вкладка дочитывает сразу; без звонка — опрос раз в 20 с, пока вкладка
 * «Таблица» открыта и на виду, и при возврате на вкладку. Опрос стоит десятки
 * байт: читатель шлёт свой отпечаток, и база не отдаёт таблицу, если она та же.
 *
 * Состояние одно на вкладку браузера (модуль), экраны подписываются хуком.
 */

export const ABS_SHEET_POLL_MS = 20_000;
const STALE_MS = 20_000;
export const absSheetTopic = (ws: string) => `nova:${ws}:abssheet`;

interface Entry {
  state: AbsSheetState;
  inflight: Promise<void> | null;
  again: boolean;
  users: number;
  live: number;
  stopRing: (() => void) | null;
  timer: ReturnType<typeof setInterval> | null;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();

function entryOf(ws: string): Entry {
  let entry = entries.get(ws);
  if (!entry) {
    entry = { state: IDLE, inflight: null, again: false, users: 0, live: 0, stopRing: null, timer: null };
    entries.set(ws, entry);
  }
  return entry;
}

function setState(ws: string, next: AbsSheetState) {
  entryOf(ws).state = next;
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
  return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
}

function millis(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return v != null && Number.isFinite(n) && n > 0 ? n : null;
}

async function load(ws: string): Promise<void> {
  const entry = entryOf(ws);
  if (entry.inflight) {
    entry.again = true;
    return entry.inflight;
  }
  if (entry.state.status === "idle") setState(ws, { ...entry.state, status: "loading" });
  entry.inflight = (async () => {
    try {
      const known = entry.state.sheet ? entry.state.hash : null;
      const { data, error } = await supabaseRows.rpc("abs_sheet_get", { p_workspace: ws, p_hash: known });
      if (error) {
        const missing = isSbMissingError(error);
        if (!missing) console.warn("[abs-sheet] read failed", error);
        setState(ws, entry.state.sheet ? { ...entry.state, checkedAt: Date.now() } : { ...IDLE, status: missing ? "missing" : "error", checkedAt: Date.now() });
        return;
      }
      setState(ws, applyAbsSheetResponse(entry.state, data));
    } catch (error) {
      console.warn("[abs-sheet] read failed", error);
      if (!entry.state.sheet) setState(ws, { ...IDLE, status: "error", checkedAt: Date.now() });
    } finally {
      entry.inflight = null;
      if (entry.again) {
        entry.again = false;
        void load(ws);
      }
    }
  })();
  return entry.inflight;
}

const visible = () => typeof document === "undefined" || document.visibilityState === "visible";

let visibilityBound = false;
function bindVisibility() {
  if (visibilityBound || typeof document === "undefined") return;
  visibilityBound = true;
  const onBack = () => {
    if (!visible()) return;
    for (const [ws, entry] of entries) {
      if (entry.users > 0 && Date.now() - entry.state.checkedAt > STALE_MS) void load(ws);
    }
  };
  document.addEventListener("visibilitychange", onBack);
  window.addEventListener("focus", onBack);
}

function retain(ws: string, live: boolean) {
  const entry = entryOf(ws);
  entry.users += 1;
  if (live) entry.live += 1;
  if (!entry.stopRing) {
    // Звонок от скрипта таблицы или от Owner (сменил настройку). Свёрнутая
    // вкладка дочитает при возврате.
    entry.stopRing = listenTopic(absSheetTopic(ws), () => {
      if (visible()) void load(ws);
      else entry.state = { ...entry.state, checkedAt: 0 };
    });
  }
  if (live && !entry.timer) {
    entry.timer = setInterval(() => {
      if (entry.live > 0 && visible()) void load(ws);
    }, ABS_SHEET_POLL_MS);
  }
  bindVisibility();
  if (entry.state.status === "idle" || entry.state.status === "error" || Date.now() - entry.state.checkedAt > STALE_MS) void load(ws);
  return () => {
    entry.users -= 1;
    if (live) entry.live -= 1;
    if (entry.live <= 0 && entry.timer) {
      clearInterval(entry.timer);
      entry.timer = null;
      entry.live = 0;
    }
    if (entry.users <= 0) {
      entry.users = 0;
      entry.stopRing?.();
      entry.stopRing = null;
    }
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Копия таблицы. `enabled: false` — не читать (суммы скрыты, ABS закрыт).
 * `live` — экран её показывает: опрос раз в 20 с на виду.
 */
export function useAbsSheet(ws: string | null | undefined, enabled: boolean, live: boolean): AbsSheetState {
  const active = Boolean(ws && enabled);
  useEffect(() => {
    if (!ws || !enabled) return;
    return retain(ws, live);
  }, [ws, enabled, live]);
  return useSyncExternalStore(subscribe, () => (active && ws ? entryOf(ws).state : IDLE));
}

/** Перечитать сейчас (кнопка «Обновить»). */
export function refreshAbsSheet(ws: string): Promise<void> {
  return load(ws);
}

// ---------------------------------------------------------------------------
// Настройка — только Owner.

export interface AbsSheetConfig {
  token: string | null;
  audience: "all" | "lead";
  pick: string[];
  sheets: string[];
  title: string | null;
  pushedAt: number | null;
  seenAt: number | null;
  pushCount: number;
  salt: string | null;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
}

export function parseAbsSheetConfig(data: unknown): AbsSheetConfig {
  const o = asObject(data);
  const token = typeof o.token === "string" && /^[0-9a-f]{64}$/.test(o.token) ? o.token : null;
  const salt = typeof o.salt === "string" && /^[0-9a-f]{16,64}$/.test(o.salt) ? o.salt : null;
  return {
    token,
    audience: o.audience === "lead" ? "lead" : "all",
    pick: strings(o.pick),
    sheets: strings(o.sheets),
    title: typeof o.title === "string" ? o.title : null,
    pushedAt: millis(o.pushedAt),
    seenAt: millis(o.seenAt),
    pushCount: Number(o.pushCount) || 0,
    salt,
  };
}

export function absSheetErrorText(error: unknown, fallback = "Не удалось сохранить"): string {
  const e = (error ?? {}) as { message?: string };
  const msg = e.message ?? "";
  if (isSbMissingError(error)) return "Таблица в ABS ещё не включена в базе — Owner должен обновить SQL.";
  if (msg.includes("read-only")) return "Доступ компании приостановлен.";
  if (msg.includes("only owner")) return "Это может только Owner.";
  if (msg.includes("too many sheets")) return "Листов — не больше 8.";
  return msg ? `${fallback}: ${msg}` : fallback;
}

async function call(fn: string, args: Record<string, unknown>): Promise<AbsSheetConfig> {
  const { data, error } = await supabaseRows.rpc(fn, args);
  if (error) throw error;
  return parseAbsSheetConfig(data);
}

export function fetchAbsSheetConfig(ws: string): Promise<AbsSheetConfig> {
  return call("abs_sheet_config", { p_workspace: ws });
}

function afterChange(ws: string, cfg: AbsSheetConfig): AbsSheetConfig {
  ringTopic(absSheetTopic(ws));
  void load(ws);
  return cfg;
}

export async function newAbsSheetToken(ws: string): Promise<AbsSheetConfig> {
  return afterChange(ws, await call("abs_sheet_new_token", { p_workspace: ws }));
}

export async function saveAbsSheetOptions(ws: string, audience: "all" | "lead", pick: string[]): Promise<AbsSheetConfig> {
  return afterChange(ws, await call("abs_sheet_set", { p_workspace: ws, p_audience: audience, p_pick: pick }));
}

export async function disconnectAbsSheet(ws: string): Promise<AbsSheetConfig> {
  return afterChange(ws, await call("abs_sheet_disconnect", { p_workspace: ws }));
}

/** Текст скрипта для таблицы (null — секрета ещё нет). */
export function absSheetScriptFor(ws: string, cfg: AbsSheetConfig): string | null {
  if (!cfg.token) return null;
  const topic = cfg.salt ? `nova:${ws}~${cfg.salt}:abssheet` : absSheetTopic(ws);
  return buildAbsSheetScript({ url: SUPABASE_URL, key: SUPABASE_ANON_KEY, workspace: ws, token: cfg.token, topic });
}
