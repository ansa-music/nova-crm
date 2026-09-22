/**
 * Уведомления САМОГО БРАУЗЕРА (Web Notifications API) — то, что всплывает
 * поверх окон, когда вкладка с Nova свёрнута. Колокольчик в шапке про новый
 * заказ узнаёт мгновенно, но его никто не видит: технарь в это время в другой
 * программе.
 *
 * Firebase Cloud Messaging здесь НЕ используется — на Spark его нет, да и
 * push без открытой вкладки требует service worker и сервера. Это честный
 * «пока сайт открыт» уровень: вкладка может быть свёрнута или в фоне, но
 * должна быть открыта. На iPhone Safari `Notification` в обычной вкладке
 * отсутствует вовсе (только у установленного на экран «Домой» приложения) —
 * там остаётся звук и тост, поэтому `supported()` проверяем всегда.
 */

import orderSoundUrl from "@/assets/sounds/new-order.mp3";

const PREF_KEY = "nova:browser-notify";
/** Событие «человек кликнул по всплывашке» — навигацию делает React-слой. */
export const NOTIFY_OPEN_EVENT = "nova:notify-open";

/** Для «Как включить»: шаги в Chrome, Safari и на телефоне разные. */
export type NotifyBrowser = "chrome" | "edge" | "yandex" | "opera" | "firefox" | "safari-mac" | "android" | "ios" | "other";

export function detectNotifyBrowser(): NotifyBrowser {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  const iPadOs = /Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
  if (/iPhone|iPad|iPod/.test(ua) || iPadOs) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/YaBrowser/.test(ua)) return "yandex";
  if (/Edg\//.test(ua)) return "edge";
  if (/OPR\//.test(ua)) return "opera";
  if (/Firefox\//.test(ua)) return "firefox";
  if (/Chrome\//.test(ua)) return "chrome";
  if (/Safari\//.test(ua)) return "safari-mac";
  return "other";
}

export function browserNotifySupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function browserNotifyPermission(): NotificationPermission | "unsupported" {
  if (!browserNotifySupported()) return "unsupported";
  try {
    return Notification.permission;
  } catch {
    return "unsupported";
  }
}

/** Выключатель самого человека — отдельно от разрешения браузера. */
export function browserNotifyMuted(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === "off";
  } catch {
    return false;
  }
}

export function setBrowserNotifyMuted(muted: boolean) {
  try {
    if (muted) localStorage.setItem(PREF_KEY, "off");
    else localStorage.removeItem(PREF_KEY);
  } catch {
    /* приватный режим — не беда, останется на эту сессию */
  }
  publishState();
}

/**
 * Состояние на ОДИН экран, а не на компонент: переключатель живёт и в
 * колокольчике, и плашкой на «Заказах». Со своим `useState` у каждого
 * выключенные в колокольчике всплывашки не возвращали плашку на «Заказах» —
 * пока страницу не перезагрузят.
 */
export interface BrowserNotifyState {
  permission: NotificationPermission | "unsupported";
  muted: boolean;
}

let stateSnapshot: BrowserNotifyState = { permission: "default", muted: false };
const stateListeners = new Set<() => void>();

function publishState() {
  const next: BrowserNotifyState = { permission: browserNotifyPermission(), muted: browserNotifyMuted() };
  if (next.permission === stateSnapshot.permission && next.muted === stateSnapshot.muted) return;
  // Ссылка на объект обязана меняться ТОЛЬКО при настоящем изменении:
  // useSyncExternalStore сравнивает снимки по ссылке и зациклится иначе.
  stateSnapshot = next;
  stateListeners.forEach((fn) => fn());
}

export function subscribeBrowserNotify(listener: () => void): () => void {
  stateListeners.add(listener);
  return () => {
    stateListeners.delete(listener);
  };
}

export function browserNotifyState(): BrowserNotifyState {
  return stateSnapshot;
}

/** Всплывашка реально покажется: и разрешение есть, и человек не выключил. */
export function browserNotifyActive(): boolean {
  return browserNotifyPermission() === "granted" && !browserNotifyMuted();
}

/**
 * Перечитать разрешение — после того как человек поменял его в настройках
 * сайта («Как включить»). Chrome обновляет `Notification.permission` сразу,
 * без перезагрузки.
 */
export function refreshBrowserNotifyState() {
  publishState();
}

/**
 * Следить за разрешением самим: вернул человек «Разрешить» в настройках
 * сайта — плашка и колокольчик меняются сами, без «обновите страницу».
 * Permissions API есть не везде (Safari до 16) — там хватает «Проверить».
 */
let permissionWatchStarted = false;
export function watchBrowserNotifyPermission() {
  if (permissionWatchStarted || typeof navigator === "undefined" || !navigator.permissions?.query) return;
  permissionWatchStarted = true;
  void navigator.permissions
    .query({ name: "notifications" as PermissionName })
    .then((status) => {
      status.onchange = () => publishState();
    })
    .catch(() => {
      permissionWatchStarted = false;
    });
  // Вернулись на вкладку из настроек браузера — тоже перечитать.
  window.addEventListener("focus", () => publishState());
}

/**
 * Спрашивать разрешение можно только по клику: Chrome и Safari молча
 * отклоняют запрос без жеста, и второй раз спросить уже нельзя.
 */
export async function requestBrowserNotify(): Promise<NotificationPermission | "unsupported"> {
  if (!browserNotifySupported()) return "unsupported";
  try {
    const result = await Notification.requestPermission();
    if (result === "granted") setBrowserNotifyMuted(false);
    publishState();
    // Разрешение дают жестом — тем же жестом «расталкиваем» звук: без клика
    // AudioContext остаётся suspended и первый же сигнал уходит в тишину.
    primeAlertSound();
    return result;
  } catch {
    return browserNotifyPermission();
  }
}

export interface BrowserNotifyInput {
  title: string;
  body: string;
  /** Одинаковый tag схлопывает повторы одного события в одну всплывашку. */
  tag?: string;
  href?: string | null;
}

export function showBrowserNotification({ title, body, tag, href }: BrowserNotifyInput): boolean {
  if (!browserNotifyActive()) return false;
  try {
    const notification = new Notification(title, { body, tag, icon: "/logo.svg" });
    notification.onclick = () => {
      try {
        window.focus();
        notification.close();
        if (href) window.dispatchEvent(new CustomEvent(NOTIFY_OPEN_EVENT, { detail: href }));
      } catch {
        /* окно могли закрыть */
      }
    };
    return true;
  } catch {
    // Firefox бросает, если вызвать конструктор без service worker на Android.
    return false;
  }
}

let audioContext: AudioContext | null = null;

function ensureAudio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audioContext = audioContext ?? new Ctor();
    if (audioContext.state === "suspended") void audioContext.resume();
    return audioContext;
  } catch {
    return null;
  }
}

/**
 * Запасной путь для звука заказа — `<audio>`. На iPhone он играет вне жеста,
 * только если ЭТОТ ЖЕ элемент уже хоть раз запускали жестом: поэтому элемент
 * один на приложение и «отпирается» беззвучным запуском при первом касании.
 */
let orderAudioElement: HTMLAudioElement | null = null;
let orderAudioUnlocked = false;

function orderAudio(): HTMLAudioElement | null {
  if (typeof Audio === "undefined") return null;
  if (!orderAudioElement) {
    orderAudioElement = new Audio(orderSoundUrl);
    orderAudioElement.preload = "auto";
    orderAudioElement.volume = 0.9;
  }
  return orderAudioElement;
}

function unlockOrderAudio() {
  if (orderAudioUnlocked) return;
  const el = orderAudio();
  if (!el) return;
  try {
    el.muted = true;
    void el
      .play()
      .then(() => {
        el.pause();
        el.currentTime = 0;
        orderAudioUnlocked = true;
      })
      .catch(() => {
        /* не жест — попробуем на следующем касании */
      })
      .finally(() => {
        el.muted = false;
      });
  } catch {
    el.muted = false;
  }
}

/** Создать и разбудить контекст в момент клика — дальше звук пойдёт и из фона. */
export function primeAlertSound() {
  const ctx = ensureAudio();
  if (ctx) void loadOrderSound(ctx);
  unlockOrderAudio();
}

/**
 * Будить звук по касанию страницы, а не только по кнопке «Включить»:
 * браузер не даёт играть звук странице, с которой человек ещё не
 * взаимодействовал, — и первый заказ после входа уходил в тишину.
 *
 * События — те, что браузер считает жестом: на телефоне это `pointerup` /
 * `touchend` / `click`, а НЕ `pointerdown` (им звук на касании не
 * отпирается). Слушаем, пока звук реально не проснулся, а не один раз:
 * касание, которое браузер жестом не посчитал, иначе снимало бы слушатели
 * впустую.
 */
const PRIME_EVENTS = ["pointerdown", "pointerup", "touchend", "click", "keydown"] as const;
let primeListenersAttached = false;
export function primeAlertSoundOnFirstInteraction() {
  if (primeListenersAttached || typeof window === "undefined") return;
  primeListenersAttached = true;
  const prime = () => {
    primeAlertSound();
    const ready = audioContext?.state === "running" && orderAudioUnlocked;
    if (!ready) return;
    for (const type of PRIME_EVENTS) window.removeEventListener(type, prime, true);
  };
  for (const type of PRIME_EVENTS) window.addEventListener(type, prime, true);
}

/**
 * Звук заказа — файл, который выбрал Nurba (`assets/sounds/new-order.mp3`).
 * Играем его через тот же AudioContext, что и короткий сигнал: контекст,
 * разбуженный кликом, играет и из фоновой вкладки, а `new Audio().play()` без
 * свежего жеста браузер может заглушить. Декодируем один раз и держим буфер.
 */
let orderSoundBuffer: AudioBuffer | null = null;
let orderSoundLoading: Promise<AudioBuffer | null> | null = null;

/**
 * `decodeAudioData` обещанием умеют не все: старый Safari понимает только
 * колбэки и возвращает undefined — тогда `.then` падал, и вместо звука заказа
 * играл запасной сигнал. Поддерживаем обе формы.
 */
function decodeAudio(ctx: AudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    try {
      const maybe = ctx.decodeAudioData(data, resolve, reject) as Promise<AudioBuffer> | undefined;
      if (maybe && typeof maybe.then === "function") maybe.then(resolve, reject);
    } catch (error) {
      reject(error);
    }
  });
}

function loadOrderSound(ctx: AudioContext): Promise<AudioBuffer | null> {
  if (orderSoundBuffer) return Promise.resolve(orderSoundBuffer);
  orderSoundLoading =
    orderSoundLoading ??
    fetch(orderSoundUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`order sound ${res.status}`);
        return res.arrayBuffer();
      })
      .then((data) => decodeAudio(ctx, data))
      .then((buffer) => {
        orderSoundBuffer = buffer;
        return buffer;
      })
      .catch(() => {
        orderSoundLoading = null;
        return null;
      });
  return orderSoundLoading;
}

/**
 * Звук уведомления о ЗАКАЗЕ. Не вышло (нет AudioContext, файл не
 * загрузился) — обычным `<audio>`, а если и он не может — коротким сигналом:
 * заказ без звука — ровно то, от чего это всё делалось.
 */
export function playOrderSound() {
  if (browserNotifyMuted()) return;
  const ctx = ensureAudio();
  const fallback = () => {
    const el = orderAudio();
    if (!el) {
      playAlertSound();
      return;
    }
    try {
      el.muted = false;
      el.currentTime = 0;
      void el.play().catch(() => playAlertSound());
    } catch {
      playAlertSound();
    }
  };
  if (!ctx) {
    fallback();
    return;
  }
  void loadOrderSound(ctx).then(async (buffer) => {
    // Контекст мог уснуть (вкладка долго в фоне) — будим; не проснулся —
    // играем `<audio>`: на спящем контексте звук ушёл бы в тишину без ошибки.
    if (ctx.state !== "running") {
      try {
        await ctx.resume();
      } catch {
        /* нет жеста */
      }
    }
    if (!buffer || ctx.state !== "running") {
      fallback();
      return;
    }
    try {
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      gain.gain.value = 0.9;
      source.buffer = buffer;
      source.connect(gain).connect(ctx.destination);
      source.start();
    } catch {
      fallback();
    }
  });
}

/**
 * Короткий двойной сигнал. Именно он, а не всплывашка, заставляет поднять
 * глаза: всплывашку на macOS и Windows легко пропустить, звук — нет.
 */
export function playAlertSound() {
  if (browserNotifyMuted()) return;
  const ctx = ensureAudio();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    for (const [index, freq] of [880, 1175].entries()) {
      const at = now + index * 0.16;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      // Резкий старт щёлкает — поэтому короткий подъём и плавный спад.
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.14, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.14);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.16);
    }
  } catch {
    /* звук — не повод ронять уведомление */
  }
}

/**
 * «Проверить» рядом с переключателем: тот же путь, что у настоящего заказа.
 * Возвращает false, если всплывашку показать не удалось — вызывающий покажет
 * тост, иначе человек нажал кнопку и не понял, сработало ли.
 */
export function previewBrowserNotification(): boolean {
  playOrderSound();
  return showBrowserNotification({
    title: "Новый заказ",
    body: "Так будет выглядеть уведомление о заказе с биржи.",
    tag: "nova-preview",
    href: "/orders",
  });
}

// Первый снимок берём после объявления всех читателей — на верхнем уровне
// модуля `browserNotifyPermission` ещё не определена при инициализации поля.
publishState();
