import { useEffect, useSyncExternalStore } from "react";
import { supabaseRows } from "@/lib/supabaseRows";
import { isSbMissingError } from "@/services/sb/sbCollections";
import { listenTopic, ringTopic } from "@/services/sb/topicDoorbell";

/**
 * Привязка чатов Telegram к нику ОС (SQL 20261013, `tg_chat_links`). Рабочий
 * аккаунт один на всех, и привязка отвечает на вопрос «чей это клиент»:
 * метка ника у чата и фильтры «Мои / Без ОС / по нику».
 *
 * Привязок немного (сотни), поэтому список читается целиком: при открытии
 * раздела, по звонку `nova:{ws}:tglinks` после чужой правки, раз в минуту на
 * видимой вкладке и при возврате на неё. Своя правка видна сразу.
 */

export interface TgChatLink {
  chatId: number;
  osValue: string;
  title: string;
  boundBy: string;
  boundAt: number;
}

/** Чат ↔ клиент: строка стола (SQL 20261014, `tg_chat_clients`). */
export interface TgChatClient {
  chatId: number;
  pageId: string;
  /** '' — «Основная» таблица стола. */
  tabId: string;
  rowId: string;
  /** Подпись на момент привязки: «Имя · телефон». */
  label: string;
  boundBy: string;
  boundAt: number;
}

export interface TgChatLinksState {
  key: string | null;
  loaded: boolean;
  links: Record<number, TgChatLink>;
  clients: Record<number, TgChatClient>;
  /** SQL 20261014 ещё не накатан — привязку клиента не показываем. */
  clientsMissingSql: boolean;
  /** SQL 20261013 ещё не накатан — привязку не показываем. */
  missingSql: boolean;
  error: string | null;
}

const EMPTY: TgChatLinksState = { key: null, loaded: false, links: {}, clients: {}, clientsMissingSql: false, missingSql: false, error: null };
const POLL_MS = 60_000;
const PAGE = 1000;

let state: TgChatLinksState = EMPTY;
const listeners = new Set<() => void>();
let current: { workspaceId: string; users: number; stop: () => void } | null = null;
let generation = 0;
/** Свои правки в пути: выборка, пришедшая раньше ответа базы, их не откатывает. */
const pendingWrites = new Map<number, TgChatLink | null>();
const pendingClients = new Map<number, TgChatClient | null>();

function emit(next: Partial<TgChatLinksState>) {
  state = { ...state, ...next };
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function topicOf(workspaceId: string) {
  return `nova:${workspaceId}:tglinks`;
}

function toLink(row: { chat_id: number | string; os_value: string; title?: string | null; bound_by?: string | null; bound_at?: number | string | null }): TgChatLink {
  return {
    chatId: Number(row.chat_id),
    osValue: row.os_value,
    title: row.title ?? "",
    boundBy: row.bound_by ?? "",
    boundAt: Number(row.bound_at ?? 0),
  };
}

type ClientRow = { chat_id: number | string; page_id: string; tab_id?: string | null; row_id: string; label?: string | null; bound_by?: string | null; bound_at?: number | string | null };

function toClient(row: ClientRow): TgChatClient {
  return {
    chatId: Number(row.chat_id),
    pageId: row.page_id,
    tabId: row.tab_id ?? "",
    rowId: row.row_id,
    label: row.label ?? "",
    boundBy: row.bound_by ?? "",
    boundAt: Number(row.bound_at ?? 0),
  };
}

function withPendingClients(clients: Record<number, TgChatClient>): Record<number, TgChatClient> {
  if (pendingClients.size === 0) return clients;
  const next = { ...clients };
  for (const [chatId, client] of pendingClients) {
    if (client) next[chatId] = client;
    else delete next[chatId];
  }
  return next;
}

async function loadClients(workspaceId: string): Promise<{ clients: Record<number, TgChatClient>; missing: boolean } | { error: string }> {
  const clients: Record<number, TgChatClient> = {};
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseRows
      .from("tg_chat_clients")
      .select("chat_id,page_id,tab_id,row_id,label,bound_by,bound_at")
      .eq("workspace_id", workspaceId)
      .order("chat_id")
      .range(from, from + PAGE - 1);
    if (error) {
      if (isSbMissingError(error)) return { clients: {}, missing: true };
      return { error: error.message || "Не удалось прочитать привязки клиентов" };
    }
    const rows = (data ?? []) as ClientRow[];
    for (const row of rows) clients[Number(row.chat_id)] = toClient(row);
    if (rows.length < PAGE) break;
  }
  return { clients, missing: false };
}

function withPending(links: Record<number, TgChatLink>): Record<number, TgChatLink> {
  if (pendingWrites.size === 0) return links;
  const next = { ...links };
  for (const [chatId, link] of pendingWrites) {
    if (link) next[chatId] = link;
    else delete next[chatId];
  }
  return next;
}

async function load(workspaceId: string, gen: number) {
  const clientsPromise = loadClients(workspaceId);
  const links: Record<number, TgChatLink> = {};
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseRows
      .from("tg_chat_links")
      .select("chat_id,os_value,title,bound_by,bound_at")
      .eq("workspace_id", workspaceId)
      .order("chat_id")
      .range(from, from + PAGE - 1);
    if (gen !== generation) return;
    if (error) {
      if (isSbMissingError(error)) emit({ loaded: true, missingSql: true, error: null, links: {} });
      else emit({ loaded: true, error: error.message || "Не удалось прочитать привязки чатов" });
      return;
    }
    const rows = (data ?? []) as Parameters<typeof toLink>[0][];
    for (const row of rows) links[Number(row.chat_id)] = toLink(row);
    if (rows.length < PAGE) break;
  }
  const clientsResult = await clientsPromise;
  if (gen !== generation) return;
  if ("error" in clientsResult) {
    emit({ loaded: true, missingSql: false, error: clientsResult.error, links: withPending(links) });
    return;
  }
  emit({
    loaded: true,
    missingSql: false,
    error: null,
    links: withPending(links),
    clients: withPendingClients(clientsResult.clients),
    clientsMissingSql: clientsResult.missing,
  });
}

function reload() {
  if (!current) return;
  void load(current.workspaceId, generation);
}

function start(workspaceId: string) {
  const key = workspaceId;
  if (current?.workspaceId === workspaceId) {
    current.users += 1;
    return;
  }
  stop(true);
  generation += 1;
  pendingWrites.clear();
  pendingClients.clear();
  state = { ...EMPTY, key };
  listeners.forEach((fn) => fn());
  let ringTimer: ReturnType<typeof setTimeout> | null = null;
  const unlisten = listenTopic(topicOf(workspaceId), () => {
    if (ringTimer) return;
    ringTimer = setTimeout(() => {
      ringTimer = null;
      reload();
    }, 300);
  });
  const poll = setInterval(() => {
    if (document.visibilityState === "visible") reload();
  }, POLL_MS);
  const onVisible = () => {
    if (document.visibilityState === "visible") reload();
  };
  document.addEventListener("visibilitychange", onVisible);
  current = {
    workspaceId,
    users: 1,
    stop: () => {
      unlisten();
      clearInterval(poll);
      if (ringTimer) clearTimeout(ringTimer);
      document.removeEventListener("visibilitychange", onVisible);
    },
  };
  void load(workspaceId, generation);
}

function stop(force = false) {
  if (!current) return;
  current.users -= 1;
  if (current.users > 0 && !force) return;
  current.stop();
  current = null;
  generation += 1;
  state = EMPTY;
  listeners.forEach((fn) => fn());
}

/** Привязки чатов этого workspace (только пока открыт раздел). */
export function useTgChatLinks(workspaceId: string | null, enabled: boolean): TgChatLinksState {
  useEffect(() => {
    if (!enabled || !workspaceId) return;
    start(workspaceId);
    return () => stop();
  }, [enabled, workspaceId]);
  const snapshot = useSyncExternalStore(subscribe, () => state);
  return enabled && snapshot.key === workspaceId ? snapshot : EMPTY;
}

/**
 * Привязать чат к нику ОС (`null` — снять). Видно сразу; отказ базы
 * возвращает прежнее и бросает ошибку для тоста.
 */
export async function setTgChatLink(workspaceId: string, chatId: number, osValue: string | null, title: string, myUid: string): Promise<void> {
  const before = state.key === workspaceId ? (state.links[chatId] ?? null) : null;
  const optimistic: TgChatLink | null = osValue ? { chatId, osValue, title: title || before?.title || "", boundBy: myUid, boundAt: Date.now() } : null;
  pendingWrites.set(chatId, optimistic);
  if (state.key === workspaceId) emit({ links: withPending(state.links) });
  try {
    const { data, error } = await supabaseRows.rpc("tg_link_chat", {
      p_workspace: workspaceId,
      p_chat_id: chatId,
      p_os_value: osValue ?? "",
      p_title: title,
    });
    if (error) {
      if (isSbMissingError(error)) throw new Error("Привязка чатов появится после обновления базы — SQL накатится со следующим деплоем");
      throw new Error(error.message || "Не удалось привязать чат");
    }
    pendingWrites.delete(chatId);
    if (state.key === workspaceId) {
      const links = { ...state.links };
      const row = Array.isArray(data) ? data[0] : data;
      if (row && typeof row === "object" && "os_value" in (row as object)) links[chatId] = toLink(row as Parameters<typeof toLink>[0]);
      else delete links[chatId];
      emit({ links: withPending(links) });
    }
    ringTopic(topicOf(workspaceId));
  } catch (error) {
    pendingWrites.delete(chatId);
    if (state.key === workspaceId) {
      const links = { ...state.links };
      if (before) links[chatId] = before;
      else delete links[chatId];
      emit({ links: withPending(links) });
    }
    throw error;
  }
}

// ---------------------------------------------------------------------
// Клиент (строка стола).
// ---------------------------------------------------------------------

export interface TgClientTarget {
  pageId: string;
  tabId: string;
  rowId: string;
  label: string;
}

/** Привязать чат к клиенту (`null` — снять). Видно сразу, отказ откатывает. */
export async function setTgChatClient(workspaceId: string, chatId: number, target: TgClientTarget | null, myUid: string): Promise<void> {
  const before = state.key === workspaceId ? (state.clients[chatId] ?? null) : null;
  const optimistic: TgChatClient | null = target ? { chatId, ...target, boundBy: myUid, boundAt: Date.now() } : null;
  pendingClients.set(chatId, optimistic);
  if (state.key === workspaceId) emit({ clients: withPendingClients(state.clients) });
  try {
    const { data, error } = await supabaseRows.rpc("tg_link_client", {
      p_workspace: workspaceId,
      p_chat_id: chatId,
      p_page_id: target?.pageId ?? "",
      p_tab_id: target?.tabId ?? "",
      p_row_id: target?.rowId ?? "",
      p_label: target?.label ?? "",
    });
    if (error) {
      if (isSbMissingError(error)) throw new Error("Привязка к клиенту появится после обновления базы — SQL накатится со следующим деплоем");
      throw new Error(error.message || "Не удалось привязать клиента");
    }
    pendingClients.delete(chatId);
    if (state.key === workspaceId) {
      const clients = { ...state.clients };
      const row = Array.isArray(data) ? data[0] : data;
      if (row && typeof row === "object" && "row_id" in (row as object)) clients[chatId] = toClient(row as ClientRow);
      else delete clients[chatId];
      emit({ clients: withPendingClients(clients) });
    }
    rowChatCache.clear();
    ringTopic(topicOf(workspaceId));
  } catch (error) {
    pendingClients.delete(chatId);
    if (state.key === workspaceId) {
      const clients = { ...state.clients };
      if (before) clients[chatId] = before;
      else delete clients[chatId];
      emit({ clients: withPendingClients(clients) });
    }
    throw error;
  }
}

export interface TgClientFound {
  pageId: string;
  tabId: string;
  rowId: string;
  cells: Record<string, string>;
  at: number;
}

/** Поиск клиента по имени или телефону — только среди строк, которые человек и так читает. */
export async function findTgClients(workspaceId: string, query: string): Promise<TgClientFound[]> {
  const { data, error } = await supabaseRows.rpc("tg_find_clients", { p_workspace: workspaceId, p_query: query, p_limit: 20 });
  if (error) {
    if (isSbMissingError(error)) throw new Error("Поиск клиентов появится после обновления базы — SQL накатится со следующим деплоем");
    throw new Error(error.message || "Не удалось найти клиентов");
  }
  return ((data ?? []) as Array<{ page_id: string; tab_id: string | null; row_id: string; cells: Record<string, unknown> | null; created_at: number | null; filled_at: number | null }>).map((r) => {
    const cells: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.cells ?? {})) if (v != null) cells[k] = String(v);
    return { pageId: r.page_id, tabId: r.tab_id ?? "", rowId: r.row_id, cells, at: Number(r.filled_at ?? r.created_at ?? 0) };
  });
}

/** Обратный путь для визитки: чат, привязанный к этой строке (кэш на минуту). */
const rowChatCache = new Map<string, { at: number; value: Promise<number | null> }>();
export function fetchTgChatForRow(workspaceId: string, pageId: string, rowId: string): Promise<number | null> {
  const key = `${workspaceId}:${pageId}:${rowId}`;
  const hit = rowChatCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  const value = (async () => {
    const { data, error } = await supabaseRows
      .from("tg_chat_clients")
      .select("chat_id")
      .eq("workspace_id", workspaceId)
      .eq("page_id", pageId)
      .eq("row_id", rowId)
      .order("bound_at", { ascending: false })
      .limit(1);
    if (error || !Array.isArray(data) || data.length === 0) return null;
    return Number((data[0] as { chat_id: number | string }).chat_id);
  })();
  rowChatCache.set(key, { at: Date.now(), value });
  return value;
}
