/**
 * Через какой канал этот браузер ходит к Firestore: напрямую или через
 * резервный канал (функция `fs-relay` в Supabase, см. supabase/functions).
 *
 * История. 22.09.2026 весь узел Google, куда Казахтелеком резолвит
 * firestore.googleapis.com, открывал сессию WebChannel, а обратный канал
 * отвечал «400 Unknown SID». Приложение не падало, а вечно висело на
 * «Загружаем профиль…». Узел из кода не выбрать, поэтому при застревании
 * загрузки мы проверяем прямой канал ровно тем же способом, каким он ломается,
 * и, если он сломан, а резервный жив, — переключаемся и перезагружаемся.
 * Выбор помнится на устройстве, но не навсегда: каждую загрузку в резервном
 * режиме прямой канал перепроверяется в фоне, и как только Google починит
 * узел, следующая загрузка пойдёт напрямую.
 *
 * Модуль не импортирует Firestore — его читает `firebase.ts` до создания базы.
 */

const PROJECT_ID = "nurba-6e70d";
const DIRECT_ORIGIN = "https://firestore.googleapis.com";

const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL || "https://xoqivqqcmunavuwpsmsd.supabase.co");
/** Хост для настройки `host` SDK: SDK просто клеит `https://` + host + путь RPC. */
const RELAY_HOST = `${SUPABASE_URL.replace(/^https?:\/\//, "").replace(/\/+$/, "")}/functions/v1/fs-relay`;

/** Отметка «идём через резервный канал» (JSON `{ since }`). */
const RELAY_KEY = "nova:firestore-relay";
/**
 * Только для проверки: канал на этой машине (`localhost:8787`). Принимаем
 * исключительно localhost — чужой адрес сюда подложить бессмысленно.
 */
const RELAY_HOST_OVERRIDE_KEY = "nova:firestore-relay-host";
/** Защита от петли перезагрузок: не чаще раза в 2 минуты на вкладку. */
const SWITCHED_AT_KEY = "nova:firestore-channel-switched-at";
const SWITCH_COOLDOWN_MS = 2 * 60_000;
/** Даже без удачной фоновой проверки резервный режим не живёт дольше суток. */
const RELAY_MAX_AGE_MS = 24 * 60 * 60_000;

function readStorage(storage: "localStorage" | "sessionStorage", key: string): string | null {
  try {
    return typeof window === "undefined" ? null : window[storage].getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(storage: "localStorage" | "sessionStorage", key: string, value: string | null) {
  try {
    if (value === null) window[storage].removeItem(key);
    else window[storage].setItem(key, value);
  } catch {
    // Хранилище недоступно (приватный режим) — живём без памяти о выборе.
  }
}

function localOverrideHost(): string | null {
  const value = readStorage("localStorage", RELAY_HOST_OVERRIDE_KEY);
  return value && /^(localhost|127\.0\.0\.1):\d{2,5}$/.test(value) ? value : null;
}

function relayFlagActive(): boolean {
  const raw = readStorage("localStorage", RELAY_KEY);
  if (!raw) return false;
  try {
    const since = Number((JSON.parse(raw) as { since?: unknown }).since);
    return Number.isFinite(since) && Date.now() - since < RELAY_MAX_AGE_MS;
  } catch {
    return false;
  }
}

const overrideHost = localOverrideHost();

/** Решение принимается один раз на загрузку страницы — SDK настраивается при старте. */
export const firestoreChannel: { relay: boolean; host: string; ssl: boolean } = overrideHost
  ? { relay: true, host: overrideHost, ssl: false }
  : relayFlagActive()
    ? { relay: true, host: RELAY_HOST, ssl: true }
    : { relay: false, host: "firestore.googleapis.com", ssl: true };

function relayOrigin(): string {
  return overrideHost ? `http://${overrideHost}` : `https://${RELAY_HOST}`;
}

export type ChannelProbe = "ok" | "broken" | "unreachable";

/**
 * Проверка канала тем же путём, на котором он ломался: открыть сессию Listen
 * без запросов (документы не читаются, квота не тратится) и сразу подключить
 * обратный канал. Живой узел отвечает 200 и начинает поток, сломанный — 400
 * «Unknown SID». Ответ 400 у Google несёт CORS-заголовки, так что статус
 * читается честно, а не превращается в сетевую ошибку.
 */
export async function probeFirestoreChannel(origin: string, timeoutMs = 8000): Promise<ChannelProbe> {
  const channel = `${origin}/google.firestore.v1.Firestore/Listen/channel`;
  const database = `database=${encodeURIComponent(`projects/${PROJECT_ID}/databases/(default)`)}`;
  const nonce = () => Math.random().toString(36).slice(2, 12);
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const open = await fetch(
      `${channel}?${database}&VER=8&RID=${Math.floor(Math.random() * 90_000) + 10_000}&CVER=22&X-HTTP-Session-Id=gsessionid&zx=${nonce()}&t=1`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "count=0",
        credentials: "omit",
        cache: "no-store",
        signal: controller.signal,
      }
    );
    if (!open.ok) return "unreachable";
    const sid = /"c","([^"]+)"/.exec(await open.text())?.[1];
    if (!sid) return "unreachable";
    const session = open.headers.get("X-HTTP-Session-Id");
    const back = await fetch(
      `${channel}?${database}${session ? `&gsessionid=${encodeURIComponent(session)}` : ""}&VER=8&RID=rpc&SID=${encodeURIComponent(sid)}&AID=0&CI=0&TYPE=xmlhttp&zx=${nonce()}&t=1`,
      { credentials: "omit", cache: "no-store", signal: controller.signal }
    );
    // Живой обратный канал — бесконечный поток; нам хватило статуса.
    controller.abort();
    if (back.status === 200) return "ok";
    if (back.status === 400) return "broken";
    return "unreachable";
  } catch {
    return "unreachable";
  } finally {
    window.clearTimeout(timer);
  }
}

function switchedRecently(): boolean {
  const at = Number(readStorage("sessionStorage", SWITCHED_AT_KEY));
  return Number.isFinite(at) && Date.now() - at < SWITCH_COOLDOWN_MS;
}

function markSwitched() {
  writeStorage("sessionStorage", SWITCHED_AT_KEY, String(Date.now()));
}

function disableRelay() {
  writeStorage("localStorage", RELAY_KEY, null);
}

/**
 * Загрузка застряла — выяснить, поможет ли смена канала. `"reload"` значит:
 * выбор уже записан, осталось перезагрузить страницу. Локальную подмену для
 * проверки не трогаем — её ставят и снимают руками.
 */
export async function decideChannelSwitch(): Promise<"reload" | "stay"> {
  if (overrideHost || switchedRecently()) return "stay";
  const direct = await probeFirestoreChannel(DIRECT_ORIGIN);
  if (firestoreChannel.relay) {
    // Застряли уже на резервном — а прямой, оказывается, жив: возвращаемся.
    if (direct !== "ok") return "stay";
    disableRelay();
    markSwitched();
    return "reload";
  }
  if (direct !== "broken") return "stay";
  if ((await probeFirestoreChannel(relayOrigin())) !== "ok") return "stay";
  writeStorage("localStorage", RELAY_KEY, JSON.stringify({ since: Date.now() }));
  markSwitched();
  return "reload";
}

/**
 * В резервном режиме — один раз за загрузку, в фоне, перепроверить прямой
 * канал. Починился — снимаем отметку, и следующая загрузка пойдёт напрямую.
 * Текущую страницу не перезагружаем: она и так работает.
 */
export function watchDirectChannelRecovery(delayMs = 20_000) {
  if (!firestoreChannel.relay || overrideHost || typeof window === "undefined") return;
  window.setTimeout(() => {
    void probeFirestoreChannel(DIRECT_ORIGIN).then((result) => {
      if (result === "ok") disableRelay();
    });
  }, delayMs);
}
