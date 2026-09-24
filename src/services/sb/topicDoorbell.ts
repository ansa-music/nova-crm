import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

/**
 * «Звонок по теме» — живость коллекций Supabase без Postgres Changes.
 *
 * То же, что звонок строк (services/rows/rowsDoorbell.ts, его не трогаем —
 * на нём держатся столы и старые вкладки), но для любой темы вида
 * `nova:{ws}:{коллекция}`. Postgres Changes в проде не поднимается (ID-токен
 * Firebase без claim `role`), поэтому писатель после СВОЕЙ записи звонит в
 * открытый broadcast-канал АНОНИМНОГО клиента (`lib/supabase.ts`), а каждый
 * читатель по звонку дочитывает изменившееся своим токеном (под политиками).
 *
 * В звонке НЕТ данных — только id вкладки: анонимный ключ публичный, и
 * посторонний, зная тему, узнает разве что «там что-то поменялось». Ложный
 * звонок стоит читателю одного крошечного запроса «rev > курсор».
 *
 * Серия записей за 600 мс — один звонок. Тема у себя открыта — по сокету
 * (ещё не вошла — по REST тем же каналом), нет — по REST (`httpSend`,
 * временный канал сразу убирается). Слушатели
 * ЭТОЙ вкладки узнают о своей записи сразу, без сети: Owner на дашборде,
 * пересчитавший стол, должен увидеть новые цифры, а свой звонок канал
 * обратно не приносит (`self: false`).
 */

type Ring = () => void;

interface Room {
  channel: RealtimeChannel;
  listeners: Set<Ring>;
  ready: boolean;
  statusListeners: Set<(ready: boolean) => void>;
}

const RING_EVENT = "ring";
/** Серию быстрых записей — одним звонком. */
const RING_COALESCE_MS = 600;

/** Кто звонит: свои звонки, вернувшиеся по REST, не дочитываем второй раз. */
const instanceId = Math.random().toString(36).slice(2);

let client: SupabaseClient | null = supabase;
const rooms = new Map<string, Room>();
const pending = new Map<string, ReturnType<typeof setTimeout>>();
/** Слушатели этой вкладки по темам — им свой звонок доставляется напрямую. */
const localListeners = new Map<string, Set<Ring>>();

/** Для проверок: подменить клиента Realtime (null — звонки выключены). */
export function setTopicDoorbellClient(next: SupabaseClient | null) {
  client = next;
}

/**
 * Слушать тему. `onRing()` — кто-то записал; `onStatus(ready)` — канал
 * поднялся/упал (не поднялся — у читателя остаётся опрос).
 */
export function listenTopic(topic: string, onRing: Ring, onStatus?: (ready: boolean) => void): () => void {
  let local = localListeners.get(topic);
  if (!local) {
    local = new Set();
    localListeners.set(topic, local);
  }
  local.add(onRing);
  const localSet = local;

  let current: Room | null = null;
  if (client) {
    let room = rooms.get(topic);
    if (!room) {
      const channel = client.channel(topic, { config: { broadcast: { self: false } } });
      const created: Room = { channel, listeners: new Set(), ready: false, statusListeners: new Set() };
      room = created;
      rooms.set(topic, created);
      channel
        .on("broadcast", { event: RING_EVENT }, (message) => {
          const payload = (message?.payload ?? {}) as { from?: unknown };
          if (payload.from === instanceId) return;
          for (const listener of created.listeners) listener();
        })
        .subscribe((status) => {
          const ready = status === "SUBSCRIBED";
          if (ready === created.ready) return;
          created.ready = ready;
          for (const listener of created.statusListeners) listener(ready);
        });
    }
    current = room;
    current.listeners.add(onRing);
    if (onStatus) {
      current.statusListeners.add(onStatus);
      if (current.ready) onStatus(true);
    }
  } else {
    onStatus?.(false);
  }

  return () => {
    localSet.delete(onRing);
    if (localSet.size === 0 && localListeners.get(topic) === localSet) localListeners.delete(topic);
    if (!current) return;
    const room = current;
    room.listeners.delete(onRing);
    if (onStatus) room.statusListeners.delete(onStatus);
    if (room.listeners.size === 0 && rooms.get(topic) === room) {
      rooms.delete(topic);
      void client?.removeChannel(room.channel);
    }
  };
}

/** В теме что-то записано — позвонить всем, кто её слушает (и своим — сразу). */
export function ringTopic(topic: string) {
  if (pending.has(topic)) return;
  pending.set(
    topic,
    setTimeout(() => {
      pending.delete(topic);
      for (const listener of [...(localListeners.get(topic) ?? [])]) {
        try {
          listener();
        } catch {
          /* чужой слушатель не должен ронять звонок остальным */
        }
      }
      void send(topic);
    }, RING_COALESCE_MS)
  );
}

async function send(topic: string) {
  const target = client;
  if (!target) return;
  const payload = { from: instanceId };
  try {
    const room = rooms.get(topic);
    if (room) {
      // Комната темы есть — звоним ЕЁ каналом: по сокету, если он поднят,
      // иначе по REST (httpSend состояния канала не требует). Отдельный канал
      // тут брать нельзя: RealtimeClient.channel(topic) отдаёт уже открытый
      // канал с той же темой, и removeChannel после звонка отписал бы
      // комнату, пока она ещё входит (или переподключается), — все слушатели
      // вкладки оглохли бы до ухода с экрана, остался бы только опрос.
      if (room.ready) await room.channel.send({ type: "broadcast", event: RING_EVENT, payload });
      else await room.channel.httpSend(RING_EVENT, payload);
      return;
    }
    // Тема у себя не открыта (технарь пишет счётчики, дашборд у других) — по REST.
    const channel = target.channel(topic);
    try {
      await channel.httpSend(RING_EVENT, payload);
    } finally {
      // Пока шёл звонок, экран мог открыть эту тему — и получить от клиента
      // ЭТОТ же канал (см. выше). Тогда он уже канал комнаты: не трогаем.
      if (rooms.get(topic)?.channel !== channel) void target.removeChannel(channel);
    }
  } catch {
    // Звонок не дошёл — у остальных сработает опрос.
  }
}
