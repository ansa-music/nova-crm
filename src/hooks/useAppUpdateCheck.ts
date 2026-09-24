import { useEffect, useRef } from "react";
import { waitForPendingWrites } from "firebase/firestore";
import { toast } from "@/components/ui/sonner";
import { db } from "@/firebase/firebase";
import { flushHistory } from "@/services/historyService";
import { sbWaitForPendingWrites } from "@/services/rows/supabaseRowStore";
import { dbQuotaHit } from "@/utils/dbError";
import { useWorkspace } from "@/hooks/useWorkspace";

/**
 * ЖИВОЕ обновление сайта. Сайт — одностраничное приложение: вкладку не
 * перезагружают днями, и после деплоя человек продолжает работать на СТАРОМ
 * коде. Данные на страницах и так живые (подписки Firestore, Realtime строк);
 * этот хук доводит до вкладки новый КОД.
 *
 * Два повода перезагрузиться:
 * 1. Вышла новая версия: `index.html` отдаётся без кэша (firebase.json), в нём
 *    ссылка на главный бандл с хешем; хеш не тот, с которым вкладка
 *    загрузилась, — значит, выкатили новое. Проверяем раз в 2 минуты, пока
 *    вкладка на виду, и при возвращении на вкладку (это запрос к хостингу, не
 *    к базе — квоту Firestore не тратит).
 * 2. Owner нажал «Обновить сайт у всех»: `workspace.reloadEpoch` вырос
 *    (документ workspace и так живой — лишних чтений нет). Сравниваем со
 *    значением на момент загрузки, а не по часам — часы у всех разные.
 *
 * Новая версия обновляет вкладку САМА, но осторожно — каждая перезагрузка
 * заново читает все подписки (~340 чтений на вкладку), и раньше волна после
 * каждого деплоя съедала квоту Spark:
 * - деплои идут пачками (параллельные сессии), поэтому ждём, пока версия
 *   «устоится» — 3 минуты без новой (`SETTLE_MS`);
 * - одна вкладка обновляется сама не чаще раза в час (`AUTO_COOLDOWN_MS`,
 *   в sessionStorage — переживает саму перезагрузку; было 30 минут — при
 *   десятке деплоев в день это вдвое больше волн холодных перечиток у всех);
 * - на виду — только когда человек отвлёкся: минуту без кликов и клавиш, не
 *   печатает, нет открытого диалога; и ещё 10 секунд тоста «Обновляю… ·
 *   Позже» — любое касание отменяет;
 * - свёрнутая вкладка не перезагружается (брошенные вкладки не читают всё
 *   впустую) — обновится, когда на неё вернутся, ДО первого клика;
 * - кончилась квота базы (`dbQuotaHit`) — только тост: после перезагрузки
 *   страница бы просто не загрузилась.
 * ПРИНУДИТЕЛЬНО — по кнопке Owner: через 30 с с тостом «Обновить сейчас»,
 * человек печатает или открыт диалог — ждём, но не дольше 2 минут.
 * Перед любой перезагрузкой ждём, пока уйдут на сервер последние правки
 * (`reloadSafely`: и Firestore, и строки Supabase).
 */

const CHECK_EVERY_MS = 2 * 60_000;
const MIN_GAP_MS = 30_000;
const COUNTDOWN_MS = 30_000;
const MAX_WAIT_BUSY_MS = 2 * 60_000;
/** Версия «устоялась» — столько без нового деплоя. */
const SETTLE_MS = 3 * 60_000;
/**
 * Сама вкладка обновляется не чаще. Принудительное «Обновить сайт у всех»
 * (`reloadEpoch`) этим не ограничено — оно для срочных правок.
 */
const AUTO_COOLDOWN_MS = 60 * 60_000;
/** Человек отвлёкся — столько без кликов и клавиш. */
const IDLE_MS = 60_000;
/** Тост «Обновляю…» перед автоматической перезагрузкой. */
const AUTO_NOTICE_MS = 10_000;
/** «Позже» откладывает на столько. */
const SNOOZE_MS = 10 * 60_000;
const TICK_MS = 5_000;
const TOAST_ID = "nova-app-update";
const PRELOAD_RELOAD_KEY = "nova:preload-reload-at";
const AUTO_RELOAD_KEY = "nova:auto-reload-at";

function lastAutoReloadAt(): number {
  try {
    return Number(sessionStorage.getItem(AUTO_RELOAD_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function markAutoReload() {
  try {
    sessionStorage.setItem(AUTO_RELOAD_KEY, String(Date.now()));
  } catch {
    /* без sessionStorage — пауза просто не переживёт перезагрузку */
  }
}

/**
 * Главный бандл ЭТОГО сайта. Только свой origin: расширение браузера может
 * вставить свой `…/assets/index-XXXX.js` раньше нашего, и тогда «новая
 * версия» находилась бы всегда.
 */
function currentEntry(): string | null {
  for (const script of Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]'))) {
    try {
      const url = new URL(script.src, window.location.href);
      if (url.origin === window.location.origin) return url.pathname;
    } catch {
      /* кривой src — не наш */
    }
  }
  return null;
}

/**
 * Перезагрузить, но сначала дождаться, пока уйдут на сервер последние правки
 * (кэш Firestore только в памяти — оборванная запись пропала бы). Не дольше
 * 4 с: без сети ждать бесконечно нельзя.
 */
let reloading = false;
async function reloadSafely() {
  if (reloading) return;
  reloading = true;
  try {
    // История копится пачкой в памяти — её надо поставить в очередь ДО
    // ожидания, иначе перезагрузка унесёт последние записи журнала.
    void flushHistory();
    const writes = Promise.all([db ? waitForPendingWrites(db) : Promise.resolve(), sbWaitForPendingWrites()]);
    await Promise.race([writes, new Promise((resolve) => setTimeout(resolve, 4000))]);
  } catch {
    /* всё равно перезагружаем */
  }
  window.location.reload();
}

/** Человек сейчас что-то вводит или у него открыт диалог — не выдёргиваем страницу из-под рук. */
function userIsBusy(): boolean {
  const el = document.activeElement as HTMLElement | null;
  const typing =
    Boolean(el) && (el!.tagName === "INPUT" || el!.tagName === "TEXTAREA" || el!.tagName === "SELECT" || el!.isContentEditable);
  return typing || Boolean(document.querySelector('[role="dialog"], [role="alertdialog"]'));
}

let scheduled = false;
function scheduleForcedReload(reason: "owner") {
  if (scheduled || reloading) return;
  scheduled = true;
  if (document.visibilityState !== "visible") {
    // Свёрнутая вкладка: обновим, когда на неё вернутся, — брошенные фоновые
    // вкладки иначе перечитывали бы всё впустую.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      document.removeEventListener("visibilitychange", onVisible);
      void reloadSafely();
    };
    document.addEventListener("visibilitychange", onVisible);
    return;
  }
  toast(reason === "owner" ? "Owner обновляет сайт у всех" : "Обновление сайта", {
    id: TOAST_ID,
    description: "Страница обновится через 30 секунд.",
    duration: Infinity,
    action: { label: "Обновить сейчас", onClick: () => void reloadSafely() },
  });
  const startedAt = Date.now();
  const attempt = () => {
    if (reloading) return;
    // Ушёл с вкладки во время отсчёта — дождёмся, пока вернётся.
    if (document.visibilityState !== "visible") {
      const onVisible = () => {
        if (document.visibilityState !== "visible") return;
        document.removeEventListener("visibilitychange", onVisible);
        void reloadSafely();
      };
      document.addEventListener("visibilitychange", onVisible);
      return;
    }
    if (userIsBusy() && Date.now() - startedAt < COUNTDOWN_MS + MAX_WAIT_BUSY_MS) {
      window.setTimeout(attempt, 5000);
      return;
    }
    void reloadSafely();
  };
  window.setTimeout(attempt, COUNTDOWN_MS);
}

async function latestEntry(): Promise<string | null> {
  const res = await fetch(`/index.html?check=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return null;
  const html = await res.text();
  return html.match(/\/assets\/index-[\w-]+\.js/)?.[0] ?? null;
}

export function useAppUpdateCheck() {
  const { activeWorkspace } = useWorkspace();
  const epochBaselineRef = useRef<{ workspaceId: string; epoch: number } | null>(null);

  useEffect(() => {
    // После деплоя старые файлы с хостинга пропадают: вкладка на старом коде
    // при переходе в ещё не открытый раздел не может его загрузить. Вместо
    // экрана ошибки — одна перезагрузка (не чаще раза в минуту — без петли).
    const onPreloadError = (event: Event) => {
      try {
        const last = Number(sessionStorage.getItem(PRELOAD_RELOAD_KEY) ?? 0);
        if (Date.now() - last < 60_000) return;
        sessionStorage.setItem(PRELOAD_RELOAD_KEY, String(Date.now()));
      } catch {
        /* без sessionStorage — всё равно пробуем один раз */
      }
      event.preventDefault();
      void reloadSafely();
    };
    window.addEventListener("vite:preloadError", onPreloadError);
    return () => window.removeEventListener("vite:preloadError", onPreloadError);
  }, []);

  useEffect(() => {
    // В разработке бандла с хешем нет — сравнивать не с чем.
    const loaded = currentEntry();
    if (!loaded) return;
    let lastCheck = 0;
    let cancelled = false;
    /** Новая версия на хостинге и когда её увидели (новая версия — отсчёт заново). */
    let pending: { entry: string; seenAt: number } | null = null;
    let lastInputAt = Date.now();
    let visibleSince = document.visibilityState === "visible" ? Date.now() : 0;
    let snoozedUntil = 0;
    /** Идёт тост «Обновляю через 10 с»: когда показан. */
    let noticeAt = 0;
    /** Какой тост-предложение сейчас висит (чтобы не перерисовывать его каждые 5 с). */
    let offered: "quota" | "auto" | null = null;

    const offer = (quota: boolean) => {
      if (offered === (quota ? "quota" : "auto")) return;
      offered = quota ? "quota" : "auto";
      toast("Вышла новая версия Nova", {
        id: TOAST_ID,
        description: quota
          ? "База сейчас не принимает запросы — обновите страницу, когда она заработает."
          : "Страница обновится сама, когда вы отвлечётесь.",
        duration: Infinity,
        action: { label: "Обновить сейчас", onClick: () => void reloadSafely() },
      });
    };

    const autoReload = () => {
      markAutoReload();
      void reloadSafely();
    };

    /** Можно ли сейчас обновиться самим (без учёта «человек отвлёкся»). */
    const allowed = (now: number) =>
      pending !== null && !dbQuotaHit() && now - lastAutoReloadAt() >= AUTO_COOLDOWN_MS && now >= snoozedUntil;

    const snooze = () => {
      if (!noticeAt) return;
      snoozedUntil = Date.now() + SNOOZE_MS;
      noticeAt = 0;
    };

    const evaluate = () => {
      if (cancelled || reloading || scheduled || !pending) return;
      const now = Date.now();
      if (dbQuotaHit()) {
        offer(true);
        return;
      }
      offer(false);
      if (document.visibilityState !== "visible") return;
      if (noticeAt) {
        // Тост «Обновляю…» висит: коснулись — отмена, дождались — обновляем.
        if (lastInputAt > noticeAt || userIsBusy()) {
          noticeAt = 0;
          offered = null;
          offer(false);
          return;
        }
        if (now - noticeAt >= AUTO_NOTICE_MS && allowed(now)) autoReload();
        return;
      }
      if (!allowed(now) || now - pending.seenAt < SETTLE_MS) return;
      if (now - lastInputAt < IDLE_MS || userIsBusy()) return;
      noticeAt = now;
      offered = null;
      toast("Обновляю страницу до новой версии", {
        id: TOAST_ID,
        description: "Через 10 секунд. Любое касание — отмена.",
        duration: AUTO_NOTICE_MS + 5_000,
        action: { label: "Обновить", onClick: () => void autoReload() },
        cancel: { label: "Позже", onClick: snooze },
        onDismiss: snooze,
      });
    };

    const check = async (returning = false) => {
      if (cancelled || document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastCheck < MIN_GAP_MS && !returning) return;
      lastCheck = now;
      try {
        const latest = await latestEntry();
        if (cancelled || !latest || latest === loaded) return;
        if (pending?.entry !== latest) pending = { entry: latest, seenAt: Date.now() };
        // Вернулись на вкладку, а там уже новая версия: обновляем сразу,
        // пока человек ничего не начал делать, — перезагрузка посреди его
        // работы потом была бы хуже мигания экрана сейчас.
        // Только после настоящей отлучки (минута без касаний): alt-tab на
        // пару секунд посреди работы — не повод перезагружать.
        const idleNow = Date.now();
        if (returning && lastInputAt < visibleSince && idleNow - lastInputAt >= IDLE_MS && allowed(idleNow) && !userIsBusy()) {
          autoReload();
          return;
        }
        evaluate();
      } catch {
        /* нет сети — проверим в следующий раз */
      }
    };

    const onInput = () => {
      lastInputAt = Date.now();
    };
    const inputEvents = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const type of inputEvents) window.addEventListener(type, onInput, { capture: true, passive: true });

    const interval = window.setInterval(() => void check(), CHECK_EVERY_MS);
    const tick = window.setInterval(evaluate, TICK_MS);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const returning = !visibleSince;
      if (returning) visibleSince = Date.now();
      void check(returning);
    };
    const onHidden = () => {
      if (document.visibilityState === "visible") return;
      visibleSince = 0;
      noticeAt = 0;
    };
    const onVisibility = () => {
      onHidden();
      onVisible();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.clearInterval(tick);
      for (const type of inputEvents) window.removeEventListener(type, onInput, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  // «Обновить сайт у всех» (Owner): эпоха выросла после загрузки вкладки.
  useEffect(() => {
    if (!activeWorkspace) return;
    const epoch = activeWorkspace.reloadEpoch ?? 0;
    const base = epochBaselineRef.current;
    if (!base || base.workspaceId !== activeWorkspace.id) {
      epochBaselineRef.current = { workspaceId: activeWorkspace.id, epoch };
      return;
    }
    if (epoch > base.epoch) {
      epochBaselineRef.current = { workspaceId: activeWorkspace.id, epoch };
      scheduleForcedReload("owner");
    }
  }, [activeWorkspace]);

}
