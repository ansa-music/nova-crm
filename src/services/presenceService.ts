import { supabaseRows } from "@/lib/supabaseRows";
import { updatePresenceHeartbeat } from "@/services/authService";
import {
  isSbMissingError,
  markSbTableMissing,
  markSbTablePresent,
  sbBackendOf,
  sbTableRecheckDue,
  sbTableState,
  sbTargetOf,
} from "@/services/sb/sbCollections";
import { readSnapshot, writeSnapshot } from "@/services/sb/snapshotCache";
import type { Workspace } from "@/types";

/**
 * Присутствие «в сети» — в Supabase (`member_presence`,
 * supabase/migrations/20260928b_presence.sql), а не в member-документах
 * Firestore.
 *
 * Зачем: пульс писал `lastActiveAt` в member-документ раз в 15 минут, и этим
 * «пачкал» весь ростер — каждое чтение списка участников через resume-токен
 * платило почти за всех. В Postgres нет суточной квоты, поэтому пульс идёт
 * раз в 5 минут, а документы участников в Firestore стоят на месте.
 *
 * Включение без действий Owner: достаточно, чтобы строки жили в Supabase
 * (только тогда ведётся копия прав rows_*, на которой держатся политики) и
 * чтобы в базе была таблица. SQL не накатан — ветка молча работает по-старому
 * (пульс в Firestore), пока Nurba не вставит его кнопкой «Скопировать SQL».
 * Выключатель-откат — `workspace.sbCollections.presence = "firestore"`.
 * Решение и память «таблицы нет» — общие для всех переносимых коллекций
 * (services/sb/sbCollections.ts, ключ `presence`): их же показывает панель
 * Owner в «Настройки → Строки таблиц».
 */

export type PresenceBackend = "firestore" | "supabase";

const PRESENCE_TABLE = "member_presence";

/** Выборка присутствия — не чаще, чем раз в столько (открытие экрана, возврат на вкладку). */
export const PRESENCE_FETCH_MIN_GAP_MS = 2 * 60 * 1000;

/**
 * Коды «в базе этого ещё нет» (42P01, 42703, 42883, PGRST205/202/204 — как
 * stampMissing у строк). По ним коллекция засыпает на 10 минут на все
 * вкладки и работает по-старому.
 */
export function isMissingPresenceError(error: unknown): boolean {
  return isSbMissingError(error);
}

/** SQL не накатан (по недавнему ответу базы) — Supabase-ветку пока не трогать. */
export function presenceTableMissing(): boolean {
  return sbTableState("presence") === "missing" && !sbTableRecheckDue("presence");
}

/**
 * Где живёт присутствие этого workspace сейчас: флаг `sbCollections.presence`
 * и память «таблицы нет». Строки в Firestore — всегда Firestore, что бы ни
 * стояло во флаге: копии прав rows_* тогда нет, и политики отказали бы всем.
 */
export function presenceBackendOf(
  workspace: Pick<Workspace, "rowsBackend" | "sbCollections"> | null | undefined
): PresenceBackend {
  const backend = sbBackendOf(workspace, "presence");
  // Память «таблицы нет» в sbCollections сама не истекает: экраны
  // переспрашивают её пробой (useSbBackend) раз в 10 минут. У пульса экрана
  // нет, поэтому «пора переспросить» = попробовать удар в Supabase: не лёг —
  // beatSupabase снова пометит «нет» и допишет Firestore, лёг — пометит «есть».
  // Без этого после вставки SQL устройство с памятью «нет» писало бы в
  // Firestore вечно (память лежит в localStorage).
  if (backend === "firestore" && sbTargetOf(workspace, "presence") === "supabase" && sbTableRecheckDue("presence")) {
    return "supabase";
  }
  return backend;
}

// ---------------------------------------------------------------------
// Пульс.
// ---------------------------------------------------------------------

export interface SupabaseBeatResult {
  /** Workspace, где строка легла; время в них — серверное. */
  landed: Map<string, number>;
  /** Не легло (нет в копии прав, нет таблицы, отказ, нет связи) — их пишет старый путь. */
  rest: string[];
}

/**
 * Удар в Supabase одним вызовом на все workspace. Никогда не бросает: всё,
 * что не легло, возвращается в `rest`, и вызывающий пишет это по-старому.
 */
export async function beatSupabase(workspaceIds: string[]): Promise<SupabaseBeatResult> {
  const landed = new Map<string, number>();
  if (!workspaceIds.length) return { landed, rest: [] };
  try {
    const { data, error } = await supabaseRows.rpc("presence_beat", { p_workspaces: workspaceIds });
    if (error) {
      if (isMissingPresenceError(error)) markSbTableMissing("presence");
      else console.warn("[presence] удар в Supabase не прошёл — пишу по-старому", error);
      return { landed, rest: [...workspaceIds] };
    }
    markSbTablePresent("presence");
    for (const row of Array.isArray(data) ? (data as Array<{ workspace_id?: unknown; last_active_at?: unknown }>) : []) {
      const ws = typeof row.workspace_id === "string" ? row.workspace_id : null;
      const at = Number(row.last_active_at);
      if (ws && Number.isFinite(at)) landed.set(ws, at);
    }
  } catch (error) {
    console.warn("[presence] удар в Supabase не прошёл — пишу по-старому", error);
  }
  return { landed, rest: workspaceIds.filter((ws) => !landed.has(ws)) };
}

/**
 * Старый пульс (lastActiveAt в member-документ Firestore) — запасной путь.
 * authService не правим: им же пишут вкладки на старом коде.
 */
export function beatFirestore(uid: string, workspaceIds: string[], at: number): Promise<boolean> {
  if (!workspaceIds.length) return Promise.resolve(false);
  return updatePresenceHeartbeat(uid, workspaceIds, at);
}

// ---------------------------------------------------------------------
// Чтение: общий на вкладку кэш «uid → последний удар» по workspace.
// ---------------------------------------------------------------------

interface PresenceEntry {
  map: ReadonlyMap<string, number>;
  fetchedAt: number;
  /**
   * Карта подтверждена сервером в этой вкладке (была удачная выборка).
   * `fetchedAt` для этого не годится: он ставится ДО выборки (порог) и
   * сбрасывается при отказе, а до первого ответа в карте только снимок или
   * пустота.
   */
  confirmed: boolean;
  inflight: Promise<void> | null;
}

const EMPTY: ReadonlyMap<string, number> = new Map();
const entries = new Map<string, PresenceEntry>();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version += 1;
  listeners.forEach((fn) => fn());
}

export function subscribePresence(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Для useSyncExternalStore: меняется при каждой новой выборке или своём ударе. */
export function presenceVersion(): number {
  return version;
}

// Снимок в localStorage — чтобы «в сети» рисовалось сразу, до ответа сети.
// Только для отрисовки (правило fromCache): решений по нему не принимаем.
// Общий кэш снимков Supabase (services/sb/snapshotCache.ts): ключ с uid
// вошедшего, стирается при выходе теми же событиями, что кэш Firestore.
const SNAPSHOT_COLLECTION = "presence";

function readPresenceSnapshot(workspaceId: string): ReadonlyMap<string, number> {
  const snap = readSnapshot<Record<string, unknown>>(workspaceId, SNAPSHOT_COLLECTION);
  if (!snap || !snap.value || typeof snap.value !== "object") return EMPTY;
  const map = new Map<string, number>();
  for (const [uid, at] of Object.entries(snap.value)) {
    const n = Number(at);
    if (Number.isFinite(n) && n > 0) map.set(uid, n);
  }
  return map;
}

function writePresenceSnapshot(workspaceId: string, map: ReadonlyMap<string, number>) {
  writeSnapshot(workspaceId, SNAPSHOT_COLLECTION, Object.fromEntries(map));
}

function entryFor(viewerUid: string, workspaceId: string): PresenceEntry {
  const key = `${viewerUid}:${workspaceId}`;
  let entry = entries.get(key);
  if (!entry) {
    entry = { map: readPresenceSnapshot(workspaceId), fetchedAt: 0, confirmed: false, inflight: null };
    entries.set(key, entry);
  }
  return entry;
}

/** Последние удары участников по данным Supabase (снимок до первой выборки). */
export function getPresenceMap(viewerUid: string | null | undefined, workspaceId: string | null | undefined) {
  if (!viewerUid || !workspaceId) return EMPTY;
  return entryFor(viewerUid, workspaceId).map;
}

/**
 * Карта из Supabase уже подтверждена сервером в этой вкладке. До этого в ней
 * снимок из localStorage или пустота — рисовать «в сети» по ним можно, а
 * решать что-то (например, «давно не заходили» — по ней Owner убирает людей)
 * нельзя: правило fromCache.
 */
export function isPresenceConfirmed(viewerUid: string | null | undefined, workspaceId: string | null | undefined) {
  if (!viewerUid || !workspaceId) return false;
  return entryFor(viewerUid, workspaceId).confirmed;
}

/**
 * Одна выборка присутствия workspace (~30 строк по десятку байт). Не чаще раза
 * в 2 минуты на вкладку, сколько бы экранов её ни просили; `force` — мимо
 * этого порога (не мимо выборки, что уже идёт).
 */
export function refreshPresence(
  viewerUid: string,
  workspaceId: string,
  options: { force?: boolean } = {}
): Promise<void> {
  const entry = entryFor(viewerUid, workspaceId);
  if (entry.inflight) return entry.inflight;
  if (!options.force && Date.now() - entry.fetchedAt < PRESENCE_FETCH_MIN_GAP_MS) return Promise.resolve();
  entry.fetchedAt = Date.now();
  entry.inflight = (async () => {
    try {
      const { data, error } = await supabaseRows
        .from(PRESENCE_TABLE)
        .select("uid,last_active_at")
        .eq("workspace_id", workspaceId);
      if (error) {
        if (isMissingPresenceError(error)) markSbTableMissing("presence");
        // Отказ или нет связи — остаётся прежнее (снимок / прошлая выборка):
        // пустой ответ отказа не должен гасить «в сети» у всех.
        else entry.fetchedAt = 0;
        return;
      }
      markSbTablePresent("presence");
      const map = new Map<string, number>();
      for (const row of Array.isArray(data) ? (data as Array<{ uid?: unknown; last_active_at?: unknown }>) : []) {
        const at = Number(row.last_active_at);
        if (typeof row.uid === "string" && Number.isFinite(at) && at > 0) map.set(row.uid, at);
      }
      // Свой удар мог лечь, пока выборка была в пути, — не откатываем его.
      entry.map.forEach((at, uid) => {
        if ((map.get(uid) ?? 0) < at && uid === viewerUid) map.set(uid, at);
      });
      entry.map = map;
      entry.confirmed = true;
      writePresenceSnapshot(workspaceId, map);
      emit();
    } catch {
      entry.fetchedAt = 0;
    } finally {
      entry.inflight = null;
    }
  })();
  return entry.inflight;
}

/** Свой удар лёг в Supabase — сразу показать себя «в сети» без новой выборки. */
export function notePresenceLanded(viewerUid: string, landed: ReadonlyMap<string, number>) {
  let changed = false;
  landed.forEach((at, workspaceId) => {
    const entry = entries.get(`${viewerUid}:${workspaceId}`);
    if (!entry || (entry.map.get(viewerUid) ?? 0) >= at) return;
    const next = new Map(entry.map);
    next.set(viewerUid, at);
    entry.map = next;
    writePresenceSnapshot(workspaceId, next);
    changed = true;
  });
  if (changed) emit();
}
