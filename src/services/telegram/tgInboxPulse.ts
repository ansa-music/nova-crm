/**
 * Непрочитанные Telegram для остального сайта (пункт меню, всплывашка) —
 * без библиотеки Telegram. Пишет только tgClient.ts той вкладки, что держит
 * соединение; в остальных вкладках `live: false`.
 */
export interface TgInboxPulse {
  /** Соединение живо в ЭТОЙ вкладке. */
  live: boolean;
  /** Непрочитанные по чатам (id чата → сколько). */
  unread: Record<number, number>;
}

let pulse: TgInboxPulse = { live: false, unread: {} };
const listeners = new Set<() => void>();

export function tgInboxPulse(): TgInboxPulse {
  return pulse;
}

export function subscribeTgInbox(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function sameUnread(a: Record<number, number>, b: Record<number, number>): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => a[Number(k)] === b[Number(k)]);
}

const CHANNEL = "nova-tg-inbox";
let channel: BroadcastChannel | null = null;
/** Чей Telegram держит ЭТА вкладка (ws:uid) — на него она отвечает новым вкладкам. */
let liveKey: string | null = null;

function channelOf(): BroadcastChannel | null {
  if (channel) return channel;
  if (typeof BroadcastChannel === "undefined") return null;
  channel = new BroadcastChannel(CHANNEL);
  // Новая вкладка спрашивает текущие непрочитанные — отвечает та, что с соединением.
  channel.addEventListener("message", (ev: MessageEvent<{ ask?: string }>) => {
    if (ev.data?.ask && ev.data.ask === liveKey && pulse.live) channel?.postMessage({ key: liveKey, unread: pulse.unread });
  });
  return channel;
}

/**
 * Пишет вкладка с соединением; остальные вкладки того же человека узнают
 * непрочитанные по BroadcastChannel — бейдж в меню горит в любой вкладке.
 */
export function publishTgInbox(next: TgInboxPulse, key: string | null) {
  // Вкладка без соединения своих непрочитанных не знает — её бейдж держит
  // вещание вкладки с соединением. Иначе она стирала бы его себе и другим.
  if (!next.live && !pulse.live) return;
  liveKey = next.live ? key : null;
  if (key) channelOf();
  if (next.live === pulse.live && sameUnread(next.unread, pulse.unread)) return;
  pulse = next;
  listeners.forEach((fn) => fn());
  // Соединение ушло в другую вкладку — та сама разошлёт свои цифры.
  if (key && next.live) channelOf()?.postMessage({ key, unread: next.unread });
}

/** «Выйти» из Telegram: погасить бейдж во всех вкладках этого человека. */
export function clearTgInboxEverywhere(key: string) {
  pulse = { live: false, unread: {} };
  liveKey = null;
  listeners.forEach((fn) => fn());
  channelOf()?.postMessage({ key, unread: {} });
}

/** Вкладка без соединения слушает непрочитанные своего человека. */
export function listenTgInbox(key: string): () => void {
  const ch = channelOf();
  if (!ch) return () => undefined;
  const onMessage = (ev: MessageEvent<{ key?: string; unread?: Record<number, number> }>) => {
    if (ev.data?.key !== key || pulse.live) return;
    const unread = ev.data.unread ?? {};
    if (sameUnread(unread, pulse.unread)) return;
    pulse = { live: false, unread };
    listeners.forEach((fn) => fn());
  };
  ch.addEventListener("message", onMessage);
  ch.postMessage({ ask: key });
  return () => ch.removeEventListener("message", onMessage);
}

/** Всего непрочитанных (для бейджа). */
export function tgUnreadTotal(p: TgInboxPulse): number {
  let n = 0;
  for (const v of Object.values(p.unread)) n += v;
  return n;
}
