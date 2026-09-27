import { useEffect, useSyncExternalStore } from "react";
import { supabaseRows } from "@/lib/supabaseRows";
import { isSbMissingError } from "@/services/sb/sbCollections";
import { listenTopic, ringTopic } from "@/services/sb/topicDoorbell";
import { sendNotification } from "@/services/notificationService";
import { zonedDateFormat } from "@/utils/date";
import { memberHasRole, type WorkspaceMember } from "@/types";

/**
 * Оценка раундами (27.09.2026, SQL 20261033_rating_rounds.sql).
 *
 * Два направления: `os_tech` — ОС оценивают технарей, `tech_os` — технари (и
 * Owner) оценивают ОС. Раунд открывает управляющий оценками (Owner или тот,
 * кому Owner дал право — это привилегия, не роль) кнопкой «Еженедельная
 * оценка»: всем, кто оценивает, приходит уведомление. Закрывает он же —
 * «Завершить», и тогда появляется итог. Кто и сколько поставил, база не отдаёт
 * никому: свои оценки видит только сам оценивший, наружу — средний балл по
 * человеку у закрытых раундов и только если оценивших не меньше порога.
 *
 * Состояние одно на вкладку (модуль): страница, меню, «Технари» и ABS читают
 * его через `useWeeklyRating` — два запроса на загрузку, перечитка при
 * возврате на вкладку (не чаще раза в 3 минуты), раз в 10 минут и по звонку
 * `nova:{ws}:weekly` после открытия/закрытия раунда и смены настройки. Свои
 * оценки звонком НЕ разносятся: момент, когда кто-то оценил, — тоже след.
 */

export type WeeklyDirection = "os_tech" | "tech_os";
export const WEEKLY_DIRECTIONS: WeeklyDirection[] = ["os_tech", "tech_os"];

export interface RatingRound {
  id: string;
  direction: WeeklyDirection;
  status: "open" | "closed" | "cancelled";
  openedAt: number;
  openedBy: string | null;
  closedAt: number | null;
}

export interface WeeklyRatingState {
  /** Оценка технарей (ОС → технари) включена. */
  rateTechs: boolean;
  /** Оценка ОС (технари → ОС) включена. */
  rateOs: boolean;
  visible: boolean;
  minRaters: number;
  /** Кто не участвует (не оценивает и не оценивается). */
  excluded: string[];
  isOwner: boolean;
  /** Управляет оценками: Owner или назначенный. */
  isManager: boolean;
  /** Только управляющему. */
  managers: string[];
  canRate: Record<WeeklyDirection, boolean>;
  open: Record<WeeklyDirection, RatingRound | null>;
  /** Мои оценки открытых раундов: ключ `${round}:${uid}`. */
  mine: Record<string, number>;
  /** Только управляющему: сколько уже оценили из скольких. */
  progress: Partial<Record<WeeklyDirection, { rated: number; raters: number }>>;
}

export interface WeeklyResultRow {
  round: string;
  target: string;
  avg: number;
  count: number;
}

export interface WeeklyResults {
  /** Итоги скрыты (их видят только Owner и управляющие). */
  hidden: boolean;
  minRaters: number;
  /** Закрытые раунды, новые первыми. */
  rounds: RatingRound[];
  rows: WeeklyResultRow[];
}

export type WeeklyStatus = "idle" | "loading" | "ready" | "missing" | "error";

export interface WeeklySnapshot {
  status: WeeklyStatus;
  state: WeeklyRatingState | null;
  results: WeeklyResults | null;
}

const IDLE: WeeklySnapshot = { status: "idle", state: null, results: null };
const STALE_MS = 3 * 60_000;
const POLL_MS = 10 * 60_000;

const topicOf = (ws: string) => `nova:${ws}:weekly`;
export const mineKey = (round: string, uid: string) => `${round}:${uid}`;
export const DIRECTION_ON: Record<WeeklyDirection, keyof Pick<WeeklyRatingState, "rateTechs" | "rateOs">> = {
  os_tech: "rateTechs",
  tech_os: "rateOs",
};

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

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function parseRound(v: unknown): RatingRound | null {
  const o = asObject(v);
  const direction = o.direction as WeeklyDirection;
  if (typeof o.id !== "string" || !WEEKLY_DIRECTIONS.includes(direction)) return null;
  const status = o.status === "closed" || o.status === "cancelled" ? o.status : "open";
  return {
    id: o.id,
    direction,
    status,
    openedAt: num(o.openedAt),
    openedBy: typeof o.openedBy === "string" ? o.openedBy : null,
    closedAt: o.closedAt == null ? null : num(o.closedAt),
  };
}

export function parseWeeklyState(data: unknown): WeeklyRatingState {
  const o = asObject(data);
  const canRate = asObject(o.canRate);
  const openRaw = asObject(o.open);
  const mine: Record<string, number> = {};
  for (const item of Array.isArray(o.mine) ? o.mine : []) {
    const r = asObject(item);
    if (typeof r.round !== "string" || typeof r.target !== "string") continue;
    mine[mineKey(r.round, r.target)] = num(r.score);
  }
  const progressRaw = asObject(o.progress);
  const progress: WeeklyRatingState["progress"] = {};
  for (const d of WEEKLY_DIRECTIONS) {
    if (!progressRaw[d]) continue;
    const p = asObject(progressRaw[d]);
    progress[d] = { rated: num(p.rated), raters: num(p.raters) };
  }
  return {
    rateTechs: o.rateTechs !== false,
    rateOs: o.rateOs !== false,
    visible: o.visible !== false,
    minRaters: num(o.minRaters, 3),
    excluded: strings(o.excluded),
    isOwner: o.isOwner === true,
    isManager: o.isManager === true,
    managers: strings(o.managers),
    canRate: { os_tech: canRate.os_tech === true, tech_os: canRate.tech_os === true },
    open: { os_tech: parseRound(openRaw.os_tech), tech_os: parseRound(openRaw.tech_os) },
    mine,
    progress,
  };
}

export function parseWeeklyResults(data: unknown): WeeklyResults {
  const o = asObject(data);
  const rounds = (Array.isArray(o.rounds) ? o.rounds : [])
    .map(parseRound)
    .filter((r): r is RatingRound => Boolean(r))
    .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
  const rows: WeeklyResultRow[] = [];
  for (const item of Array.isArray(o.rows) ? o.rows : []) {
    const r = asObject(item);
    if (typeof r.round !== "string" || typeof r.target !== "string") continue;
    rows.push({ round: r.round, target: r.target, avg: num(r.avg), count: num(r.count) });
  }
  return { hidden: o.hidden === true, minRaters: num(o.minRaters, 3), rounds, rows };
}

async function load(ws: string): Promise<void> {
  const entry = entryOf(ws);
  if (entry.inflight) return entry.inflight;
  if (entry.snap.status === "idle") setSnap(ws, { ...entry.snap, status: "loading" });
  entry.inflight = (async () => {
    try {
      const [state, results] = await Promise.all([
        supabaseRows.rpc("rating_state", { p_workspace: ws }),
        supabaseRows.rpc("rating_results", { p_workspace: ws, p_rounds: 8 }),
      ]);
      const error = state.error ?? results.error;
      if (error) {
        const missing = isSbMissingError(error);
        if (!missing) console.warn("[rating] read failed", error);
        setSnap(ws, entry.snap.state ? entry.snap : { status: missing ? "missing" : "error", state: null, results: null });
        return;
      }
      entry.loadedAt = Date.now();
      setSnap(ws, { status: "ready", state: parseWeeklyState(state.data), results: parseWeeklyResults(results.data) });
    } catch (error) {
      console.warn("[rating] read failed", error);
      if (!entry.snap.state) setSnap(ws, { status: "error", state: null, results: null });
    } finally {
      entry.inflight = null;
    }
  })();
  return entry.inflight;
}

/** Перечитать сейчас («Повторить»). */
export function refreshWeeklyRating(ws: string) {
  return load(ws);
}

function refreshStale(maxAge: number) {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
  for (const [ws, entry] of entries) {
    if (entry.users > 0 && Date.now() - entry.loadedAt > maxAge) void load(ws);
  }
}

let visibilityBound = false;
function bindVisibility() {
  if (visibilityBound || typeof document === "undefined") return;
  visibilityBound = true;
  const onBack = () => refreshStale(STALE_MS);
  document.addEventListener("visibilitychange", onBack);
  window.addEventListener("focus", onBack);
  window.setInterval(() => refreshStale(POLL_MS - 1000), POLL_MS);
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

function ratingErrorText(error: { code?: string; message?: string }, fallback: string): string {
  const msg = error.message ?? "";
  if (isSbMissingError(error)) return "Оценка ещё не включена в базе — Owner должен обновить SQL.";
  if (msg.includes("direction is off")) return "Эта оценка выключена в настройке.";
  if (msg.includes("round is not open")) return "Оценка уже завершена — обновите страницу.";
  if (msg.includes("suspended")) return "Доступ компании приостановлен.";
  if (msg.includes("yourself")) return "Себя оценивать нельзя.";
  if (msg.includes("not a rateable")) return "Этого человека сейчас оценить нельзя.";
  if (msg.includes("not a rater")) return "Вы в этой оценке не участвуете.";
  if (msg.includes("rating manager") || msg.includes("only owner")) return "Нет права управлять оценками.";
  if (error.code === "42501") return "Нет права.";
  return `${fallback}${error.code ? ` (${error.code})` : ""}.`;
}

function patchState(ws: string, fn: (state: WeeklyRatingState) => WeeklyRatingState) {
  const snap = entryOf(ws).snap;
  if (snap.state) setSnap(ws, { ...snap, state: fn(snap.state) });
}

/**
 * Поставить (1–10) или снять (null) свою оценку в открытом раунде. На экране —
 * сразу, отказ возвращает прежнее и бросает ошибку с текстом для тоста.
 */
export async function rateWeekly(ws: string, roundId: string, target: string, score: number | null) {
  const key = mineKey(roundId, target);
  const before = entryOf(ws).snap.state?.mine[key];
  patchState(ws, (s) => {
    const mine = { ...s.mine };
    if (score === null) delete mine[key];
    else mine[key] = score;
    return { ...s, mine };
  });
  const { error } = await supabaseRows.rpc("rating_vote", {
    p_workspace: ws,
    p_round: roundId,
    p_target: target,
    p_score: score,
  });
  if (error) {
    patchState(ws, (s) => {
      const mine = { ...s.mine };
      if (before === undefined) delete mine[key];
      else mine[key] = before;
      return { ...s, mine };
    });
    if (error.message?.includes("round is not open")) void load(ws);
    throw new Error(ratingErrorText(error, "Не удалось сохранить оценку"));
  }
}

export const DIRECTION_TEXT: Record<WeeklyDirection, { tab: string; who: string; whom: string; title: string }> = {
  os_tech: { tab: "Технари", who: "ОС", whom: "технарей", title: "Оценка технарей" },
  tech_os: { tab: "ОС", who: "технари", whom: "ОС", title: "Оценка ОС" },
};

interface Sender {
  uid: string;
  name: string;
}

/**
 * «Еженедельная оценка» — открыть раунд. Тем, кто оценивает, уходит
 * уведомление со ссылкой на нужную вкладку.
 */
export async function startRatingRound(ws: string, direction: WeeklyDirection, sender: Sender) {
  const { data, error } = await supabaseRows.rpc("rating_round_start", { p_workspace: ws, p_direction: direction });
  if (error) throw new Error(ratingErrorText(error, "Не удалось открыть оценку"));
  const o = asObject(data);
  const raters = strings(o.raters);
  await load(ws);
  ringTopic(topicOf(ws));
  if (o.already === true) return { already: true, notified: 0 };
  const text = DIRECTION_TEXT[direction];
  await sendNotification(
    {
      workspaceId: ws,
      title: `Еженедельная оценка: ${text.who} оценивают ${text.whom}`,
      body: "Поставьте баллы от 1 до 10 — анонимно, никто не увидит, кто сколько поставил.",
      priority: "important",
      fromUid: sender.uid,
      fromName: sender.name,
      target: "selected",
      selectedUids: raters,
      href: `/weekly-rating${direction === "tech_os" ? "?v=os" : ""}`,
      kind: "weekly-rating",
    },
    raters
  ).catch((err) => console.warn("[rating] notify failed", err));
  return { already: false, notified: raters.filter((u) => u !== sender.uid).length };
}

/** «Завершить» — раунд закрыт, итоги видны; участникам — уведомление. */
export async function finishRatingRound(ws: string, round: RatingRound, sender: Sender) {
  const { data, error } = await supabaseRows.rpc("rating_round_finish", { p_workspace: ws, p_round: round.id });
  if (error) throw new Error(ratingErrorText(error, "Не удалось завершить оценку"));
  const notify = strings(asObject(data).notify);
  await load(ws);
  ringTopic(topicOf(ws));
  const text = DIRECTION_TEXT[round.direction];
  await sendNotification(
    {
      workspaceId: ws,
      title: `Итоги: ${text.title.toLowerCase()}`,
      body: "Оценка завершена — средние баллы уже видны.",
      priority: "normal",
      fromUid: sender.uid,
      fromName: sender.name,
      target: "selected",
      selectedUids: notify,
      href: `/weekly-rating${round.direction === "tech_os" ? "?v=os" : ""}`,
      kind: "weekly-rating",
    },
    notify
  ).catch((err) => console.warn("[rating] notify failed", err));
}

/** Отменить открытый раунд (оценки его стираются). */
export async function cancelRatingRound(ws: string, round: RatingRound) {
  const { error } = await supabaseRows.rpc("rating_round_cancel", { p_workspace: ws, p_round: round.id });
  if (error) throw new Error(ratingErrorText(error, "Не удалось отменить оценку"));
  await load(ws);
  ringTopic(topicOf(ws));
}

/** Настройка оценки (управляющий). Неуказанное не меняется. */
export async function setWeeklyRatingConfig(
  ws: string,
  patch: { rateTechs?: boolean; rateOs?: boolean; visible?: boolean; minRaters?: number; excluded?: string[] }
) {
  const { error } = await supabaseRows.rpc("rating_set_config", {
    p_workspace: ws,
    p_rate_techs: patch.rateTechs ?? null,
    p_rate_os: patch.rateOs ?? null,
    p_visible: patch.visible ?? null,
    p_min_raters: patch.minRaters ?? null,
    p_excluded: patch.excluded ?? null,
  });
  if (error) throw new Error(ratingErrorText(error, "Не удалось сохранить настройку"));
  await load(ws);
  ringTopic(topicOf(ws));
}

/** Управляющие оценками — только Owner. */
export async function setRatingManagers(ws: string, uids: string[]) {
  const { error } = await supabaseRows.rpc("rating_set_managers", { p_workspace: ws, p_uids: uids });
  if (error) throw new Error(ratingErrorText(error, "Не удалось сохранить управляющих"));
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

/** Кого оценивают в направлении (без себя, приглашённых и исключённых). */
export function weeklyTargets(
  members: WorkspaceMember[],
  direction: WeeklyDirection,
  myUid: string,
  excluded: string[] = []
): WorkspaceMember[] {
  const pick = direction === "os_tech" ? isWeeklyTech : isWeeklyOs;
  const skip = new Set(excluded);
  return members.filter((m) => m.uid && m.uid !== myUid && m.status !== "invited" && !skip.has(m.uid) && pick(m));
}

/** Сколько мне ещё оценить в открытых раундах (для бейджа меню). */
export function weeklyLeftToRate(snap: WeeklySnapshot, members: WorkspaceMember[], myUid: string | null): number {
  const state = snap.state;
  if (!state || !myUid) return 0;
  let left = 0;
  for (const dir of WEEKLY_DIRECTIONS) {
    const round = state.open[dir];
    if (!round || !state.canRate[dir]) continue;
    for (const m of weeklyTargets(members, dir, myUid, state.excluded)) if (!(mineKey(round.id, m.uid) in state.mine)) left += 1;
  }
  return left;
}

// ---------------------------------------------------------------------
// Итоги по человеку.
// ---------------------------------------------------------------------

export interface WeeklyScore {
  /** Средний балл последнего закрытого раунда направления. */
  avg: number;
  count: number;
  round: RatingRound;
  /** Изменение к раунду до него (если там тоже был итог). */
  delta: number | null;
  /** Среднее за последние 4 раунда (взвешено по числу оценок). */
  avg4: number | null;
  /** Баллы по раундам, новые первыми (null — мало оценок). */
  history: (number | null)[];
}

export function weeklyScoreOf(results: WeeklyResults | null, direction: WeeklyDirection, uid: string): WeeklyScore | null {
  if (!results) return null;
  const rounds = results.rounds.filter((r) => r.direction === direction);
  if (rounds.length === 0) return null;
  const byRound = new Map<string, WeeklyResultRow>();
  for (const row of results.rows) if (row.target === uid) byRound.set(row.round, row);
  // Показываем именно последний раунд: не набрал оценок — чипа нет, а не
  // старый балл месячной давности.
  const last = byRound.get(rounds[0].id);
  if (!last) return null;
  const prev = rounds[1] ? byRound.get(rounds[1].id) : undefined;
  let sum = 0;
  let cnt = 0;
  for (const r of rounds.slice(0, 4)) {
    const row = byRound.get(r.id);
    if (!row) continue;
    sum += row.avg * row.count;
    cnt += row.count;
  }
  return {
    avg: last.avg,
    count: last.count,
    round: rounds[0],
    delta: prev ? Math.round((last.avg - prev.avg) * 10) / 10 : null,
    avg4: cnt ? Math.round((sum / cnt) * 10) / 10 : null,
    history: rounds.map((r) => byRound.get(r.id)?.avg ?? null),
  };
}

/** Итоги для общих экранов (ABS, «Технари»): скрытые — не показываем никому. */
export function publicWeeklyResults(snap: WeeklySnapshot): WeeklyResults | null {
  const results = snap.results;
  if (!results || results.hidden) return null;
  return results;
}

// ---------------------------------------------------------------------
// Подписи.
// ---------------------------------------------------------------------

function dayMonth(ms: number) {
  return zonedDateFormat("ru-RU", { day: "numeric", month: "short" }).format(new Date(ms)).replace(/\./g, "");
}

function ymd(ms: number) {
  return zonedDateFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

/** «27 сент» или «21–27 сент» / «29 сент – 3 окт» — от открытия до завершения. */
export function roundLabel(round: RatingRound): string {
  const end = round.closedAt ?? Date.now();
  if (ymd(round.openedAt) === ymd(end)) return dayMonth(end);
  const a = dayMonth(round.openedAt);
  const b = dayMonth(end);
  const [da, ma] = a.split(" ");
  const [db, mb] = b.split(" ");
  return ma === mb ? `${da}–${db} ${mb}` : `${a} – ${b}`;
}
