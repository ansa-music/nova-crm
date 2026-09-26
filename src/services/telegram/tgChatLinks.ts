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

export interface TgChatLinksState {
  key: string | null;
  loaded: boolean;
  links: Record<number, TgChatLink>;
  /** SQL 20261013 ещё не накатан — привязку не показываем. */
  missingSql: boolean;
  error: string | null;
}

const EMPTY: TgChatLinksState = { key: null, loaded: false, links: {}, missingSql: false, error: null };
const POLL_MS = 60_000;
const PAGE = 1000;

let state: TgChatLinksState = EMPTY;
const listeners = new Set<() => void>();
let current: { workspaceId: string; users: number; stop: () => void } | null = null;
let generation = 0;
/** Свои правки в пути: выборка, пришедшая раньше ответа базы, их не откатывает. */
const pendingWrites = new Map<number, TgChatLink | null>();

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
  emit({ loaded: true, missingSql: false, error: null, links: withPending(links) });
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
