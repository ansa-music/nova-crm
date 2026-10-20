import { useEffect, useSyncExternalStore } from "react";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase";
import { supabaseRows } from "@/lib/supabaseRows";
import { isSbMissingError } from "@/services/sb/sbCollections";
import { listenTopic, ringTopic } from "@/services/sb/topicDoorbell";
import {
  OS_SHEET_IDLE as IDLE,
  applyOsSheetResponse,
  rowAt,
  rowKeyOf,
  type OsSheetState,
  type OsSheetTab,
} from "@/utils/osSheet";
import { buildOsSheetScript } from "@/utils/osSheetScript";

export type { OsSheetState } from "@/utils/osSheet";

/**
 * «Таблица ОС» (20.10.2026, SQL 20261053_os_sheet.sql): живая копия
 * Google-таблицы ОС, которую ОС правят прямо из Nova.
 *
 * Чтение — как ABS (services/absSheetService.ts), но дельтой: вкладка помнит
 * версию копии и спрашивает только строки новее (`os_sheet_get(ws, since)`).
 * Скрипт таблицы после передачи звонит в тему `nova:{ws}:ossheet` (солёную);
 * без звонка — опрос раз в 20 с, пока экран открыт и на виду.
 *
 * Правка: ячейка сразу показывает новое значение (накладка), правка уходит в
 * очередь базы (`os_sheet_edit`), браузер будит скрипт запросом на адрес его
 * веб-приложения (`hook`), скрипт пишет в таблицу и в следующей передаче
 * отчитывается. Пока свои правки ждут ответа — опрос каждые 2,5 с. Ответ
 * «готово» приходит вместе с новой строкой (одна транзакция в базе), поэтому
 * накладка снимается сразу; отказ — накладка снимается, правка уходит в
 * список «Не применилось» с причиной.
 *
 * Состояние одно на вкладку браузера (модуль), экраны подписываются хуком.
 */

export const OS_SHEET_POLL_MS = 20_000;
const FAST_POLL_MS = 2_500;
const STALE_MS = 20_000;
/** Будить скрипт не чаще (серия правок — одна побудка). */
const HOOK_COALESCE_MS = 1_200;
export const osSheetTopic = (ws: string) => `nova:${ws}:ossheet`;

export type LocalEditStatus = "sending" | "queued" | "failed";

/** Своя правка, ответа на которую ещё нет (или отказ, который человек ещё не убрал). */
export interface LocalEdit {
  key: string;
  /** Номер в очереди базы (после отправки). */
  id: number | null;
  tab: string;
  /** Ячейка; у новой строки — null. */
  r: number | null;
  c: number | null;
  value: string;
  old: string;
  /** Новая строка: [[столбец, значение], …]. */
  add: Array<[number, string]> | null;
  status: LocalEditStatus;
  reason: string | null;
  at: number;
}

export interface OsSheetSnapshot {
  state: OsSheetState;
  edits: LocalEdit[];
}

interface Entry {
  snap: OsSheetSnapshot;
  inflight: Promise<void> | null;
  again: boolean;
  users: number;
  live: number;
  stopRing: (() => void) | null;
  timer: ReturnType<typeof setInterval> | null;
  fastTimer: ReturnType<typeof setTimeout> | null;
  hookTimer: ReturnType<typeof setTimeout> | null;
}

const EMPTY_SNAP: OsSheetSnapshot = { state: IDLE, edits: [] };
const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let editSeq = 0;

function entryOf(ws: string): Entry {
  let entry = entries.get(ws);
  if (!entry) {
    entry = { snap: EMPTY_SNAP, inflight: null, again: false, users: 0, live: 0, stopRing: null, timer: null, fastTimer: null, hookTimer: null };
    entries.set(ws, entry);
  }
  return entry;
}

function emit() {
  for (const listener of [...listeners]) listener();
}

function setSnap(ws: string, next: Partial<OsSheetSnapshot>) {
  const entry = entryOf(ws);
  entry.snap = { ...entry.snap, ...next };
  emit();
}

const visible = () => typeof document === "undefined" || document.visibilityState === "visible";

function waitingIds(entry: Entry): number[] {
  return entry.snap.edits.filter((e) => e.status === "queued" && e.id !== null).map((e) => e.id as number);
}

/** Пока свои правки ждут ответа — частый опрос (на виду). */
function scheduleFast(ws: string) {
  const entry = entryOf(ws);
  if (entry.fastTimer) return;
  const waiting = entry.snap.edits.some((e) => e.status === "queued" || e.status === "sending");
  if (!waiting) return;
  entry.fastTimer = setTimeout(() => {
    entry.fastTimer = null;
    if (visible()) void load(ws);
    else scheduleFast(ws);
  }, FAST_POLL_MS);
}

async function load(ws: string, opts: { full?: boolean } = {}): Promise<void> {
  const entry = entryOf(ws);
  if (entry.inflight) {
    entry.again = true;
    return entry.inflight;
  }
  if (entry.snap.state.status === "idle") setSnap(ws, { state: { ...entry.snap.state, status: "loading" } });
  entry.inflight = (async () => {
    try {
      const prev = entry.snap.state;
      const since = opts.full || !prev.data ? 0 : prev.ver;
      const ids = waitingIds(entry);
      const { data, error } = await supabaseRows.rpc("os_sheet_get", { p_workspace: ws, p_since: since, p_edits: ids });
      if (error) {
        const missing = isSbMissingError(error);
        if (!missing) console.warn("[os-sheet] read failed", error);
        setSnap(ws, {
          state: prev.data ? { ...prev, checkedAt: Date.now() } : { ...IDLE, status: missing ? "missing" : "error", checkedAt: Date.now() },
        });
        return;
      }
      const res = applyOsSheetResponse(entry.snap.state, data);
      if (res.needFull) {
        entry.again = true;
        entry.snap = { ...entry.snap, state: { ...entry.snap.state, data: null, ver: 0 } };
        return;
      }
      // Ответы по своим правкам: «готово» — накладку снимаем (новая строка уже
      // в этом же ответе), отказ — в список «Не применилось».
      const results = new Map(res.edits.map((e) => [e.id, e]));
      const edits = entry.snap.edits.flatMap((e): LocalEdit[] => {
        if (e.id === null || e.status !== "queued") return [e];
        const result = results.get(e.id);
        if (!result || result.status === "pending") return [e];
        if (result.status === "done") return [];
        return [{ ...e, status: "failed", reason: result.reason ?? "failed" }];
      });
      // Отключили таблицу — ждать нечего.
      const settled = res.state.connected ? edits : edits.filter((e) => e.status === "failed");
      setSnap(ws, { state: res.state, edits: settled });
    } catch (error) {
      console.warn("[os-sheet] read failed", error);
      if (!entry.snap.state.data) setSnap(ws, { state: { ...IDLE, status: "error", checkedAt: Date.now() } });
    } finally {
      entry.inflight = null;
      if (entry.again) {
        entry.again = false;
        void load(ws);
      } else {
        scheduleFast(ws);
      }
    }
  })();
  return entry.inflight;
}

let visibilityBound = false;
function bindVisibility() {
  if (visibilityBound || typeof document === "undefined") return;
  visibilityBound = true;
  const onBack = () => {
    if (!visible()) return;
    for (const [ws, entry] of entries) {
      if (entry.users > 0 && Date.now() - entry.snap.state.checkedAt > STALE_MS) void load(ws);
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
    entry.stopRing = listenTopic(osSheetTopic(ws), () => {
      if (visible()) void load(ws);
      else entry.snap = { ...entry.snap, state: { ...entry.snap.state, checkedAt: 0 } };
    });
  }
  if (live && !entry.timer) {
    entry.timer = setInterval(() => {
      if (entry.live > 0 && visible()) void load(ws);
    }, OS_SHEET_POLL_MS);
  }
  bindVisibility();
  const st = entry.snap.state;
  if (st.status === "idle" || st.status === "error" || Date.now() - st.checkedAt > STALE_MS) void load(ws);
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
 * Копия таблицы и свои правки. `enabled: false` — не читать (суммы скрыты).
 * `live` — экран её показывает: опрос раз в 20 с на виду.
 */
export function useOsSheet(ws: string | null | undefined, enabled: boolean, live: boolean): OsSheetSnapshot {
  const active = Boolean(ws && enabled);
  useEffect(() => {
    if (!ws || !enabled) return;
    return retain(ws, live);
  }, [ws, enabled, live]);
  return useSyncExternalStore(subscribe, () => (active && ws ? entryOf(ws).snap : EMPTY_SNAP));
}

export function refreshOsSheet(ws: string): Promise<void> {
  return load(ws);
}

// ---------------------------------------------------------------------------
// Правки.

/** Разбудить скрипт таблицы: он заберёт очередь сразу, а не на минутном тике. */
function wakeScript(ws: string, hook: string | null) {
  if (!hook || typeof fetch === "undefined") return;
  const entry = entryOf(ws);
  if (entry.hookTimer) return;
  entry.hookTimer = setTimeout(() => {
    entry.hookTimer = null;
    // no-cors: ответ скрипта нам не нужен — «готово» придёт через базу.
    void fetch(hook, { method: "POST", mode: "no-cors", body: "nova", keepalive: true }).catch(() => undefined);
  }, HOOK_COALESCE_MS);
}

/** Значение ячейки, как его видит человек: своя ждущая правка поверх копии. */
export function effectiveValue(snap: OsSheetSnapshot, tab: OsSheetTab, r: number, c: number): string {
  for (let i = snap.edits.length - 1; i >= 0; i--) {
    const e = snap.edits[i];
    if (e.status !== "failed" && e.tab === tab.meta.name && e.r === r && e.c === c) return e.value;
  }
  return rowAt(tab, r).cells[c] ?? "";
}

export interface CellEditInput {
  r: number;
  c: number;
  value: string;
}

export class OsSheetEditError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
  }
}

async function send(ws: string, local: LocalEdit[], payload: unknown[]): Promise<void> {
  const entry = entryOf(ws);
  setSnap(ws, { edits: [...entry.snap.edits, ...local] });
  const keys = new Set(local.map((e) => e.key));
  try {
    const { data, error } = await supabaseRows.rpc("os_sheet_edit", { p_workspace: ws, p_edits: payload });
    if (error) throw error;
    const o = (typeof data === "string" ? JSON.parse(data) : data) as { ids?: unknown; hook?: unknown } | null;
    const ids = Array.isArray(o?.ids) ? o.ids.map(Number) : [];
    let i = 0;
    setSnap(ws, {
      edits: entryOf(ws).snap.edits.map((e) => (keys.has(e.key) ? { ...e, id: Number.isInteger(ids[i]) ? ids[i++] : null, status: "queued" } : e)),
    });
    wakeScript(ws, typeof o?.hook === "string" ? o.hook : entryOf(ws).snap.state.hook);
    scheduleFast(ws);
  } catch (error) {
    // Не легло в очередь — накладку снимаем, ошибку отдаём экрану.
    setSnap(ws, { edits: entryOf(ws).snap.edits.filter((e) => !keys.has(e.key)) });
    throw error;
  }
}

/** Правки ячеек одного листа (одна или пачка — вставка). */
export async function editOsSheetCells(ws: string, tab: OsSheetTab, cells: CellEditInput[]): Promise<void> {
  if (cells.length === 0) return;
  const snap = entryOf(ws).snap;
  const at = Date.now();
  // Ключ строки — как его видит человек сейчас (со своими ждущими правками и
  // с правками этой же пачки выше по списку): скрипт применяет правки по
  // порядку, так что ключ сойдётся и после смены имени в той же вставке.
  const batch = new Map<string, string>();
  const valueAt = (r: number, c: number) => batch.get(`${r}:${c}`) ?? effectiveValue(snap, tab, r, c);
  const local: LocalEdit[] = [];
  const payload: unknown[] = [];
  for (const cell of cells.slice(0, 200)) {
    const old = valueAt(cell.r, cell.c);
    if (old === cell.value) continue;
    const key = rowKeyOf(tab, cell.r, valueAt, cell.c);
    batch.set(`${cell.r}:${cell.c}`, cell.value);
    local.push({
      key: `e${++editSeq}`,
      id: null,
      tab: tab.meta.name,
      r: cell.r,
      c: cell.c,
      value: cell.value,
      old,
      add: null,
      status: "sending",
      reason: null,
      at,
    });
    payload.push({ tab: tab.meta.name, r: cell.r, c: cell.c, v: cell.value, o: old, k: key });
  }
  if (payload.length === 0) return;
  await send(ws, local, payload);
}

/** Новая строка в конец листа. */
export async function addOsSheetRow(ws: string, tab: OsSheetTab, cells: Array<[number, string]>): Promise<void> {
  const filled = cells.filter(([, v]) => v.trim() !== "");
  if (filled.length === 0) throw new OsSheetEditError("empty");
  const local: LocalEdit = {
    key: `e${++editSeq}`,
    id: null,
    tab: tab.meta.name,
    r: null,
    c: null,
    value: "",
    old: "",
    add: filled,
    status: "sending",
    reason: null,
    at: Date.now(),
  };
  await send(ws, [local], [{ tab: tab.meta.name, add: filled }]);
}

/** Убрать отказ из списка «Не применилось». */
export function dismissOsSheetEdit(ws: string, key: string) {
  setSnap(ws, { edits: entryOf(ws).snap.edits.filter((e) => e.key !== key) });
}

/** Повторить отказ: та же правка заново (ключ строки — по нынешней копии). */
export async function retryOsSheetEdit(ws: string, key: string): Promise<void> {
  const entry = entryOf(ws);
  const edit = entry.snap.edits.find((e) => e.key === key);
  const tab = entry.snap.state.data?.tabs.find((t) => t.meta.name === edit?.tab);
  if (!edit || !tab) return;
  dismissOsSheetEdit(ws, key);
  if (edit.add) await addOsSheetRow(ws, tab, edit.add);
  else if (edit.r !== null && edit.c !== null) await editOsSheetCells(ws, tab, [{ r: edit.r, c: edit.c, value: edit.value }]);
}

export function osSheetErrorText(error: unknown, fallback = "Не удалось сохранить"): string {
  const e = (error ?? {}) as { message?: string; code?: string };
  const msg = e.message ?? "";
  if (isSbMissingError(error)) return "Таблица ОС ещё не включена в базе — Owner должен обновить SQL.";
  if (msg.includes("read-only")) return "Доступ компании приостановлен.";
  if (msg.includes("only owner")) return "Это может только Owner.";
  if (msg.includes("cannot edit")) return "Править таблицу ОС могут ОС и руководство.";
  if (msg.includes("not connected")) return "Таблица ещё не подключена.";
  if (msg.includes("formula cell")) return "Это ячейка с формулой — она считается в таблице сама.";
  if (msg.includes("bad cell")) return "Эту ячейку не правят: шапка или строки уже нет.";
  if (msg.includes("no such tab")) return "Этого листа уже нет в таблице — обновите страницу.";
  if (msg.includes("queue full")) return "Таблица не успевает: в очереди слишком много правок. Подождите минуту.";
  if (msg.includes("too many sheets")) return "Листов — не больше 4.";
  if (msg.includes("bad hook")) return "Адрес веб-приложения должен быть вида https://script.google.com/macros/s/…/exec";
  return msg ? `${fallback}: ${msg}` : fallback;
}

// ---------------------------------------------------------------------------
// Настройка — только Owner.

export interface OsSheetConfig {
  token: string | null;
  audience: "os" | "all";
  pick: string[];
  sheets: string[];
  title: string | null;
  source: string | null;
  hook: string | null;
  pushedAt: number | null;
  seenAt: number | null;
  pulledAt: number | null;
  pushCount: number;
  pending: number;
  salt: string | null;
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

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
}

export function parseOsSheetConfig(data: unknown): OsSheetConfig {
  const o = asObject(data);
  return {
    token: typeof o.token === "string" && /^[0-9a-f]{64}$/.test(o.token) ? o.token : null,
    audience: o.audience === "all" ? "all" : "os",
    pick: strings(o.pick),
    sheets: strings(o.sheets),
    title: typeof o.title === "string" ? o.title : null,
    source: typeof o.source === "string" ? o.source : null,
    hook: typeof o.hook === "string" ? o.hook : null,
    pushedAt: millis(o.pushedAt),
    seenAt: millis(o.seenAt),
    pulledAt: millis(o.pulledAt),
    pushCount: Number(o.pushCount) || 0,
    pending: Number(o.pending) || 0,
    salt: typeof o.salt === "string" && /^[0-9a-f]{16,64}$/.test(o.salt) ? o.salt : null,
  };
}

async function call(fn: string, args: Record<string, unknown>): Promise<OsSheetConfig> {
  const { data, error } = await supabaseRows.rpc(fn, args);
  if (error) throw error;
  return parseOsSheetConfig(data);
}

export function fetchOsSheetConfig(ws: string): Promise<OsSheetConfig> {
  return call("os_sheet_config", { p_workspace: ws });
}

function afterChange(ws: string, cfg: OsSheetConfig): OsSheetConfig {
  ringTopic(osSheetTopic(ws));
  void load(ws);
  return cfg;
}

export async function newOsSheetToken(ws: string): Promise<OsSheetConfig> {
  return afterChange(ws, await call("os_sheet_new_token", { p_workspace: ws }));
}

export async function saveOsSheetOptions(ws: string, audience: "os" | "all", pick: string[], hook: string | null): Promise<OsSheetConfig> {
  return afterChange(ws, await call("os_sheet_set", { p_workspace: ws, p_audience: audience, p_pick: pick, p_hook: hook ?? "" }));
}

export async function disconnectOsSheet(ws: string): Promise<OsSheetConfig> {
  const cfg = await call("os_sheet_disconnect", { p_workspace: ws });
  setSnap(ws, { edits: [] });
  return afterChange(ws, cfg);
}

/** Текст скрипта для таблицы (null — секрета ещё нет). */
export function osSheetScriptFor(ws: string, cfg: OsSheetConfig): string | null {
  if (!cfg.token) return null;
  const topic = cfg.salt ? `nova:${ws}~${cfg.salt}:ossheet` : osSheetTopic(ws);
  return buildOsSheetScript({ url: SUPABASE_URL, key: SUPABASE_ANON_KEY, workspace: ws, token: cfg.token, topic });
}
