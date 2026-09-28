import { useSyncExternalStore } from "react";
import { TelegramClient } from "@mtcute/web";
import { buildInputMedia } from "@/services/telegram/tgMedia";
import { tgErrorText, type TgUpload } from "@/services/telegram/tgClient";
import { callTgEdge, TgEdgeError } from "@/services/telegram/tgServer";
import { setTgUploadsPulse } from "@/services/telegram/tgUploadsPulse";

/**
 * Файлы от технаря клиенту (просьба Nurba 28.09.2026: «технарь не может
 * прикреплять файлы»). Своего входа в Telegram у технаря нет, а видео по
 * 250 МБ – 2 ГБ через функцию Supabase не провезти (150 МБ памяти, 150 с на
 * вызов, 5 ГБ трафика в месяц). Поэтому:
 *   1. `tech_upload_begin` — функция проверяет разрешение на чат и отдаёт
 *      вход служебного бота и метку;
 *   2. браузер входит БОТОМ (mtcute, база `nova-tg-bot:{ws}:{uid}`) и сам
 *      загружает файл в Telegram — в скрытую группу «аккаунт + бот», подпись
 *      `nova:{метка}`; бот через MTProto принимает до 2000 МБ;
 *   3. `tech_upload_finish` — функция главным входом отправляет клиенту тот
 *      же документ (без повторной загрузки) и убирает его из группы.
 * Бот клиентам не пишет и чатов аккаунта не видит; кому отправить, решает
 * то же разрешение ОС, что и для текста.
 *
 * Отправки идут по одной (Web Locks на браузер: база входа бота одна, а
 * один ключ с двух соединений Telegram отвергает); уход на другую страницу
 * Nova их не прерывает — прогресс виден пилюлей в каркасе.
 */

/** Предел файла у бота: без Premium, 2000 МБ. */
export const TECH_FILE_MAX = 2000 * 1024 * 1024;

interface Begin {
  apiId: number;
  apiHash: string;
  botToken: string;
  botId: string;
  courierChatId: number;
  marker: string;
  maxBytes?: number;
}

export interface TechUploadInput {
  workspaceId: string;
  uid: string;
  chatId: number;
  chatTitle: string;
  file: File;
  caption?: string;
  asDocument?: boolean;
}

let uploads: TgUpload[] = [];
const listeners = new Set<() => void>();
const controllers = new Map<string, AbortController>();
/** Что нужно для «Повторить»: сам файл и метка, если он уже в Telegram. */
const retries = new Map<string, { input: TechUploadInput; marker: string | null }>();

function emit() {
  listeners.forEach((fn) => fn());
  const active = uploads.filter((u) => u.status === "uploading");
  const total = active.reduce((n, u) => n + u.size, 0);
  const sent = active.reduce((n, u) => n + u.sent, 0);
  setTgUploadsPulse({ active: active.length, progress: total > 0 ? sent / total : 0, chatId: active[0]?.chatId ?? null });
}

function patch(id: string, next: Partial<TgUpload>) {
  uploads = uploads.map((u) => (u.id === id ? { ...u, ...next } : u));
  emit();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Отправки технаря (все чаты) — экран сам берёт свои. */
export function useTechUploads(): TgUpload[] {
  return useSyncExternalStore(subscribe, () => uploads);
}

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (!uploads.some((u) => u.status === "uploading")) return;
  e.preventDefault();
  e.returnValue = "";
}
if (typeof window !== "undefined") window.addEventListener("beforeunload", onBeforeUnload);

function rpcText(error: unknown): string {
  return String((error as { text?: unknown })?.text ?? "");
}

function errorText(error: unknown): string {
  if (error instanceof TgEdgeError) return error.message;
  const text = rpcText(error);
  if (text === "FILE_PARTS_INVALID" || text === "FILE_PART_TOO_BIG") return "Файл больше 2 ГБ — через бота он не уйдёт, отправьте его через ОС";
  return tgErrorText(error, "Файл не отправился");
}

/** Одна отправка за раз на браузер: база входа бота одна на всех вкладках. */
function withBotLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (!locks?.request) return fn();
  return locks.request(name, () => fn()) as Promise<T>;
}

async function deleteDb(name: string) {
  await new Promise<void>((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Вход бота в этом браузере устарел или это другой бот — войти заново. */
class StaleBotSession extends Error {}
const STALE_CODES = new Set(["AUTH_KEY_UNREGISTERED", "AUTH_KEY_INVALID", "SESSION_REVOKED", "SESSION_EXPIRED", "USER_DEACTIVATED"]);

function botStorageName(workspaceId: string, uid: string) {
  return `nova-tg-bot:${workspaceId}:${uid}`;
}

/** Загрузить файл ботом в группу-курьер. Прогресс — в байтах. */
async function uploadViaBot(input: TechUploadInput, begin: Begin, signal: AbortSignal, onProgress: (sent: number) => void) {
  const storage = botStorageName(input.workspaceId, input.uid);
  const attempt = async () => {
    const client = new TelegramClient({
      apiId: begin.apiId,
      apiHash: begin.apiHash,
      storage,
      disableUpdates: true,
      initConnectionOptions: {
        deviceModel: "Nova · файлы технаря",
        systemVersion: "Web",
        appVersion: "Nova CRM",
        langCode: "ru",
        systemLangCode: "ru",
      },
      logLevel: 1,
    });
    try {
      const me = await client.start({ botToken: begin.botToken });
      if (String(me.id) !== begin.botId) throw new StaleBotSession("другой бот");
      const media = await buildInputMedia(input.file, { caption: `nova:${begin.marker}`, asDocument: input.asDocument });
      let last = 0;
      await client.sendMedia({ _: "inputPeerChat", chatId: begin.courierChatId }, media, {
        abortSignal: signal,
        progressCallback: (uploaded) => {
          const now = Date.now();
          if (now - last < 250 && uploaded < input.file.size) return;
          last = now;
          onProgress(uploaded);
        },
      });
    } catch (error) {
      if (!signal.aborted && STALE_CODES.has(rpcText(error))) throw new StaleBotSession(rpcText(error));
      throw error;
    } finally {
      await client.destroy().catch(() => undefined);
    }
  };
  try {
    await attempt();
  } catch (error) {
    if (!(error instanceof StaleBotSession) || signal.aborted) throw error;
    // Owner сменил бота или токен — прежний вход в этом браузере не годится.
    await deleteDb(storage);
    await attempt();
  }
}

const RETRY_CODES = new Set(["busy", "network"]);

/** Передать клиенту: занятость аккаунта и обрыв связи — ещё раз через 2 с. */
async function finish(input: TechUploadInput, marker: string) {
  for (let i = 0; ; i++) {
    try {
      await callTgEdge(input.workspaceId, "tech_upload_finish", { chatId: input.chatId, marker, caption: input.caption?.trim() || "" });
      return;
    } catch (error) {
      if (i >= 2 || !(error instanceof TgEdgeError) || !RETRY_CODES.has(error.code)) throw error;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function run(id: string, input: TechUploadInput, controller: AbortController, uploadedMarker: string | null) {
  let marker = uploadedMarker;
  try {
    await withBotLock(`nova-tg-bot-lock:${input.workspaceId}:${input.uid}`, async () => {
      if (controller.signal.aborted) throw new DOMException("Отменено", "AbortError");
      if (!marker) {
        patch(id, { phase: "prepare", startedAt: Date.now(), sent: 0 });
        const begin = await callTgEdge<Begin>(input.workspaceId, "tech_upload_begin", { chatId: input.chatId });
        if (input.file.size > (begin.maxBytes ?? TECH_FILE_MAX)) throw new Error("Файл больше 2 ГБ — через бота он не уйдёт, отправьте его через ОС");
        await uploadViaBot(input, begin, controller.signal, (sent) => patch(id, { sent, phase: "upload" }));
        marker = begin.marker;
      }
      patch(id, { sent: input.file.size, phase: "deliver" });
      await finish(input, marker);
    });
    patch(id, { status: "done", phase: undefined, canRetry: false });
    retries.delete(id);
  } catch (error) {
    if (controller.signal.aborted && !marker) {
      patch(id, { status: "cancelled", phase: undefined });
      retries.delete(id);
      return;
    }
    retries.set(id, { input, marker });
    patch(id, { status: "error", phase: undefined, error: errorText(error), canRetry: true });
  } finally {
    controllers.delete(id);
  }
}

/** Отправить файл клиенту из разрешённого чата. Ошибка — в строке отправки. */
export function startTechUpload(input: TechUploadInput): string {
  if (input.file.size > TECH_FILE_MAX) throw new Error("Файл больше 2 ГБ — через бота он не уйдёт, отправьте его через ОС");
  const id = `tup_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const controller = new AbortController();
  controllers.set(id, controller);
  const upload: TgUpload = {
    id,
    chatId: input.chatId,
    chatTitle: input.chatTitle,
    fileName: input.file.name,
    size: input.file.size,
    sent: 0,
    startedAt: Date.now(),
    status: "uploading",
    error: null,
    phase: "queued",
  };
  uploads = [...uploads.filter((u) => u.status === "uploading" || Date.now() - u.startedAt < 10 * 60_000), upload];
  emit();
  void run(id, input, controller, null);
  return id;
}

/** Отменить можно, пока файл грузится; передачу клиенту — уже нет. */
export function cancelTechUpload(id: string) {
  const u = uploads.find((x) => x.id === id);
  if (u?.phase === "deliver") return;
  controllers.get(id)?.abort();
}

/** Ещё раз: уже загруженный файл — сразу клиенту, иначе загрузка заново. */
export function retryTechUpload(id: string) {
  const saved = retries.get(id);
  if (!saved) return;
  const controller = new AbortController();
  controllers.set(id, controller);
  patch(id, { status: "uploading", error: null, canRetry: false, phase: saved.marker ? "deliver" : "queued", startedAt: Date.now() });
  void run(id, saved.input, controller, saved.marker);
}

export function dismissTechUpload(id: string) {
  retries.delete(id);
  uploads = uploads.filter((u) => u.id !== id || u.status === "uploading");
  emit();
}
