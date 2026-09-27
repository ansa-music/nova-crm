import { useEffect, useSyncExternalStore } from "react";
import { supabaseRows } from "@/lib/supabaseRows";
import { isSbMissingError } from "@/services/sb/sbCollections";
import { listenTopic, ringTopic } from "@/services/sb/topicDoorbell";
import { memberHasRole, type WorkspaceMember } from "@/types";

/**
 * Еженедельная анонимная оценка (27.09.2026, SQL 20261032_weekly_ratings.sql).
 *
 * ОС раз в неделю ставит каждому технарю балл 1–10, технари — каждому ОС.
 * Кто и сколько поставил, база не отдаёт никому: свои оценки видит только сам
 * оценивший, наружу — средний балл по человеку за ЗАКРЫТУЮ неделю и только
 * если оценивших не меньше порога Owner. Owner выключает сбор и скрывает
 * итоги (`weekly_rating_set_config`).
 *
 * Состояние одно на вкладку (модуль): страница, меню, «Технари» и ABS читают
 * его через `useWeeklyRating` — один запрос на загрузку, перечитка при
 * возврате на вкладку (не чаще раза в 10 минут) и по звонку после смены
 * настройки Owner. Свои оценки звонком НЕ разносятся: момент, когда кто-то
 * оценил, — тоже след.
 */

export type WeeklyDirection = "os_tech" | "tech_os";

export interface WeeklyRatingState {
  enabled: boolean;
  visible: boolean;
  minRaters: number;
  week: string;
  weekStart: string;
  weekEnd: string;
  /** Owner по базе (настоящая роль, не режим роли). */
  isOwner: boolean;
  canRate: Record<WeeklyDirection, boolean>;
  /** Мои оценки текущей недели: ключ `${direction}:${uid}`. */
  mine: Record<string, number>;
  /** Только у Owner: сколько уже оценили из скольких. */
  progress: Record<WeeklyDirection, { rated: number; raters: number }> | null;
}

export interface WeeklyResultRow {
  week: string;
  direction: WeeklyDirection;
  target: string;
  avg: number;
  count: number;
}

export interface WeeklyResults {
  /** Owner скрыл итоги (Owner их всё равно получает). */
  hidden: boolean;
  minRaters: number;
  /** Закрытые недели, новые первыми. */
  weeks: string[];
  rows: WeeklyResultRow[];
}

export type WeeklyStatus = "idle" | "loading" | "ready" | "missing" | "error";

export interface WeeklySnapshot {
  status: WeeklyStatus;
  state: WeeklyRatingState | null;
  results: WeeklyResults | null;
}

const IDLE: WeeklySnapshot = { status: "idle", state: null, results: null };
const STALE_MS = 10 * 60_000;

const topicOf = (ws: string) => `nova:${ws}:weekly`;
export const mineKey = (direction: WeeklyDirection, uid: string) => `${direction}:${uid}`;

interface Entry {
  snap: WeeklySnapshot;
  loadedAt: number;
  inflight: Promise<void> | null;
  users: number;
  stopRing: (() => void) | null;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();

function entryOf(ws: string): Entry {
  let entry = entries.get(ws);
  if (!entry) {
    entry = { snap: IDLE, loadedAt: 0, inflight: null, users: 0, stopRing: null };
    entries.set(ws, entry);
  }
  return entry;
}

function emit() {
  for (const listener of [...listeners]) listener();
}

function setSnap(ws: string, snap: WeeklySnapshot) {
  entryOf(ws).snap = snap;
  emit();
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
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

const DIRECTIONS: WeeklyDirection[] = ["os_tech", "tech_os"];

export function parseWeeklyState(data: unknown): WeeklyRatingState {
  const o = asObject(data);
  const canRate = asObject(o.canRate);
  const mine: Record<string, number> = {};
  for (const item of Array.isArray(o.mine) ? o.mine : []) {
    const r = asObject(item);
    const dir = r.direction as WeeklyDirection;
    if (!DIRECTIONS.includes(dir) || typeof r.target !== "string") continue;
    mine[mineKey(dir, r.target)] = num(r.score);
  }
  const progressRaw = o.progress ? asObject(o.progress) : null;
  const progress = progressRaw
    ? (Object.fromEntries(
        DIRECTIONS.map((d) => {
          const p = asObject(progressRaw[d]);
          return [d, { rated: num(p.rated), raters: num(p.raters) }];
        })
      ) as Record<WeeklyDirection, { rated: number; raters: number }>)
    : null;
  return {
    enabled: o.enabled !== false,
    visible: o.visible !== false,
    minRaters: num(o.minRaters, 3),
    week: String(o.week ?? ""),
    weekStart: String(o.weekStart ?? ""),
    weekEnd: String(o.weekEnd ?? ""),
    isOwner: o.isOwner === true,
    canRate: { os_tech: canRate.os_tech === true, tech_os: canRate.tech_os === true },
    mine,
    progress,
  };
}

export function parseWeeklyResults(data: unknown): WeeklyResults {
  const o = asObject(data);
  const rows: WeeklyResultRow[] = [];
  for (const item of Array.isArray(o.rows) ? o.rows : []) {
    const r = asObject(item);
    const dir = r.direction as WeeklyDirection;
    if (!DIRECTIONS.includes(dir) || typeof r.target !== "string" || typeof r.week !== "string") continue;
    rows.push({ week: r.week, direction: dir, target: r.target, avg: num(r.avg), count: num(r.count) });
  }
  return {
    hidden: o.hidden === true,
    minRaters: num(o.minRaters, 3),
    weeks: Array.isArray(o.weeks) ? o.weeks.map(String) : [],
    rows,
  };
}

async function load(ws: string): Promise<void> {
  const entry = entryOf(ws);
  if (entry.inflight) return entry.inflight;
  if (entry.snap.status === "idle") setSnap(ws, { ...entry.snap, status: "loading" });
  entry.inflight = (async () => {
    try {
      const [state, results] = await Promise.all([
        supabaseRows.rpc("weekly_rating_state", { p_workspace: ws }),
        supabaseRows.rpc("weekly_rating_results", { p_workspace: ws, p_weeks: 8 }),
      ]);
      const error = state.error ?? results.error;
      if (error) {
        const missing = isSbMissingError(error);
        if (!missing) console.warn("[weekly-rating] read failed", error);
        // Сбой сети не стирает уже показанное.
        setSnap(ws, entry.snap.state ? entry.snap : { status: missing ? "missing" : "error", state: null, results: null });
        return;
      }
      entry.loadedAt = Date.now();
      setSnap(ws, { status: "ready", state: parseWeeklyState(state.data), results: parseWeeklyResults(results.data) });
    } catch (error) {
      console.warn("[weekly-rating] read failed", error);
      if (!entry.snap.state) setSnap(ws, { status: "error", state: null, results: null });
    } finally {
      entry.inflight = null;
    }
  })();
  return entry.inflight;
}

/** Перечитать сейчас (после смены недели, «Повторить»). */
export function refreshWeeklyRating(ws: string) {
  return load(ws);
}

function onVisible() {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
  for (const [ws, entry] of entries) {
    if (entry.users > 0 && Date.now() - entry.loadedAt > STALE_MS) void load(ws);
  }
}

let visibilityBound = false;
function bindVisibility() {
  if (visibilityBound || typeof document === "undefined") return;
  visibilityBound = true;
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
  // Смена недели в понедельник: вкладку не перезагружают днями.
  window.setInterval(onVisible, STALE_MS);
}

function retain(ws: string) {
  const entry = entryOf(ws);
  entry.users += 1;
  if (!entry.stopRing) entry.stopRing = listenTopic(topicOf(ws), () => void load(ws));
  bindVisibility();
  if (entry.snap.status === "idle" || Date.now() - entry.loadedAt > STALE_MS) void load(ws);
  return () => {
    entry.users -= 1;
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

export function useWeeklyRating(ws: string | null | undefined, enabled = true): WeeklySnapshot {
  const active = Boolean(ws) && enabled;
  useEffect(() => {
    if (!active || !ws) return;
    return retain(ws);
  }, [active, ws]);
  return useSyncExternalStore(subscribe, () => (active && ws ? entryOf(ws).snap : IDLE));
}

function ratingErrorText(error: { code?: string; message?: string }): string {
  const msg = error.message ?? "";
  if (isSbMissingError(error)) return "Оценка ещё не включена в базе — Owner должен обновить SQL.";
  if (msg.includes("weekly rating is off")) return "Owner выключил сбор оценок.";
  if (msg.includes("suspended")) return "Доступ компании приостановлен.";
  if (msg.includes("yourself")) return "Себя оценивать нельзя.";
  if (msg.includes("not a rateable")) return "Этого человека сейчас оценить нельзя — его роль сменилась.";
  if (msg.includes("not a rater")) return "Ваша роль не ставит эту оценку.";
  if (error.code === "42501") return "Нет права поставить оценку.";
  return `Не удалось сохранить оценку${error.code ? ` (${error.code})` : ""}.`;
}

/**
 * Поставить (1–10) или снять (null) свою оценку текущей недели. На экране —
 * сразу, отказ возвращает прежнее и бросает ошибку с текстом для тоста.
 */
export async function rateWeekly(ws: string, direction: WeeklyDirection, target: string, score: number | null) {
  const entry = entryOf(ws);
  const before = entry.snap;
  const key = mineKey(direction, target);
  if (before.state) {
    const mine = { ...before.state.mine };
    if (score === null) delete mine[key];
    else mine[key] = score;
    setSnap(ws, { ...before, state: { ...before.state, mine } });
  }
  const { error } = await supabaseRows.rpc("weekly_rate", {
    p_workspace: ws,
    p_direction: direction,
    p_target: target,
    p_score: score,
  });
  if (error) {
    const current = entryOf(ws).snap;
    if (current.state && before.state) {
      const mine = { ...current.state.mine };
      if (key in before.state.mine) mine[key] = before.state.mine[key];
      else delete mine[key];
      setSnap(ws, { ...current, state: { ...current.state, mine } });
    }
    throw new Error(ratingErrorText(error));
  }
}

/** Выключатели Owner. Остальные вкладки узнают по звонку. */
export async function setWeeklyRatingConfig(
  ws: string,
  patch: { enabled?: boolean; visible?: boolean; minRaters?: number }
) {
  const { error } = await supabaseRows.rpc("weekly_rating_set_config", {
    p_workspace: ws,
    p_enabled: patch.enabled ?? null,
    p_visible: patch.visible ?? null,
    p_min_raters: patch.minRaters ?? null,
  });
  if (error) {
    if (isSbMissingError(error)) throw new Error("Оценка ещё не включена в базе — обновите SQL.");
    throw new Error(error.code === "42501" ? "Менять настройку оценки может только Owner." : `Не удалось сохранить настройку (${error.code ?? "ошибка"}).`);
  }
  await load(ws);
  ringTopic(topicOf(ws));
}

// ---------------------------------------------------------------------
// Кто кого оценивает — та же граница, что в базе (weekly_is_os/weekly_is_tech).
// ---------------------------------------------------------------------

export function isWeeklyTech(member: WorkspaceMember): boolean {
  return memberHasRole(member, "manager") || member.role === "owner";
}

export function isWeeklyOs(member: WorkspaceMember): boolean {
  return memberHasRole(member, "os");
}

/** Кого оценивает человек в этом направлении (без себя и без ушедших). */
export function weeklyTargets(members: WorkspaceMember[], direction: WeeklyDirection, myUid: string): WorkspaceMember[] {
  const pick = direction === "os_tech" ? isWeeklyTech : isWeeklyOs;
  return members.filter((m) => m.uid && m.uid !== myUid && m.status !== "invited" && pick(m));
}

/** Сколько ещё оценить на этой неделе (для бейджа меню). */
export function weeklyLeftToRate(snap: WeeklySnapshot, members: WorkspaceMember[], myUid: string | null): number {
  const state = snap.state;
  if (!state || !state.enabled || !myUid) return 0;
  let left = 0;
  for (const dir of DIRECTIONS) {
    if (!state.canRate[dir]) continue;
    for (const m of weeklyTargets(members, dir, myUid)) if (!(mineKey(dir, m.uid) in state.mine)) left += 1;
  }
  return left;
}

// ---------------------------------------------------------------------
// Итоги по человеку.
// ---------------------------------------------------------------------

export interface WeeklyScore {
  /** Средний балл последней закрытой недели, где он есть. */
  avg: number;
  count: number;
  week: string;
  /** Изменение к неделе до неё (если там тоже был итог). */
  delta: number | null;
  /** Среднее за последние 4 закрытые недели (взвешено по числу оценок). */
  avg4: number | null;
  /** Баллы по неделям, новые первыми (null — мало оценок). */
  history: (number | null)[];
}

export function weeklyScoreOf(results: WeeklyResults | null, direction: WeeklyDirection, uid: string): WeeklyScore | null {
  if (!results || results.weeks.length === 0) return null;
  const byWeek = new Map<string, WeeklyResultRow>();
  for (const row of results.rows) if (row.direction === direction && row.target === uid) byWeek.set(row.week, row);
  if (byWeek.size === 0) return null;
  const history = results.weeks.map((w) => byWeek.get(w)?.avg ?? null);
  // Показываем именно прошлую неделю: если её нет, человек «без оценки
  // недели», а не со старым баллом месячной давности.
  const last = byWeek.get(results.weeks[0]);
  if (!last) return null;
  const prev = byWeek.get(results.weeks[1] ?? "");
  let sum = 0;
  let cnt = 0;
  for (const w of results.weeks.slice(0, 4)) {
    const row = byWeek.get(w);
    if (!row) continue;
    sum += row.avg * row.count;
    cnt += row.count;
  }
  return {
    avg: last.avg,
    count: last.count,
    week: last.week,
    delta: prev ? Math.round((last.avg - prev.avg) * 10) / 10 : null,
    avg4: cnt ? Math.round((sum / cnt) * 10) / 10 : null,
    history,
  };
}

/** Итоги для общих экранов (ABS, «Технари»): скрытые — не показываем никому. */
export function publicWeeklyResults(snap: WeeklySnapshot): WeeklyResults | null {
  const results = snap.results;
  if (!results || results.hidden) return null;
  return results;
}

// ---------------------------------------------------------------------
// Подписи недель.
// ---------------------------------------------------------------------

const DAY_MS = 86_400_000;

/** Понедельник ISO-недели «2026-W39» (UTC-полночь), или null. */
export function isoWeekMonday(weekKey: string): number | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  const jan4 = Date.UTC(year, 0, 4);
  const dow = (new Date(jan4).getUTCDay() + 6) % 7;
  return jan4 - dow * DAY_MS + (week - 1) * 7 * DAY_MS;
}

const monthShort = new Intl.DateTimeFormat("ru-RU", { month: "short", timeZone: "UTC" });

function monthOf(ms: number) {
  return monthShort.format(ms).replace(/\.$/, "");
}

/** «22–28 сент» или «29 сент – 5 окт». */
export function weekLabel(weekKey: string): string {
  const monday = isoWeekMonday(weekKey);
  if (monday === null) return weekKey;
  const sunday = monday + 6 * DAY_MS;
  const a = new Date(monday);
  const b = new Date(sunday);
  if (a.getUTCMonth() === b.getUTCMonth()) return `${a.getUTCDate()}–${b.getUTCDate()} ${monthOf(sunday)}`;
  return `${a.getUTCDate()} ${monthOf(monday)} – ${b.getUTCDate()} ${monthOf(sunday)}`;
}

/** Подпись недели из дат «YYYY-MM-DD» (текущая неделя из состояния). */
export function rangeLabel(start: string, end: string): string {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return "";
  const da = new Date(a);
  const db = new Date(b);
  if (da.getUTCMonth() === db.getUTCMonth()) return `${da.getUTCDate()}–${db.getUTCDate()} ${monthOf(b)}`;
  return `${da.getUTCDate()} ${monthOf(a)} – ${db.getUTCDate()} ${monthOf(b)}`;
}
