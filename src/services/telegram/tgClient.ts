import { InputMedia, TelegramClient, type Dialog, type Message, type Peer } from "@mtcute/web";
import { setTgUploadsPulse } from "@/services/telegram/tgUploadsPulse";
import { writeTelegramSessionMark, type TelegramConfig } from "@/services/telegram/telegramAccess";

/**
 * Клиент Telegram внутри Nova (26.09.2026) на открытой библиотеке mtcute:
 * браузер сам подключается к серверам Telegram (WebSocket), переписка и
 * файлы живут в Telegram, через Supabase и Firebase ничего не идёт.
 *
 * Модуль грузится только в разделе «Telegram» (и для автовыхода). Клиент —
 * один на вкладку и живёт, пока открыта вкладка: уход на другую страницу
 * Nova не рвёт ни соединение, ни отправку файла.
 *
 * Вход — один раз на браузер: ключ сессии mtcute хранит в IndexedDB
 * (база `nova-tg:{ws}:{uid}`). В списке устройств Telegram вход подписан
 * «Nova · Имя». Выход кнопкой или автовыход при снятии доступа завершает
 * сессию на сервере Telegram и стирает базу.
 */

// ---------------------------------------------------------------------
// Модель для экрана.
// ---------------------------------------------------------------------

export interface TgMe {
  id: number;
  name: string;
  username: string | null;
  isPremium: boolean;
}

export type TgAuth =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "signedOut" }
  | { kind: "qr"; url: string; expires: number }
  | { kind: "qrScanned" }
  | { kind: "code"; phone: string; via: string }
  | { kind: "password"; hint: string | null; error: string | null }
  | { kind: "ready"; me: TgMe }
  | { kind: "error"; message: string };

export interface TgMedia {
  type: string;
  fileName: string | null;
  fileSize: number | null;
  mimeType: string | null;
  duration: number | null;
  emoji: string | null;
}

export interface TgMessage {
  id: number;
  chatId: number;
  date: number;
  out: boolean;
  text: string;
  senderName: string;
  media: TgMedia | null;
  edited: boolean;
}

export interface TgDialog {
  id: number;
  title: string;
  username: string | null;
  isUser: boolean;
  lastText: string;
  lastAt: number;
  lastOut: boolean;
  lastId: number;
  unread: number;
  pinned: boolean;
  /** Мои сообщения прочитаны до этого id (галочки). */
  readOutboxMaxId: number;
}

export interface TgChatCache {
  messages: TgMessage[];
  loading: boolean;
  hasMore: boolean;
  error: string | null;
}

export interface TgUpload {
  id: string;
  chatId: number;
  chatTitle: string;
  fileName: string;
  size: number;
  sent: number;
  startedAt: number;
  status: "uploading" | "done" | "error" | "cancelled";
  error: string | null;
}

export interface TgState {
  auth: TgAuth;
  dialogs: TgDialog[];
  dialogsLoaded: boolean;
  dialogsError: string | null;
  chats: Record<number, TgChatCache>;
  uploads: TgUpload[];
}

const INITIAL: TgState = { auth: { kind: "idle" }, dialogs: [], dialogsLoaded: false, dialogsError: null, chats: {}, uploads: [] };
let state: TgState = INITIAL;
const listeners = new Set<() => void>();

function set(next: Partial<TgState>) {
  state = { ...state, ...next };
  listeners.forEach((fn) => fn());
  if (next.uploads) publishPulse();
}

export function tgState(): TgState {
  return state;
}

export function subscribeTg(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// ---------------------------------------------------------------------
// Ошибки.
// ---------------------------------------------------------------------

function rpcText(error: unknown): string {
  return String((error as { text?: unknown })?.text ?? "");
}

const ERROR_TEXT: Record<string, string> = {
  PHONE_NUMBER_INVALID: "Неверный номер телефона",
  PHONE_CODE_INVALID: "Неверный код",
  PHONE_CODE_EXPIRED: "Код устарел — запросите новый",
  PASSWORD_HASH_INVALID: "Неверный облачный пароль",
  PHONE_NUMBER_BANNED: "Номер заблокирован в Telegram",
  PHONE_NUMBER_UNOCCUPIED: "На этот номер нет аккаунта Telegram",
  API_ID_INVALID: "Ключи api_id / api_hash не подошли — Owner, проверьте их",
  AUTH_KEY_UNREGISTERED: "Вход устарел — войдите заново",
  SESSION_REVOKED: "Этот вход отключили в Telegram — войдите заново",
  FILE_PARTS_INVALID: "Файл слишком большой для этого аккаунта",
  CHAT_WRITE_FORBIDDEN: "В этот чат нельзя писать",
  PEER_FLOOD: "Telegram временно ограничил отправку — попробуйте позже",
};

export function tgErrorText(error: unknown, fallback = "Не удалось выполнить действие в Telegram"): string {
  const text = rpcText(error);
  if (text.startsWith("FLOOD_WAIT_")) return `Telegram просит подождать ${text.slice("FLOOD_WAIT_".length)} с`;
  if (ERROR_TEXT[text]) return ERROR_TEXT[text];
  if ((error as { name?: string })?.name === "AbortError") return "Отменено";
  const message = error instanceof Error ? error.message : "";
  return message ? `${fallback}: ${message}` : fallback;
}

// ---------------------------------------------------------------------
// Клиент.
// ---------------------------------------------------------------------

interface Session {
  key: string;
  workspaceId: string;
  uid: string;
  config: TelegramConfig;
  client: TelegramClient;
  storageName: string;
}

let session: Session | null = null;

export function tgStorageName(workspaceId: string, uid: string) {
  return `nova-tg:${workspaceId}:${uid}`;
}

function makeClient(config: TelegramConfig, storageName: string, deviceName: string): TelegramClient {
  return new TelegramClient({
    apiId: config.apiId,
    apiHash: config.apiHash,
    storage: storageName,
    initConnectionOptions: {
      deviceModel: deviceName.slice(0, 64),
      systemVersion: "Web",
      appVersion: "Nova CRM",
      langCode: "ru",
      systemLangCode: "ru",
    },
    logLevel: 1,
  });
}

function toMe(user: { id: number; displayName: string; username: string | null; isPremium: boolean }): TgMe {
  return { id: user.id, name: user.displayName, username: user.username, isPremium: user.isPremium };
}

/**
 * Открыть сессию этого человека в этом workspace. Тот же ключ — ничего не
 * делает (клиент уже жив). Проверяет, есть ли вход, и ставит состояние.
 */
export async function openTelegram(input: { workspaceId: string; uid: string; config: TelegramConfig; deviceName: string }): Promise<void> {
  const key = `${input.workspaceId}:${input.uid}:${input.config.apiId}`;
  if (session?.key === key && state.auth.kind !== "error") return;
  if (session) await closeSession();
  const storageName = tgStorageName(input.workspaceId, input.uid);
  const client = makeClient(input.config, storageName, input.deviceName);
  session = { key, workspaceId: input.workspaceId, uid: input.uid, config: input.config, client, storageName };
  wireUpdates(client);
  set({ ...INITIAL, auth: { kind: "connecting" } });
  try {
    const me = await client.getMe();
    await client.notifyLoggedIn(me.raw);
    onSignedIn(toMe(me));
  } catch (error) {
    if (session?.client !== client) return;
    const text = rpcText(error);
    if (text === "SESSION_PASSWORD_NEEDED") {
      set({ auth: { kind: "password", hint: await client.getPasswordHint().catch(() => null), error: null } });
      return;
    }
    if (text === "AUTH_KEY_UNREGISTERED" || text === "SESSION_REVOKED" || text === "USER_DEACTIVATED") {
      writeTelegramSessionMark(input.workspaceId, input.uid, null);
      set({ auth: { kind: "signedOut" } });
      return;
    }
    set({ auth: { kind: "error", message: tgErrorText(error, "Нет связи с Telegram") } });
  }
}

async function closeSession() {
  const s = session;
  session = null;
  qrAbort?.abort();
  qrAbort = null;
  if (s) await s.client.destroy().catch(() => undefined);
  set({ ...INITIAL });
}

function onSignedIn(me: TgMe) {
  if (!session) return;
  writeTelegramSessionMark(session.workspaceId, session.uid, session.config);
  // Ключ входа живёт в IndexedDB: просим браузер не вычищать его при нехватке
  // места, иначе человеку пришлось бы снова сканировать QR.
  void navigator.storage?.persist?.().catch(() => false);
  set({ auth: { kind: "ready", me } });
  void loadDialogs();
}

// ---------------------------------------------------------------------
// Вход.
// ---------------------------------------------------------------------

let qrAbort: AbortController | null = null;
let passwordWaiter: { resolve: (pw: string) => void; reject: (e: unknown) => void } | null = null;
let phoneFlow: { phone: string; phoneCodeHash: string } | null = null;

/** QR-код: «Telegram → Настройки → Устройства → Подключить устройство» на телефоне. */
export async function startQrLogin(): Promise<void> {
  const s = session;
  if (!s) return;
  qrAbort?.abort();
  const abort = new AbortController();
  qrAbort = abort;
  try {
    const user = await s.client.signInQr({
      onUrlUpdated: (url, expires) => {
        if (qrAbort === abort) set({ auth: { kind: "qr", url, expires: expires.getTime() } });
      },
      onQrScanned: () => {
        if (qrAbort === abort) set({ auth: { kind: "qrScanned" } });
      },
      password: () => askPassword(s.client),
      // Сразу за этим mtcute снова спрашивает пароль (askPassword): ошибку
      // отдаём туда, иначе новый запрос стирал бы её до того, как её увидят.
      invalidPasswordCallback: () => {
        passwordRetryError = "Неверный облачный пароль";
      },
      abortSignal: abort.signal,
    });
    if (qrAbort !== abort) return;
    qrAbort = null;
    onSignedIn(toMe(user));
  } catch (error) {
    if (qrAbort !== abort) return;
    qrAbort = null;
    if (abort.signal.aborted) {
      set({ auth: { kind: "signedOut" } });
      return;
    }
    set({ auth: { kind: "error", message: tgErrorText(error, "Вход по QR не удался") } });
  }
}

let passwordHint: string | null = null;
let passwordRetryError: string | null = null;

async function askPassword(client: TelegramClient): Promise<string> {
  passwordHint = await client.getPasswordHint().catch(() => null);
  const error = passwordRetryError;
  passwordRetryError = null;
  set({ auth: { kind: "password", hint: passwordHint, error } });
  return new Promise<string>((resolve, reject) => {
    passwordWaiter = { resolve, reject };
  });
}

export function cancelLogin() {
  qrAbort?.abort();
  qrAbort = null;
  passwordWaiter?.reject(new Error("cancelled"));
  passwordWaiter = null;
  phoneFlow = null;
  set({ auth: { kind: "signedOut" } });
}

/** Вход кодом: код придёт в Telegram на телефоне хозяина аккаунта. */
export async function sendPhoneCode(phone: string): Promise<void> {
  const s = session;
  if (!s) return;
  const clean = phone.replace(/[^\d+]/g, "");
  const res = await s.client.sendCode({ phone: clean });
  if (!("phoneCodeHash" in res)) {
    onSignedIn(toMe(res));
    return;
  }
  phoneFlow = { phone: clean, phoneCodeHash: res.phoneCodeHash };
  const via = res.type === "app" ? "в Telegram" : res.type === "sms" ? "по SMS" : "";
  set({ auth: { kind: "code", phone: clean, via } });
}

export async function submitPhoneCode(code: string): Promise<void> {
  const s = session;
  if (!s || !phoneFlow) return;
  try {
    const user = await s.client.signIn({ phone: phoneFlow.phone, phoneCodeHash: phoneFlow.phoneCodeHash, phoneCode: code.trim() });
    phoneFlow = null;
    onSignedIn(toMe(user));
  } catch (error) {
    if (rpcText(error) === "SESSION_PASSWORD_NEEDED") {
      passwordHint = await s.client.getPasswordHint().catch(() => null);
      set({ auth: { kind: "password", hint: passwordHint, error: null } });
      return;
    }
    throw error;
  }
}

/** Облачный пароль — и для QR, и для входа кодом. */
export async function submitPassword(password: string): Promise<void> {
  const s = session;
  if (!s) return;
  if (passwordWaiter) {
    const waiter = passwordWaiter;
    passwordWaiter = null;
    set({ auth: { kind: "qrScanned" } });
    waiter.resolve(password);
    return;
  }
  try {
    const user = await s.client.checkPassword(password);
    onSignedIn(toMe(user));
  } catch (error) {
    set({ auth: { kind: "password", hint: passwordHint, error: tgErrorText(error, "Пароль не подошёл") } });
  }
}

/**
 * Выход: завершить сессию на сервере Telegram (устройство пропадёт из
 * списка), закрыть клиент и стереть базу IndexedDB. Для автовыхода, когда
 * клиента в этой вкладке нет, он создаётся на один вызов.
 */
export async function logOutTelegram(input: { workspaceId: string; uid: string; config: TelegramConfig; reason: "button" | "revoked" }): Promise<void> {
  const storageName = tgStorageName(input.workspaceId, input.uid);
  let client: TelegramClient | null = null;
  if (session && session.workspaceId === input.workspaceId && session.uid === input.uid) {
    client = session.client;
    session = null;
  } else {
    try {
      client = makeClient(input.config, storageName, "Nova");
    } catch {
      client = null;
    }
  }
  if (client) {
    await client.logOut().catch(() => undefined);
    await client.destroy().catch(() => undefined);
  }
  await new Promise<void>((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(storageName);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
  writeTelegramSessionMark(input.workspaceId, input.uid, null);
  set({ ...INITIAL, auth: { kind: input.reason === "revoked" ? "idle" : "signedOut" } });
}

// ---------------------------------------------------------------------
// Чаты.
// ---------------------------------------------------------------------

function peerTitle(peer: Peer): string {
  return peer.displayName || "Без имени";
}

function mediaPreview(media: Message["media"]): string {
  if (!media) return "";
  switch (media.type) {
    case "photo":
      return "📷 Фото";
    case "video":
      return "🎬 Видео";
    case "voice":
      return "🎤 Голосовое";
    case "audio":
      return "🎵 Аудио";
    case "sticker":
      return `${(media as { emoji?: string }).emoji ?? ""} Стикер`.trim();
    case "document":
      return `📎 ${(media as { fileName?: string | null }).fileName ?? "Файл"}`;
    case "location":
    case "live_location":
    case "venue":
      return "📍 Геопозиция";
    case "contact":
      return "👤 Контакт";
    case "poll":
      return "📊 Опрос";
    default:
      return "Вложение";
  }
}

function toMedia(media: Message["media"]): TgMedia | null {
  if (!media) return null;
  const m = media as unknown as { type: string; fileName?: string | null; fileSize?: number; mimeType?: string; duration?: number; emoji?: string };
  return {
    type: m.type,
    fileName: m.fileName ?? null,
    fileSize: typeof m.fileSize === "number" ? m.fileSize : null,
    mimeType: m.mimeType ?? null,
    duration: typeof m.duration === "number" ? m.duration : null,
    emoji: m.emoji ?? null,
  };
}

/** Сырые сообщения — для скачивания вложений (ключ: chatId:id). */
const rawMessages = new Map<string, Message>();
const RAW_LIMIT = 3000;

function toMessage(msg: Message): TgMessage {
  const key = `${msg.chat.id}:${msg.id}`;
  rawMessages.set(key, msg);
  if (rawMessages.size > RAW_LIMIT) {
    const first = rawMessages.keys().next().value;
    if (first) rawMessages.delete(first);
  }
  return {
    id: msg.id,
    chatId: msg.chat.id,
    date: msg.date.getTime(),
    out: msg.isOutgoing,
    text: msg.text,
    senderName: peerTitle(msg.sender as Peer),
    media: toMedia(msg.media),
    edited: Boolean(msg.editDate),
  };
}

function toDialog(d: Dialog): TgDialog {
  const peer = d.peer;
  const last = d.lastMessage;
  const isUser = peer.type === "user";
  return {
    id: peer.id,
    title: peerTitle(peer),
    username: peer.username ?? null,
    isUser,
    lastText: last ? last.text || mediaPreview(last.media) : "",
    lastAt: last ? last.date.getTime() : 0,
    lastOut: last ? last.isOutgoing : false,
    lastId: last ? last.id : 0,
    unread: d.unreadCount,
    pinned: d.isPinned,
    readOutboxMaxId: d.lastReadOutgoing,
  };
}

const peers = new Map<number, Peer>();

let dialogsInFlight = false;
export async function loadDialogs(): Promise<void> {
  const s = session;
  if (!s || dialogsInFlight) return;
  dialogsInFlight = true;
  try {
    const list: TgDialog[] = [];
    for await (const d of s.client.iterDialogs({ limit: 150, archived: "exclude" })) {
      peers.set(d.peer.id, d.peer);
      list.push(toDialog(d));
    }
    if (session !== s) return;
    set({ dialogs: sortDialogs(list), dialogsLoaded: true, dialogsError: null });
  } catch (error) {
    if (session === s) set({ dialogsError: tgErrorText(error, "Не удалось загрузить чаты"), dialogsLoaded: true });
  } finally {
    dialogsInFlight = false;
  }
}

function sortDialogs(list: TgDialog[]): TgDialog[] {
  return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastAt - a.lastAt);
}

const PAGE = 40;

function chatOf(chatId: number): TgChatCache {
  return state.chats[chatId] ?? { messages: [], loading: false, hasMore: true, error: null };
}

function setChat(chatId: number, patch: Partial<TgChatCache>) {
  set({ chats: { ...state.chats, [chatId]: { ...chatOf(chatId), ...patch } } });
}

function mergeMessages(a: TgMessage[], b: TgMessage[]): TgMessage[] {
  const byId = new Map<number, TgMessage>();
  for (const m of a) byId.set(m.id, m);
  for (const m of b) byId.set(m.id, m);
  return [...byId.values()].sort((x, y) => x.id - y.id);
}

/** Последние сообщения чата или страница старее самого старого загруженного. */
export async function loadHistory(chatId: number, older = false): Promise<void> {
  const s = session;
  if (!s) return;
  const cache = chatOf(chatId);
  if (cache.loading || (older && !cache.hasMore)) return;
  setChat(chatId, { loading: true, error: null });
  try {
    const oldest = older ? cache.messages[0] : undefined;
    const page = await s.client.getHistory(chatId, {
      limit: PAGE,
      ...(oldest ? { offset: { id: oldest.id, date: Math.floor(oldest.date / 1000) } } : {}),
    });
    if (session !== s) return;
    const mapped = [...page].map(toMessage);
    setChat(chatId, {
      loading: false,
      hasMore: mapped.length >= PAGE,
      messages: older ? mergeMessages(mapped, chatOf(chatId).messages) : mergeMessages(chatOf(chatId).messages, mapped),
    });
  } catch (error) {
    if (session === s) setChat(chatId, { loading: false, error: tgErrorText(error, "Не удалось загрузить переписку") });
  }
}

/** Открытый сейчас чат — у него входящие сразу отмечаются прочитанными. */
let openChatId: number | null = null;
let readTimer: ReturnType<typeof setTimeout> | null = null;

export function setOpenChat(chatId: number | null) {
  openChatId = chatId;
  if (chatId !== null) markRead(chatId);
}

function markRead(chatId: number) {
  const s = session;
  if (!s) return;
  const dialog = state.dialogs.find((d) => d.id === chatId);
  if (dialog && dialog.unread > 0) {
    set({ dialogs: state.dialogs.map((d) => (d.id === chatId ? { ...d, unread: 0 } : d)) });
  }
  if (readTimer) clearTimeout(readTimer);
  readTimer = setTimeout(() => {
    readTimer = null;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    void s.client.readHistory(chatId).catch(() => undefined);
  }, 800);
}

export async function sendText(chatId: number, text: string): Promise<void> {
  const s = session;
  if (!s) return;
  const msg = await s.client.sendText(chatId, text);
  applyNewMessage(msg);
}

// ---------------------------------------------------------------------
// Живые обновления.
// ---------------------------------------------------------------------

let dialogsRefresh: ReturnType<typeof setTimeout> | null = null;

function applyNewMessage(msg: Message) {
  const m = toMessage(msg);
  const chat = state.chats[m.chatId];
  const chats = chat ? { ...state.chats, [m.chatId]: { ...chat, messages: mergeMessages(chat.messages, [m]) } } : state.chats;
  const known = state.dialogs.find((d) => d.id === m.chatId);
  if (!known) {
    set({ chats });
    // Новый чат (клиент написал впервые) — список целиком, раз в пару секунд.
    if (!dialogsRefresh) {
      dialogsRefresh = setTimeout(() => {
        dialogsRefresh = null;
        void loadDialogs();
      }, 1500);
    }
    return;
  }
  const isOpen = openChatId === m.chatId && typeof document !== "undefined" && document.visibilityState === "visible";
  const updated: TgDialog = {
    ...known,
    lastText: m.text || mediaPreview(msg.media),
    lastAt: m.date,
    lastOut: m.out,
    lastId: m.id,
    unread: m.out || isOpen ? known.unread : known.unread + 1,
  };
  set({ chats, dialogs: sortDialogs(state.dialogs.map((d) => (d.id === m.chatId ? updated : d))) });
  if (isOpen && !m.out) markRead(m.chatId);
}

function wireUpdates(client: TelegramClient) {
  client.onNewMessage.add((msg) => {
    if (session?.client === client) applyNewMessage(msg);
  });
  client.onEditMessage.add((msg) => {
    if (session?.client !== client) return;
    const m = toMessage(msg);
    const chat = state.chats[m.chatId];
    if (chat) setChat(m.chatId, { messages: chat.messages.map((x) => (x.id === m.id ? m : x)) });
  });
  client.onDeleteMessage.add((upd) => {
    if (session?.client !== client) return;
    const ids = new Set(upd.messageIds);
    const chats: Record<number, TgChatCache> = {};
    for (const [key, chat] of Object.entries(state.chats)) {
      chats[Number(key)] = chat.messages.some((m) => ids.has(m.id)) ? { ...chat, messages: chat.messages.filter((m) => !ids.has(m.id)) } : chat;
    }
    set({ chats });
  });
  client.onHistoryRead.add((upd) => {
    if (session?.client !== client || !upd.isOutbox) return;
    set({
      dialogs: state.dialogs.map((d) => (d.id === upd.chatId ? { ...d, readOutboxMaxId: Math.max(d.readOutboxMaxId, upd.maxReadId) } : d)),
    });
  });
}

// ---------------------------------------------------------------------
// Вложения: скачивание и аватарки.
// ---------------------------------------------------------------------

const PHOTO_CACHE = new Map<string, Promise<string | null>>();

/** Превью фото из сообщения (ссылка blob:, кэш на вкладку). */
export function messagePhotoUrl(chatId: number, messageId: number): Promise<string | null> {
  const key = `${chatId}:${messageId}`;
  const hit = PHOTO_CACHE.get(key);
  if (hit) return hit;
  const run = (async () => {
    const s = session;
    const msg = rawMessages.get(key);
    if (!s || !msg || msg.media?.type !== "photo") return null;
    const photo = msg.media;
    const thumb = photo.getThumbnail("x") ?? photo.getThumbnail("m") ?? photo;
    const bytes = await s.client.downloadAsBuffer(thumb);
    return URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/jpeg" }));
  })().catch(() => null);
  PHOTO_CACHE.set(key, run);
  return run;
}

const AVATARS = new Map<number, Promise<string | null>>();
let avatarSlots = 3;
const avatarQueue: Array<() => void> = [];

async function avatarSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (avatarSlots <= 0) await new Promise<void>((resolve) => avatarQueue.push(resolve));
  avatarSlots -= 1;
  try {
    return await fn();
  } finally {
    avatarSlots += 1;
    avatarQueue.shift()?.();
  }
}

/** Маленькое фото чата для списка (по три параллельно, кэш на вкладку). */
export function dialogAvatarUrl(chatId: number): Promise<string | null> {
  const hit = AVATARS.get(chatId);
  if (hit) return hit;
  const run = avatarSlot(async () => {
    const s = session;
    const peer = peers.get(chatId);
    const photo = peer?.photo;
    if (!s || !photo) return null;
    const bytes = await s.client.downloadAsBuffer(photo.small);
    return URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/jpeg" }));
  }).catch(() => null);
  AVATARS.set(chatId, run);
  return run;
}

/** Вложение целиком (файл, видео, голосовое) — Blob с прогрессом. */
export async function downloadMessageMedia(chatId: number, messageId: number, onProgress?: (done: number, total: number) => void): Promise<Blob | null> {
  const s = session;
  const msg = rawMessages.get(`${chatId}:${messageId}`);
  const media = msg?.media;
  if (!s || !media || !("fileSize" in media || media.type === "photo")) return null;
  const location = media as unknown as Parameters<TelegramClient["downloadAsIterable"]>[0];
  const parts: BlobPart[] = [];
  let done = 0;
  const total = Number((media as { fileSize?: number }).fileSize ?? 0);
  for await (const chunk of s.client.downloadAsIterable(location)) {
    parts.push(chunk as BlobPart);
    done += chunk.length;
    onProgress?.(done, total);
  }
  return new Blob(parts, { type: (media as { mimeType?: string }).mimeType ?? "application/octet-stream" });
}

// ---------------------------------------------------------------------
// Отправка файлов.
// ---------------------------------------------------------------------

const MB = 1024 * 1024;
/** Предел Telegram на файл: без Premium 2 ГБ, с Premium 4 ГБ. */
export function tgFileLimit(me: TgMe | null): number {
  return me?.isPremium ? 4000 * MB : 2000 * MB;
}

const controllers = new Map<string, AbortController>();

function publishPulse() {
  const active = state.uploads.filter((u) => u.status === "uploading");
  const total = active.reduce((n, u) => n + u.size, 0);
  const sent = active.reduce((n, u) => n + u.sent, 0);
  setTgUploadsPulse({ active: active.length, progress: total > 0 ? sent / total : 0, chatId: active[0]?.chatId ?? null });
}

function patchUpload(id: string, patch: Partial<TgUpload>) {
  set({ uploads: state.uploads.map((u) => (u.id === id ? { ...u, ...patch } : u)) });
}

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (!state.uploads.some((u) => u.status === "uploading")) return;
  e.preventDefault();
  e.returnValue = "";
}
if (typeof window !== "undefined") window.addEventListener("beforeunload", onBeforeUnload);

/** Длительность, размер и кадр-обложка видео — чтобы Telegram показал его плеером. */
async function probeVideo(file: File): Promise<{ duration: number; width: number; height: number; thumb: Uint8Array | null } | null> {
  if (typeof document === "undefined") return null;
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.src = url;
    const ok = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 8000);
      video.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve(true);
      };
      video.onerror = () => {
        clearTimeout(timer);
        resolve(false);
      };
    });
    if (!ok) return null;
    const meta = { duration: Math.round(video.duration || 0), width: video.videoWidth, height: video.videoHeight };
    let thumb: Uint8Array | null = null;
    try {
      video.currentTime = Math.min(1, (video.duration || 0) / 2);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 4000);
        video.onseeked = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      const scale = Math.min(1, 320 / Math.max(meta.width || 1, meta.height || 1));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round((meta.width || 320) * scale));
      canvas.height = Math.max(1, Math.round((meta.height || 180) * scale));
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
      if (blob) thumb = new Uint8Array(await blob.arrayBuffer());
    } catch {
      thumb = null;
    }
    return { ...meta, thumb };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Отправить файл. Видео уходит видео (в исходном качестве, с плеером),
 * фото до 10 МБ — фото (Telegram его сожмёт), остальное и «как файл» —
 * документом без сжатия. Прогресс и отмена — через `state.uploads`.
 */
export async function sendFile(input: { chatId: number; chatTitle: string; file: File; caption?: string; asDocument?: boolean }): Promise<void> {
  const s = session;
  if (!s) throw new Error("Нет входа в Telegram");
  const me = state.auth.kind === "ready" ? state.auth.me : null;
  const limit = tgFileLimit(me);
  if (input.file.size > limit) {
    throw new Error(`Файл больше ${Math.round(limit / MB / 1000)} ГБ — Telegram такой не примет${me?.isPremium ? "" : " (с Premium — до 4 ГБ)"}`);
  }
  const id = `up_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
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
  };
  set({ uploads: [...state.uploads.filter((u) => u.status === "uploading" || Date.now() - u.startedAt < 10 * 60_000), upload] });
  try {
    const caption = input.caption?.trim() || undefined;
    const common = { fileName: input.file.name, fileMime: input.file.type || undefined, fileSize: input.file.size, caption };
    let media;
    if (!input.asDocument && input.file.type.startsWith("video/")) {
      const meta = await probeVideo(input.file);
      media = InputMedia.video(input.file, {
        ...common,
        supportsStreaming: true,
        ...(meta ? { duration: meta.duration, width: meta.width, height: meta.height } : {}),
        ...(meta?.thumb ? { thumb: meta.thumb } : {}),
      });
    } else if (!input.asDocument && input.file.type.startsWith("image/") && input.file.size <= 10 * MB) {
      media = InputMedia.photo(input.file, { fileSize: input.file.size, caption });
    } else {
      media = InputMedia.document(input.file, common);
    }
    let lastPatch = 0;
    const msg = await s.client.sendMedia(input.chatId, media, {
      abortSignal: controller.signal,
      progressCallback: (uploaded) => {
        const now = Date.now();
        if (now - lastPatch < 250 && uploaded < input.file.size) return;
        lastPatch = now;
        patchUpload(id, { sent: uploaded });
      },
    });
    patchUpload(id, { sent: input.file.size, status: "done" });
    applyNewMessage(msg);
  } catch (error) {
    patchUpload(id, controller.signal.aborted ? { status: "cancelled" } : { status: "error", error: tgErrorText(error, "Файл не отправился") });
    if (!controller.signal.aborted) throw error;
  } finally {
    controllers.delete(id);
  }
}

export function cancelUpload(id: string) {
  controllers.get(id)?.abort();
}

export function dismissUpload(id: string) {
  set({ uploads: state.uploads.filter((u) => u.id !== id || u.status === "uploading") });
}
