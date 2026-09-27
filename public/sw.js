/*
 * Nova CRM — сервис-воркер приложения (установка на телефон/компьютер без
 * Google Play и App Store). Намеренно минимальный:
 *
 *  - страницы (навигация) — ВСЕГДА из сети, без кэша HTTP; нет сети — последняя
 *    сохранённая оболочка index.html, чтобы приложение открылось, а не показало
 *    динозавра. Проверка новой версии (useAppUpdateCheck) читает index.html
 *    обычным fetch — его воркер НЕ трогает, так что автообновление как было;
 *  - /assets/* (файлы с хешем в имени, не меняются) — из кэша, иначе из сети и в
 *    кэш: повторный запуск приложения мгновенный, а старые куски после деплоя не
 *    пропадают у вкладок на старом коде. Кэш подрезается до ASSET_LIMIT;
 *  - всё остальное (status.json, база Firestore/Supabase, шрифты, другие сайты) —
 *    мимо воркера, как без него.
 *
 * Меняя этот файл, поднимайте VERSION: так старые кэши уберутся.
 */
const VERSION = "v1";
const SHELL_CACHE = `nova-shell-${VERSION}`;
const ASSET_CACHE = `nova-assets-${VERSION}`;
const ASSET_LIMIT = 400;
const SHELL_URLS = ["/index.html", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/logo.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS.map((url) => new Request(url, { cache: "no-store" }))))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("nova-") && k !== SHELL_CACHE && k !== ASSET_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trimAssets() {
  const cache = await caches.open(ASSET_CACHE);
  const keys = await cache.keys();
  const extra = keys.length - ASSET_LIMIT;
  for (let i = 0; i < extra; i++) await cache.delete(keys[i]);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Служебные адреса Firebase Hosting (/__/auth, /__/firebase) — как без воркера.
  if (url.pathname.startsWith("/__/")) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req, { cache: "no-store" })
        .then((res) => {
          const html = (res.headers.get("content-type") || "").includes("text/html");
          if (res.ok && res.type === "basic" && !res.redirected && html) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put("/index.html", copy)).catch(() => undefined);
          }
          return res;
        })
        .catch(() => caches.match("/index.html").then((hit) => hit || Response.error()))
    );
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.open(ASSET_CACHE).then((cache) =>
        cache.match(req).then(
          (hit) =>
            hit ||
            fetch(req).then((res) => {
              if (res.ok && res.type === "basic") {
                cache.put(req, res.clone()).then(trimAssets).catch(() => undefined);
              }
              return res;
            })
        )
      )
    );
  }
});

/* Нажатие на уведомление, показанное через воркер (iPhone в приложении
   показывает всплывашки только так), — открыть или поднять окно Nova. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          // Переход — роутером самой страницы (без перезагрузки и без потери
          // несохранённого): она слушает это сообщение (utils/pwa.ts).
          client.postMessage({ type: "nova:notify-open", href: target });
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
