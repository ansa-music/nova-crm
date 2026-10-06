import { useEffect, useSyncExternalStore } from "react";
import { supabaseRows } from "@/lib/supabaseRows";
import { isSbMissingError } from "@/services/sb/sbCollections";
import { listenTopic, ringTopic } from "@/services/sb/topicDoorbell";

/**
 * Telegram «один аккаунт на workspace» (27.09.2026, SQL 20261035 + функция
 * Supabase `tg`). Главный вход лежит на сервере: подключает его Owner один
 * раз, а браузеры получают от него свои устройства без QR (tgClient). Этот
 * модуль — без mtcute: статус аккаунта (одна маленькая выборка), вызовы
 * функции и разрешения технарям.
 */

export interface TgAccount {
  id: number | null;
  name: string | null;
  username: string | null;
}

export interface TgServerState {
  key: string | null;
  loading: boolean;
  /** SQL 20261035 ещё не накатан — старый режим (вход в браузере). */
  sqlMissing: boolean;
  connected: boolean;
  account: TgAccount | null;
  passwordSaved: boolean;
  pending: boolean;
  error: string | null;
}

const EMPTY: TgServerState = {
  key: null,
  loading: false,
  sqlMissing: false,
  connected: false,
  account: null,
  passwordSaved: false,
  pending: false,
  error: null,
};

const RECHECK_MS = 5 * 60_000;
const topicOf = (ws: string) => `nova:${ws}:tgserver`;

let state: TgServerState = EMPTY;
const listeners = new Set<() => void>();
let current: { ws: string; users: number; stopRing: () => void; timer: ReturnType<typeof setInterval> } | null = null;
let generation = 0;

function emit(next: Partial<TgServerState>) {
  state = { ...state, ...next };
  listeners.forEach((fn) => fn());
}

async function load(ws: string, gen: number) {
  const { data, error } = await supabaseRows.rpc("tg_account_status", { p_workspace: ws });
  if (gen !== generation) return;
  if (error) {
    if (isSbMissingError(error)) {
      emit({ loading: false, sqlMissing: true, connected: false, error: null });
      return;
    }
    // Нет доступа к разделу (42501) — это «не подключено для меня», а не сбой.
    emit({ loading: false, error: error.code === "42501" ? null : error.message || "Не удалось прочитать статус Telegram" });
    return;
  }
  const o = (data ?? {}) as Record<string, unknown>;
  emit({
    loading: false,
    sqlMissing: false,
    connected: o.connected === true,
    account: o.connected
      ? { id: typeof o.accountId === "number" ? o.accountId : Number(o.accountId) || null, name: (o.name as string) ?? null, username: (o.username as string) ?? null }
      : null,
    passwordSaved: o.passwordSaved === true,
    pending: o.pending === true,
    error: null,
  });
}

export function refreshTgServer() {
  if (current) void load(current.ws, generation);
}

function onVisible() {
  if (document.visibilityState === "visible") refreshTgServer();
}

function start(ws: string) {
  if (current?.ws === ws) {
    current.users += 1;
    return;
  }
  stop(true);
  generation += 1;
  const gen = generation;
  state = { ...EMPTY, key: ws, loading: true };
  listeners.forEach((fn) => fn());
  current = {
    ws,
    users: 1,
    stopRing: listenTopic(topicOf(ws), () => void load(ws, gen)),
    timer: setInterval(() => document.visibilityState === "visible" && void load(ws, gen), RECHECK_MS),
  };
  document.addEventListener("visibilitychange", onVisible);
  void load(ws, gen);
}

function stop(force = false) {
  if (!current) return;
  current.users -= 1;
  if (current.users > 0 && !force) return;
  current.stopRing();
  clearInterval(current.timer);
  document.removeEventListener("visibilitychange", onVisible);
  current = null;
  generation += 1;
  state = EMPTY;
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Подключён ли аккаунт workspace. `enabled` — человеку открыт раздел. */
export function useTgServer(ws: string | null, enabled: boolean): TgServerState {
  useEffect(() => {
    if (!enabled || !ws) return;
    start(ws);
    return () => stop();
  }, [enabled, ws]);
  const snap = useSyncExternalStore(subscribe, () => state);
  return enabled && ws && snap.key === ws ? snap : EMPTY;
}

const noSubscribe = () => () => {};

/**
 * Только «аккаунт подключён». Без `enabled` нет ни запросов, ни подписки на
 * стор: хук стоит в каркасе у ВСЕХ компаний (обслуживание «NOVA Studio»), и
 * общий `useTgServer` перерисовывал бы каркас на каждое обновление статуса.
 */
export function useTgServerConnected(ws: string | null, enabled: boolean): boolean {
  const on = Boolean(enabled && ws);
  useEffect(() => {
    if (!on || !ws) return;
    start(ws);
    return () => stop();
  }, [on, ws]);
  return useSyncExternalStore(on ? subscribe : noSubscribe, () => on && state.key === ws && state.connected);
}

export function ringTgServer(ws: string) {
  ringTopic(topicOf(ws));
}

// ---------------------------------------------------------------------
// Вызов функции `tg`.
// ---------------------------------------------------------------------

export class TgEdgeError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

let functionMissingAt = 0;

/** Функция не выложена (404) — старый режим ещё 10 минут. */
export function tgFunctionMissing(): boolean {
  return Date.now() - functionMissingAt < 10 * 60_000;
}

export async function callTgEdge<T = Record<string, unknown>>(ws: string, action: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabaseRows.functions.invoke("tg", { body: { workspaceId: ws, action, ...body } });
  if (!error) {
    const d = (data ?? {}) as Record<string, unknown>;
    if (d.ok === false) throw new TgEdgeError(String(d.error ?? "error"), String(d.message ?? "Ошибка Telegram"), 200);
    return d as T;
  }
  const ctx = (error as { context?: Response }).context;
  let status = 0;
  let payload: Record<string, unknown> | null = null;
  if (ctx && typeof ctx.status === "number") {
    status = ctx.status;
    try {
      payload = (await ctx.clone().json()) as Record<string, unknown>;
    } catch {
      payload = null;
    }
  }
  if (status === 404 && !payload?.error) {
    functionMissingAt = Date.now();
    throw new TgEdgeError("no_function", "Сервер Telegram ещё не выложен — работает прежний вход.", 404);
  }
  if (payload?.error) throw new TgEdgeError(String(payload.error), String(payload.message ?? "Ошибка Telegram"), status);
  throw new TgEdgeError("network", "Нет связи с сервером Telegram — проверьте интернет.", status);
}

/** Для tgClient: как браузеру получить устройство от главного входа. */
export interface TgServerLink {
  accountId: number | null;
  accept(tokenB64: string, marker: string): Promise<void>;
  /** Ответ пароля от сервера; null — пароль на сервере не сохранён. */
  srp(request: unknown): Promise<unknown | null>;
}

export function tgServerLink(ws: string, accountId: number | null): TgServerLink {
  return {
    accountId,
    async accept(token, marker) {
      await callTgEdge(ws, "device_accept", { token, marker });
    },
    async srp(request) {
      try {
        const res = await callTgEdge<{ answer: unknown }>(ws, "device_srp", { request });
        return res.answer ?? null;
      } catch (error) {
        if (error instanceof TgEdgeError && error.code === "password_not_saved") return null;
        throw error;
      }
    },
  };
}

// ---------------------------------------------------------------------
// Разрешения технарям.
// ---------------------------------------------------------------------

export interface TgPeerRef {
  type: "user" | "chat" | "channel";
  id: string;
  accessHash?: string;
}

export interface TgTechGrant {
  chatId: number;
  techUid: string;
  title: string;
  pageId: string | null;
  rowId: string | null;
  grantedBy: string;
  grantedAt: number;
}

const grantsTopic = (ws: string) => `nova:${ws}:tggrants`;

function parseGrants(data: unknown): TgTechGrant[] {
  return (Array.isArray(data) ? data : []).map((g: Record<string, unknown>) => ({
    chatId: Number(g.chatId),
    techUid: String(g.techUid ?? ""),
    title: String(g.title ?? ""),
    pageId: (g.pageId as string) ?? null,
    rowId: (g.rowId as string) ?? null,
    grantedBy: String(g.grantedBy ?? ""),
    grantedAt: Number(g.grantedAt ?? 0),
  }));
}

export async function listTgGrants(ws: string, filter: { chatId?: number; pageId?: string; rowId?: string } = {}): Promise<TgTechGrant[]> {
  const { data, error } = await supabaseRows.rpc("tg_grants_list", {
    p_workspace: ws,
    p_chat_id: filter.chatId ?? null,
    p_page_id: filter.pageId ?? null,
    p_row_id: filter.rowId ?? null,
  });
  if (error) throw new Error(isSbMissingError(error) ? "Разрешения технарям появятся после обновления базы." : error.message);
  return parseGrants(data);
}

export async function grantTgTech(
  ws: string,
  input: { chatId: number; techUid: string; peer: TgPeerRef; title: string; pageId?: string | null; rowId?: string | null }
) {
  const { error } = await supabaseRows.rpc("tg_grant_tech", {
    p_workspace: ws,
    p_chat_id: input.chatId,
    p_tech_uid: input.techUid,
    p_peer: input.peer,
    p_title: input.title,
    p_page_id: input.pageId ?? null,
    p_row_id: input.rowId ?? null,
  });
  if (error) throw new Error(error.code === "42501" ? "Разрешать технарям может тот, кому открыт раздел Telegram." : error.message);
  ringTopic(grantsTopic(ws));
}

export async function revokeTgTech(ws: string, chatId: number, techUid: string) {
  const { error } = await supabaseRows.rpc("tg_revoke_tech", { p_workspace: ws, p_chat_id: chatId, p_tech_uid: techUid });
  if (error) throw new Error(error.message);
  ringTopic(grantsTopic(ws));
}

export function listenTgGrants(ws: string, fn: () => void) {
  return listenTopic(grantsTopic(ws), fn);
}

// ---------------------------------------------------------------------
// Есть ли у меня разрешения технаря (для меню) — одна выборка на загрузку.
// ---------------------------------------------------------------------

let techState: { key: string | null; value: boolean } = { key: null, value: false };
const techListeners = new Set<() => void>();
let techLoading: string | null = null;

async function loadTech(key: string) {
  techLoading = key;
  const { data, error } = await supabaseRows.rpc("tg_tech_workspaces");
  techLoading = null;
  const ws = key.split("|")[0];
  const value = !error && Array.isArray(data) && data.some((w) => (typeof w === "string" ? w : (w as Record<string, string>)?.tg_tech_workspaces) === ws);
  techState = { key, value };
  techListeners.forEach((fn) => fn());
}

/** Мне открыты чаты как технарю (разрешения ОС). */
export function useTgTechAccess(ws: string | null, uid: string | null, enabled: boolean): boolean {
  const key = ws && uid ? `${ws}|${uid}` : null;
  useEffect(() => {
    if (!enabled || !key) return;
    if (techState.key !== key && techLoading !== key) void loadTech(key);
    const stopRing = listenTopic(grantsTopic(key.split("|")[0]), () => void loadTech(key));
    const onVis = () => document.visibilityState === "visible" && void loadTech(key);
    const timer = setInterval(onVis, RECHECK_MS);
    return () => {
      stopRing();
      clearInterval(timer);
    };
  }, [enabled, key]);
  const snap = useSyncExternalStore(
    (fn) => {
      techListeners.add(fn);
      return () => techListeners.delete(fn);
    },
    () => techState
  );
  return Boolean(enabled && key && snap.key === key && snap.value);
}
