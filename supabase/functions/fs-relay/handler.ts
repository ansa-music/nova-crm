/**
 * Резервный канал к Firestore: пересылает запросы SDK на firestore.googleapis.com.
 *
 * Зачем. 22.09.2026 весь узел Google, куда Казахтелеком резолвит
 * firestore.googleapis.com, открывал сессию WebChannel, а обратный канал
 * отвечал «400 Unknown SID» — приложение вечно висело на «Загружаем профиль…».
 * Браузер не выбирает, в какой узел Google идти, а эта функция работает в
 * дата-центре Supabase, откуда DNS даёт другой, рабочий узел.
 *
 * Что пропускает — только то, что шлёт SDK Firestore этого проекта:
 *   /google.firestore.v1.Firestore/{Listen|Write}/channel  (WebChannel)
 *   /v1/projects/nurba-6e70d/databases/…                   (разовые RPC: commit, runQuery…)
 * Прав функция НЕ добавляет: токен пользователя идёт насквозь, и Google
 * проверяет его и правила Firestore так же, как при прямом запросе.
 *
 * Файл без Deno-специфики: `index.ts` отдаёт его в `Deno.serve`, а локальная
 * проверка гоняет тот же обработчик в Node с узлом Google, закреплённым вручную.
 */

const UPSTREAM_ORIGIN = "https://firestore.googleapis.com";
const PROJECT_ID = "nurba-6e70d";

const APP_ORIGINS = new Set(["https://nurba-6e70d.web.app", "https://nurba-6e70d.firebaseapp.com"]);
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const CHANNEL_PATH = /^\/google\.firestore\.v1\.Firestore\/(Listen|Write)\/channel$/;
const CHANNEL_MARKER = "/google.firestore.v1.Firestore/";
const REST_PREFIX = `/v1/projects/${PROJECT_ID}/databases/`;

/** Заголовки запроса, которые SDK реально шлёт и без которых Google ответит иначе. */
const FORWARD_REQUEST_HEADERS = [
  "content-type",
  "authorization",
  "x-goog-api-client",
  "x-firebase-gmpid",
  "x-firebase-appcheck",
  "x-goog-request-params",
  "google-cloud-resource-prefix",
];

/** Заголовки ответа, которые читает SDK (id сессии WebChannel — обязательно). */
const FORWARD_RESPONSE_HEADERS = ["content-type", "x-http-session-id", "x-client-wire-protocol"];

type FetchUpstream = (url: string, init: RequestInit) => Promise<Response>;

function isAllowedOrigin(origin: string | null): origin is string {
  return Boolean(origin) && (APP_ORIGINS.has(origin as string) || LOCAL_ORIGIN.test(origin as string));
}

/**
 * Хвост пути после префикса функции. Supabase отдаёт функции путь вида
 * `/fs-relay/<хвост>` (а в локальной проверке — просто `/<хвост>`), поэтому
 * ищем известный маркер, а не отрезаем фиксированный префикс.
 */
export function upstreamPath(pathname: string): string | null {
  const channelAt = pathname.indexOf(CHANNEL_MARKER);
  if (channelAt >= 0) {
    const tail = pathname.slice(channelAt);
    return CHANNEL_PATH.test(tail) ? tail : null;
  }
  const restAt = pathname.indexOf(REST_PREFIX);
  if (restAt >= 0) {
    const tail = pathname.slice(restAt);
    // «..» в пути не пускаем — не даём выйти за пределы своего проекта.
    return tail.includes("..") ? null : tail;
  }
  return null;
}

function corsHeaders(origin: string): Headers {
  const headers = new Headers();
  headers.set("access-control-allow-origin", origin);
  // WebChannel ходит кросс-доменным XHR с withCredentials — без этого браузер
  // выбросит ответ, даже если он 200.
  headers.set("access-control-allow-credentials", "true");
  headers.set("access-control-expose-headers", "x-http-session-id, x-client-wire-protocol");
  headers.set("vary", "Origin");
  return headers;
}

function textResponse(status: number, text: string, headers = new Headers()): Response {
  headers.set("content-type", "text/plain; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(text, { status, headers });
}

export function createRelayHandler(fetchUpstream: FetchUpstream) {
  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const origin = req.headers.get("origin");

    // Своих клиентов вне браузера у канала нет: без разрешённого Origin — отказ.
    // Подделать Origin можно, но прав это не даёт — см. шапку файла.
    if (!isAllowedOrigin(origin)) return textResponse(403, "origin not allowed");
    const cors = corsHeaders(origin);

    if (req.method === "OPTIONS") {
      const requested = (req.headers.get("access-control-request-headers") ?? "")
        .split(",")
        .map((h) => h.trim().toLowerCase())
        .filter((h) => FORWARD_REQUEST_HEADERS.includes(h));
      cors.set("access-control-allow-methods", "GET, POST, OPTIONS");
      if (requested.length) cors.set("access-control-allow-headers", requested.join(", "));
      cors.set("access-control-max-age", "86400");
      // Проверка с боевого домена через локальный канал: Chrome спрашивает
      // разрешение на запрос из публичной сети в локальную.
      if (req.headers.get("access-control-request-private-network") === "true") {
        cors.set("access-control-allow-private-network", "true");
      }
      return new Response(null, { status: 204, headers: cors });
    }

    if (req.method !== "GET" && req.method !== "POST") return textResponse(405, "method not allowed", cors);

    const path = upstreamPath(url.pathname);
    if (!path) return textResponse(404, "not found", cors);
    if (CHANNEL_PATH.test(path)) {
      // Сессия WebChannel несёт базу в параметре, а не в пути — чужую не пускаем.
      const database = url.searchParams.get("database") ?? "";
      if (!database.startsWith(`projects/${PROJECT_ID}/databases/`)) {
        return textResponse(400, "foreign database", cors);
      }
    }

    const headers = new Headers();
    for (const name of FORWARD_REQUEST_HEADERS) {
      const value = req.headers.get(name);
      if (value !== null) headers.set(name, value);
    }

    let upstream: Response;
    try {
      upstream = await fetchUpstream(`${UPSTREAM_ORIGIN}${path}${url.search}`, {
        method: req.method,
        headers,
        body: req.method === "POST" ? await req.arrayBuffer() : undefined,
        redirect: "manual",
        // Клиент ушёл — рвём и поток к Google, иначе он висел бы до таймаута.
        signal: req.signal,
      });
    } catch {
      return textResponse(502, "upstream unreachable", cors);
    }

    for (const name of FORWARD_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value !== null) cors.set(name, value);
    }
    cors.set("cache-control", "no-store");
    // Тело отдаём потоком как есть: обратный канал WebChannel — это долгий
    // ответ, который приходит кусками.
    return new Response(upstream.body, { status: upstream.status, headers: cors });
  };
}
