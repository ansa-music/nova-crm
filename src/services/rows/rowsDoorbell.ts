import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { ringTargets, saltedTopic, whenRingSalt } from "@/services/sb/ringSalt";

/**
 * «Звонок» об изменённых строках — живое обновление стола без Postgres Changes.
 *
 * Postgres Changes (`sbSubscribeRows`) у Nurba не поднимается: Realtime
 * проверяет права по полю `role` в токене, а ID-токен Firebase его не несёт
 * (положить его туда может только серверный ключ Firebase — custom claims, —
 * которого у нас нет). Итог — плашка «Живое обновление строк не работает» и
 * чужие правки раз в 15 секунд по отметке таблицы.
 *
 * Звонок идёт мимо токена Firebase: по ОТКРЫТОМУ broadcast-каналу анонимного
 * клиента (`lib/supabase.ts`, им уже ходит Storage). Вкладка, записавшая
 * строки, говорит в канал стола «на этой вкладке стола что-то поменялось», а
 * все, у кого стол открыт, сверяют отметку таблицы (`rows_table_stamp`,
 * десятки байт) и перечитывают строки своим токеном — уже под политиками.
 * В канале НЕТ данных: только id вкладки. Анонимный ключ публичный, поэтому
 * посторонний, зная id стола, может узнать разве что «там что-то поменяли» —
 * сами строки ему по-прежнему не отдаст RLS.
 *
 * Не поднялся и звонок (сеть, закрытый публичный Realtime) — остаётся опрос
 * отметки раз в 15 секунд, как было.
 *
 * С 26.09.2026 (SaaS этап 4) тема ещё и СОЛЁНАЯ — `rows-ring:{ws}~{соль}:{стол}`
 * (services/sb/ringSalt.ts): соль видит только участник, и посторонний с id
 * стола больше не слышит даже «там что-то поменяли». Прежняя тема слушается
 * тоже, а до конца перехода в неё и звонят — ради вкладок на старом коде.
 */

type Ring = (tabId: string) => void;
type RoomRing = (tabs: string[], rid: string | null) => void;

interface Room {
  channel: RealtimeChannel;
  listeners: Set<RoomRing>;
  ready: boolean;
  statusListeners: Set<(ready: boolean) => void>;
}

const RING_EVENT = "ring";
/** Серию быстрых правок (ввод, вставка) — одним звонком. */
const RING_COALESCE_MS = 600;

/** Кто звонит: свои звонки, вернувшиеся по REST, не перечитываем. */
const instanceId = Math.random().toString(36).slice(2);
let ringSeq = 0;

let client: SupabaseClient | null = supabase;
/** Комнаты по ФИЗИЧЕСКОЙ теме (прежняя и солёная — разные комнаты). */
const rooms = new Map<string, Room>();
const pending = new Map<string, { tabs: Set<string>; timer: ReturnType<typeof setTimeout> }>();

function topicOf(workspaceId: string, pageId: string): string {
  return `rows-ring:${workspaceId}:${pageId}`;
}

/** Для проверок: подменить клиента Realtime. */
export function setRowsDoorbellClient(next: SupabaseClient | null) {
  client = next;
}

function joinRoom(target: SupabaseClient, topic: string, onRing: RoomRing, onStatus: (ready: boolean) => void): () => void {
  let room = rooms.get(topic);
  if (!room) {
    const channel = target.channel(topic, { config: { broadcast: { self: false } } });
    const created: Room = { channel, listeners: new Set(), ready: false, statusListeners: new Set() };
    room = created;
    rooms.set(topic, created);
    channel
      .on("broadcast", { event: RING_EVENT }, (message) => {
        const payload = (message?.payload ?? {}) as { from?: string; tabs?: unknown; rid?: unknown };
        if (payload.from === instanceId || !Array.isArray(payload.tabs)) return;
        const tabs = payload.tabs.filter((tab): tab is string => typeof tab === "string");
        const rid = typeof payload.rid === "string" ? payload.rid : null;
        for (const listener of created.listeners) listener(tabs, rid);
      })
      .subscribe((status) => {
        const ready = status === "SUBSCRIBED";
        if (ready === created.ready) return;
        created.ready = ready;
        for (const listener of created.statusListeners) listener(ready);
      });
  }
  const current = room;
  current.listeners.add(onRing);
  current.statusListeners.add(onStatus);
  if (current.ready) onStatus(true);
  return () => {
    current.listeners.delete(onRing);
    current.statusListeners.delete(onStatus);
    if (current.listeners.size === 0 && rooms.get(topic) === current) {
      rooms.delete(topic);
      void target.removeChannel(current.channel);
    }
  };
}

/**
 * Слушать звонки стола. `onRing(tabId)` — кто-то записал строки этой вкладки;
 * `onStatus(ready)` — канал звонков поднялся/упал.
 */
export function listenRowsDoorbell(
  workspaceId: string,
  pageId: string,
  onRing: Ring,
  onStatus?: (ready: boolean) => void
): () => void {
  const target = client;
  if (!target) return () => {};
  const topic = topicOf(workspaceId, pageId);
  const seen: string[] = [];
  const deliver: RoomRing = (tabs, rid) => {
    if (rid) {
      if (seen.includes(rid)) return;
      seen.push(rid);
      if (seen.length > 32) seen.shift();
    }
    for (const tab of tabs) onRing(tab);
  };
  let legacyReady = false;
  let saltedReady = false;
  let salted = false;
  let reported = false;
  const report = () => {
    const ready = salted ? saltedReady : legacyReady;
    if (ready === reported) return;
    reported = ready;
    onStatus?.(ready);
  };
  let closed = false;
  const leaveLegacy = joinRoom(target, topic, deliver, (ready) => {
    legacyReady = ready;
    report();
  });
  let leaveSalted: (() => void) | null = null;
  const stopWaiting = whenRingSalt(workspaceId, (salt) => {
    if (closed) return;
    salted = true;
    leaveSalted = joinRoom(target, saltedTopic(topic, salt), deliver, (ready) => {
      saltedReady = ready;
      report();
    });
    report();
  });
  return () => {
    closed = true;
    stopWaiting();
    leaveLegacy();
    leaveSalted?.();
  };
}

/** Строки вкладки `tabId` стола записаны — позвонить всем, у кого он открыт. */
export function ringRowsDoorbell(workspaceId: string, pageId: string, tabId: string) {
  if (!client) return;
  const topic = topicOf(workspaceId, pageId);
  const queued = pending.get(topic);
  if (queued) {
    queued.tabs.add(tabId);
    return;
  }
  const entry = {
    tabs: new Set([tabId]),
    timer: setTimeout(() => {
      pending.delete(topic);
      const rid = `${instanceId}.${++ringSeq}`;
      for (const physical of ringTargets(topic)) void send(physical, [...entry.tabs], rid);
    }, RING_COALESCE_MS),
  };
  pending.set(topic, entry);
}

async function send(topic: string, tabs: string[], rid: string) {
  const target = client;
  if (!target) return;
  const payload = { from: instanceId, tabs, rid };
  try {
    const room = rooms.get(topic);
    if (room?.ready) {
      await room.channel.send({ type: "broadcast", event: RING_EVENT, payload });
      return;
    }
    // Комната ещё подключается: realtime-js на тот же topic вернул бы ЕЁ канал,
    // и removeChannel ниже отписал бы слушателя. Шлём через него по REST.
    if (room) {
      await room.channel.httpSend(RING_EVENT, payload);
      return;
    }
    // Стол у себя не открыт (ОС пишет заказ в стол технаря) — по REST, без подписки.
    const channel = target.channel(topic);
    try {
      await channel.httpSend(RING_EVENT, payload);
    } finally {
      if (rooms.get(topic)?.channel !== channel) void target.removeChannel(channel);
    }
  } catch {
    // Звонок не дошёл — у остальных сработает опрос отметки таблицы.
  }
}
