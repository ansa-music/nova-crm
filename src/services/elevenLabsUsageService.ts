import { parseElevenLabsSubscription, type ElevenLabsUsage } from "@/utils/grokUsage";

/**
 * Использование ElevenLabs напрямую — единственный из сервисов «Грок
 * лимита» с официальным endpoint, который отвечает браузеру (CORS `*`,
 * проверено 25.09.2026): `GET https://api.elevenlabs.io/v1/user/subscription`
 * с заголовком `xi-api-key`. Ключ лежит в документе аккаунта рядом с
 * паролем (`GrokAppAccount.apiKey`) — заводить его с одним правом
 * «User: Read».
 *
 * Запрос идёт из браузера того, кто открыл страницу; результат помнится 10
 * минут на вкладку (модуль + sessionStorage), чтобы каждое открытие
 * страницы не било в чужой сервис. «Обновить» — мимо памяти.
 */
export type ElevenLabsUsageState =
  | { kind: "ok"; usage: ElevenLabsUsage; fetchedAt: number }
  | { kind: "error"; message: string; fetchedAt: number };

const ENDPOINT = "https://api.elevenlabs.io/v1/user/subscription";
const TTL_MS = 10 * 60 * 1000;
const memory = new Map<string, ElevenLabsUsageState & { keyMark: string }>();
const inflight = new Map<string, Promise<ElevenLabsUsageState>>();

const storageKey = (accountId: string) => `nova:11labs-usage:${accountId}`;

/** Отпечаток ключа, чтобы смена ключа не отдавала старый ответ (сам ключ в память не кладём). */
function keyMarkOf(apiKey: string): string {
  return `${apiKey.length}:${apiKey.slice(-4)}`;
}

function readStored(accountId: string, keyMark: string): (ElevenLabsUsageState & { keyMark: string }) | null {
  try {
    const raw = sessionStorage.getItem(storageKey(accountId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ElevenLabsUsageState & { keyMark: string };
    if (parsed.keyMark !== keyMark || typeof parsed.fetchedAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function store(accountId: string, state: ElevenLabsUsageState & { keyMark: string }) {
  memory.set(accountId, state);
  try {
    sessionStorage.setItem(storageKey(accountId), JSON.stringify(state));
  } catch {
    /* sessionStorage недоступен — хватит памяти модуля */
  }
}

export function cachedElevenLabsUsage(accountId: string, apiKey: string, now = Date.now()): ElevenLabsUsageState | null {
  const keyMark = keyMarkOf(apiKey);
  const hit = memory.get(accountId) ?? readStored(accountId, keyMark);
  if (!hit || hit.keyMark !== keyMark) return null;
  if (now - hit.fetchedAt > TTL_MS) return null;
  return hit;
}

/** Текст ошибки, понятный человеку, без ключа и без адреса. */
function describeFailure(status: number): string {
  if (status === 401 || status === 403) return "ключ не подошёл";
  if (status === 429) return "ElevenLabs просит подождать";
  if (status >= 500) return "ElevenLabs не отвечает";
  return `ElevenLabs ответил ${status}`;
}

export async function fetchElevenLabsUsage(
  accountId: string,
  apiKey: string,
  options: { force?: boolean } = {}
): Promise<ElevenLabsUsageState> {
  const key = apiKey.trim();
  const keyMark = keyMarkOf(key);
  if (!options.force) {
    const cached = cachedElevenLabsUsage(accountId, key);
    if (cached) return cached;
  }
  const running = inflight.get(accountId);
  if (running && !options.force) return running;
  const task = (async (): Promise<ElevenLabsUsageState> => {
    const fetchedAt = Date.now();
    let state: ElevenLabsUsageState;
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 12_000);
      let response: Response;
      try {
        response = await fetch(ENDPOINT, { headers: { "xi-api-key": key, accept: "application/json" }, signal: controller.signal });
      } finally {
        window.clearTimeout(timer);
      }
      if (!response.ok) {
        state = { kind: "error", message: describeFailure(response.status), fetchedAt };
      } else {
        const usage = parseElevenLabsSubscription(await response.json());
        state = usage ? { kind: "ok", usage, fetchedAt } : { kind: "error", message: "непонятный ответ ElevenLabs", fetchedAt };
      }
    } catch {
      state = { kind: "error", message: "не удалось проверить (сеть)", fetchedAt };
    }
    store(accountId, { ...state, keyMark });
    return state;
  })();
  inflight.set(accountId, task);
  try {
    return await task;
  } finally {
    if (inflight.get(accountId) === task) inflight.delete(accountId);
  }
}
