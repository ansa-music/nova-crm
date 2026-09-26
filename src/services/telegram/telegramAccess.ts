import { useEffect, useSyncExternalStore } from "react";
import { supabaseRows } from "@/lib/supabaseRows";
import { isSbMissingError } from "@/services/sb/sbCollections";

/**
 * Раздел «Telegram» (26.09.2026): кто допущен и ключи приложения Telegram.
 * Хранится в Supabase (`tg_access`, `tg_config`, SQL 20261011), пишет только
 * Owner через RPC. Сам Telegram через Supabase не идёт — см. tgClient.ts.
 *
 * Своё «допущен ли я» читает меню у каждого ОС и у Owner: одна маленькая
 * выборка на загрузку, повтор раз в 5 минут на видимой вкладке и при
 * возврате на неё (так снятие доступа доходит до открытой вкладки).
 */

export interface TelegramConfig {
  apiId: number;
  apiHash: string;
}

export interface TelegramAccessState {
  key: string | null;
  /** Первая выборка ещё не ответила. */
  loading: boolean;
  /** Мне раздел открыт (строка tg_access есть и роль ОС на месте). */
  granted: boolean;
  /** Ключи приложения (null — Owner их ещё не ввёл или мне не видны). */
  config: TelegramConfig | null;
  /** SQL 20261011 ещё не накатан. */
  missingSql: boolean;
  error: string | null;
}

const EMPTY: TelegramAccessState = { key: null, loading: false, granted: false, config: null, missingSql: false, error: null };
const RECHECK_MS = 5 * 60_000;

let state: TelegramAccessState = EMPTY;
const listeners = new Set<() => void>();
let current: { key: string; workspaceId: string; uid: string; users: number; timer: ReturnType<typeof setInterval> | null } | null = null;
let generation = 0;

function emit(next: Partial<TelegramAccessState>) {
  state = { ...state, ...next };
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function errorText(error: { message?: string } | null | undefined): string {
  return error?.message || "Не удалось прочитать доступ к Telegram";
}

async function load(workspaceId: string, uid: string, gen: number) {
  const [access, config] = await Promise.all([
    supabaseRows.from("tg_access").select("uid").eq("workspace_id", workspaceId).eq("uid", uid).limit(1),
    supabaseRows.from("tg_config").select("api_id,api_hash").eq("workspace_id", workspaceId).limit(1),
  ]);
  if (gen !== generation) return;
  const failed = access.error ?? config.error;
  if (failed) {
    if (isSbMissingError(failed)) {
      emit({ loading: false, granted: false, config: null, missingSql: true, error: null });
      return;
    }
    // Сбой сети — прежнее знание остаётся, чтобы кочка не выкидывала из раздела.
    emit({ loading: false, error: errorText(failed) });
    return;
  }
  const row = Array.isArray(config.data) ? (config.data[0] as { api_id: number; api_hash: string } | undefined) : undefined;
  emit({
    loading: false,
    granted: Array.isArray(access.data) && access.data.length > 0,
    config: row ? { apiId: Number(row.api_id), apiHash: row.api_hash } : null,
    missingSql: false,
    error: null,
  });
}

/** Перечитать сейчас (после сохранения Owner, по кнопке «Повторить»). */
export function refreshTelegramAccess() {
  if (!current) return;
  void load(current.workspaceId, current.uid, generation);
}

function onVisible() {
  if (document.visibilityState === "visible") refreshTelegramAccess();
}

function start(workspaceId: string, uid: string) {
  const key = `${workspaceId}:${uid}`;
  if (current?.key === key) {
    current.users += 1;
    return;
  }
  stop(true);
  generation += 1;
  current = { key, workspaceId, uid, users: 1, timer: null };
  state = { ...EMPTY, key, loading: true };
  listeners.forEach((fn) => fn());
  current.timer = setInterval(() => {
    if (document.visibilityState === "visible") refreshTelegramAccess();
  }, RECHECK_MS);
  document.addEventListener("visibilitychange", onVisible);
  void load(workspaceId, uid, generation);
}

function stop(force = false) {
  if (!current) return;
  current.users -= 1;
  if (current.users > 0 && !force) return;
  if (current.timer) clearInterval(current.timer);
  document.removeEventListener("visibilitychange", onVisible);
  current = null;
  generation += 1;
  state = EMPTY;
  listeners.forEach((fn) => fn());
}

/**
 * Мой доступ к разделу. `enabled` — только у тех, кого вообще можно допустить
 * (роль ОС) и у Owner: остальным запрос незачем.
 */
export function useTelegramAccess(workspaceId: string | null, uid: string | null, enabled: boolean): TelegramAccessState {
  useEffect(() => {
    if (!enabled || !workspaceId || !uid) return;
    start(workspaceId, uid);
    return () => stop();
  }, [enabled, workspaceId, uid]);
  const snapshot = useSyncExternalStore(subscribe, () => state);
  const key = workspaceId && uid ? `${workspaceId}:${uid}` : null;
  return enabled && snapshot.key === key ? snapshot : EMPTY;
}

// ---------------------------------------------------------------------
// Owner.
// ---------------------------------------------------------------------

function rpcError(error: { message?: string; code?: string }): Error {
  if (isSbMissingError(error)) return new Error("В базе ещё нет раздела Telegram — SQL накатится со следующим деплоем");
  return Object.assign(new Error(error.message || "Supabase"), { code: error.code });
}

/** Весь список допущенных (читает только Owner — политика). */
export async function fetchTelegramAccessList(workspaceId: string): Promise<string[]> {
  const { data, error } = await supabaseRows.from("tg_access").select("uid").eq("workspace_id", workspaceId);
  if (error) throw rpcError(error);
  return ((data ?? []) as { uid: string }[]).map((r) => r.uid);
}

/** Список допущенных целиком; база оставит только участников с ролью ОС. */
export async function setTelegramAccess(workspaceId: string, uids: string[]): Promise<string[]> {
  const { data, error } = await supabaseRows.rpc("tg_set_access", { p_workspace: workspaceId, p_uids: uids });
  if (error) throw rpcError(error);
  refreshTelegramAccess();
  return Array.isArray(data) ? data.map((r: unknown) => (typeof r === "string" ? r : String((r as { tg_set_access?: string }).tg_set_access ?? ""))).filter(Boolean) : [];
}

/** Ключи приложения; `null` — стереть. */
export async function setTelegramConfig(workspaceId: string, config: TelegramConfig | null): Promise<void> {
  const { error } = await supabaseRows.rpc("tg_set_config", {
    p_workspace: workspaceId,
    p_api_id: config ? config.apiId : null,
    p_api_hash: config ? config.apiHash : null,
  });
  if (error) throw rpcError(error);
  refreshTelegramAccess();
}

// ---------------------------------------------------------------------
// Метка «в этом браузере есть вход в Telegram» — для автовыхода.
// ---------------------------------------------------------------------

/**
 * Пишется при входе: ключи нужны, чтобы выйти из Telegram и ПОСЛЕ снятия
 * доступа (прочитать tg_config тогда уже нельзя). Ключи не секрет — без кода
 * с телефона хозяина с ними не войти.
 */
export function telegramSessionMarkKey(workspaceId: string, uid: string) {
  return `nova:tg-session:${workspaceId}:${uid}`;
}

export function readTelegramSessionMark(workspaceId: string, uid: string): TelegramConfig | null {
  try {
    const raw = window.localStorage.getItem(telegramSessionMarkKey(workspaceId, uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TelegramConfig>;
    return typeof parsed.apiId === "number" && typeof parsed.apiHash === "string" ? { apiId: parsed.apiId, apiHash: parsed.apiHash } : null;
  } catch {
    return null;
  }
}

export function writeTelegramSessionMark(workspaceId: string, uid: string, config: TelegramConfig | null) {
  try {
    const key = telegramSessionMarkKey(workspaceId, uid);
    if (config) window.localStorage.setItem(key, JSON.stringify(config));
    else window.localStorage.removeItem(key);
  } catch {
    /* без localStorage автовыход просто не сработает — выход кнопкой остаётся */
  }
}

/**
 * Автовыход: доступ сняли (или роль ОС), а в этом браузере остался вход —
 * выходим из Telegram и стираем ключ сессии. Библиотеку Telegram грузим
 * только здесь и только когда выходить правда есть из чего.
 */
export function useTelegramRevokeGuard(
  workspaceId: string | null,
  uid: string | null,
  access: TelegramAccessState,
  opts: { resolved: boolean; canHaveAccess: boolean }
) {
  // Решаем только по известным правам: пока роль не пришла, «не ОС» — не
  // знание, а пустота. Сбой сети и «SQL не накатан» — тоже не отказ.
  const revoked = Boolean(
    workspaceId &&
      uid &&
      opts.resolved &&
      (!opts.canHaveAccess || (!access.loading && access.key && !access.granted && !access.missingSql && !access.error))
  );
  useEffect(() => {
    if (!revoked || !workspaceId || !uid) return;
    const mark = readTelegramSessionMark(workspaceId, uid);
    if (!mark) return;
    void import("@/services/telegram/tgClient")
      .then((m) => m.logOutTelegram({ workspaceId, uid, config: mark, reason: "revoked" }))
      .catch((error) => console.warn("[telegram] автовыход не удался", error));
  }, [revoked, workspaceId, uid]);
}
