import { useEffect, useRef } from "react";
import { waitForPendingWrites } from "firebase/firestore";
import { toast } from "@/components/ui/sonner";
import { db } from "@/firebase/firebase";
import { flushHistory } from "@/services/historyService";
import { useWorkspace } from "@/hooks/useWorkspace";

/**
 * ПРИНУДИТЕЛЬНОЕ обновление сайта у всех. Сайт — одностраничное приложение:
 * вкладку не перезагружают днями, и после деплоя человек продолжает работать
 * на СТАРОМ коде (так новый звук заказа «не работал», а экономия квоты Spark
 * не доходила до открытых вкладок).
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
 * Новая версия — только тост «Обновить» (сама не перезагружает: каждая
 * перезагрузка заново читает все подписки, ~340 чтений на вкладку, и волна
 * после каждого деплоя съедала квоту Spark). ПРИНУДИТЕЛЬНО — по кнопке Owner:
 * вкладка на виду — через 30 с с тостом «Обновить сейчас», человек печатает
 * или открыт диалог — ждём, но не дольше 2 минут; свёрнутая — когда на неё
 * вернутся (брошенные фоновые вкладки не перечитывают всё впустую).
 * Перед перезагрузкой ждём, пока уйдут на сервер последние правки
 * (`reloadSafely`).
 */

const CHECK_EVERY_MS = 2 * 60_000;
const MIN_GAP_MS = 30_000;
const COUNTDOWN_MS = 30_000;
const MAX_WAIT_BUSY_MS = 2 * 60_000;
const TOAST_ID = "nova-app-update";
const PRELOAD_RELOAD_KEY = "nova:preload-reload-at";


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
    if (db) await Promise.race([waitForPendingWrites(db), new Promise((resolve) => setTimeout(resolve, 4000))]);
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
function scheduleForcedReload(reason: "deploy" | "owner") {
  if (scheduled || reloading) return;
  // Новая версия — только ПРЕДЛАГАЕМ обновиться. Сама по каждому деплою
  // перезагрузка стоила ~8 500 чтений на деплой (каждая вкладка заново читает
  // все подписки), а деплоев бывает по 20 в день — аудит квоты 22.09.2026
  // поставил это первым пунктом. Принудительно — только кнопкой Owner.
  if (reason === "deploy") {
    toast("Вышла новая версия Nova", {
      id: TOAST_ID,
      description: "Обновите страницу, когда будет удобно.",
      duration: Infinity,
      action: { label: "Обновить", onClick: () => void reloadSafely() },
    });
    return;
  }
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
  toast(reason === "owner" ? "Owner обновляет сайт у всех" : "Вышла новая версия Nova", {
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
  const updateReadyRef = useRef(false);
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

    const check = async () => {
      if (cancelled || updateReadyRef.current || document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastCheck < MIN_GAP_MS) return;
      lastCheck = now;
      try {
        const latest = await latestEntry();
        if (cancelled || !latest || latest === loaded) return;
        updateReadyRef.current = true;
        scheduleForcedReload("deploy");
      } catch {
        /* нет сети — проверим в следующий раз */
      }
    };

    const interval = window.setInterval(() => void check(), CHECK_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
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
