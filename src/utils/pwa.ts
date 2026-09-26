import { useSyncExternalStore } from "react";

/**
 * Приложение без Google Play и App Store (PWA): манифест `public/manifest.webmanifest`,
 * сервис-воркер `public/sw.js`, установка с самого сайта.
 *
 *  - Chrome / Edge / Android: браузер присылает `beforeinstallprompt` — ловим
 *    его сразу при загрузке (до React) и показываем свою кнопку «Установить».
 *  - iPhone / iPad: такого события нет — только «Поделиться → На экран
 *    «Домой»». Показываем шаги. Всплывашки на iPhone работают ТОЛЬКО у
 *    установленного так приложения (iOS 16.4+), и только через воркер.
 *
 * Выключатель на устройстве: localStorage `nova:sw-off=1` — воркер снимается
 * при следующей загрузке (на случай, если что-то пойдёт не так с кэшем).
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallMode = "installed" | "prompt" | "ios" | "ios-other" | "manual" | "unsupported";

let deferred: BeforeInstallPromptEvent | null = null;
let installedNow = false;
const listeners = new Set<() => void>();
let snapshot: InstallMode = "unsupported";

function emit() {
  snapshot = computeMode();
  for (const l of [...listeners]) l();
}

/** Запущено как установленное приложение (своё окно, без адресной строки). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return Boolean(nav.standalone) || window.matchMedia?.("(display-mode: standalone)").matches || window.matchMedia?.("(display-mode: minimal-ui)").matches;
}

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iPadOs = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return /iPhone|iPad|iPod/.test(ua) || iPadOs;
}

function computeMode(): InstallMode {
  if (typeof window === "undefined") return "unsupported";
  if (installedNow || isStandalone()) return "installed";
  if (deferred) return "prompt";
  if (isIos()) {
    // На iPhone «На экран «Домой»» есть в Safari; с iOS 16.4 — и в Chrome/Edge
    // (тоже через «Поделиться»). В других — подсказываем открыть Safari.
    const ua = navigator.userAgent;
    return /CriOS|EdgiOS|FxiOS|OPiOS|Safari/.test(ua) ? "ios" : "ios-other";
  }
  // Десктоп/Android без события (Firefox, Яндекс, уже отклонили) — меню браузера.
  return "manual";
}

export function installMode(): InstallMode {
  return snapshot;
}

export function subscribeInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useInstallMode(): InstallMode {
  return useSyncExternalStore(subscribeInstall, installMode, installMode);
}

/** Показать окно установки браузера (Chrome/Edge/Android). */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = deferred;
  if (!event) return "unavailable";
  deferred = null;
  try {
    await event.prompt();
    const choice = await event.userChoice;
    if (choice.outcome === "accepted") installedNow = true;
    return choice.outcome;
  } catch {
    return "unavailable";
  } finally {
    emit();
  }
}

// ---------------------------------------------------------------------
// Запуск: ловим событие установки и регистрируем воркер.
// ---------------------------------------------------------------------

const SW_OFF_KEY = "nova:sw-off";

export function initPwa() {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    installedNow = true;
    deferred = null;
    emit();
  });
  window.matchMedia?.("(display-mode: standalone)").addEventListener?.("change", emit);
  snapshot = computeMode();

  if (!("serviceWorker" in navigator)) return;
  let off = false;
  try {
    off = localStorage.getItem(SW_OFF_KEY) === "1";
  } catch {
    /* без localStorage — как обычно */
  }
  if (off) {
    void navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => void r.unregister()));
    return;
  }
  // Переход по нажатию на всплывашку, показанную воркером, — роутером страницы.
  navigator.serviceWorker.addEventListener("message", (event) => {
    const data = event.data as { type?: string; href?: string } | null;
    if (data?.type === "nova:notify-open" && typeof data.href === "string") {
      window.dispatchEvent(new CustomEvent("nova:notify-open", { detail: data.href }));
    }
  });
  const register = () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}

/** Регистрация воркера, если она уже есть (для всплывашек через него). */
export async function activeWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    return reg?.active ? reg : null;
  } catch {
    return null;
  }
}
