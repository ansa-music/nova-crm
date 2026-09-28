// Логика функции `tg` без привязки к Deno и mtcute (всё приходит через deps),
// поэтому её можно проверять в Node на поддельном Telegram.
//
// Главный вход workspace (tg_master) живёт здесь, на сервере. Браузеры с
// полным доступом получают от него свои «устройства» (acceptLoginToken),
// технари пишут разрешённым клиентам только через эту функцию.

import { computeSrp, type PasswordRequest } from "./srp.ts";
import { b64ToBytes, base64Url, tlDecode, tlEncode, type LongCtor } from "./tlCodec.ts";

// ---------------------------------------------------------------------
// Типы.
// ---------------------------------------------------------------------

export interface PeerRef {
  type: "user" | "chat" | "channel";
  id: string;
  accessHash?: string;
}

export interface EdgeGrant {
  chatId: number;
  peer: PeerRef;
  title: string;
}

export interface EdgeCtx {
  uid: string;
  owner: boolean;
  full: boolean;
  grants: EdgeGrant[];
}

export interface MasterRow {
  session: string | null;
  account_id: number | null;
  account_name: string | null;
  account_username: string | null;
  password: string | null;
  connected_by: string | null;
  connected_at: string | null;
  pending_session: string | null;
  pending_kind: string | null;
  pending_phone: string | null;
  pending_code_hash: string | null;
  pending_by: string | null;
  /** Служебный бот для файлов технарей (SQL 20261037). */
  bot_token?: string | null;
  bot_id?: number | string | null;
  bot_username?: string | null;
  /** Скрытая группа «аккаунт + бот», через неё технари передают файлы. */
  courier_chat_id?: number | string | null;
}

export interface DeviceRow {
  uid: string;
  marker: string;
  auth_hash: string | null;
}

export interface Db {
  master(ws: string): Promise<MasterRow | null>;
  saveMaster(ws: string, patch: Partial<MasterRow> & { connected_at?: string | null; pending_at?: string | null }): Promise<void>;
  devices(ws: string): Promise<DeviceRow[]>;
  addDevice(ws: string, row: DeviceRow): Promise<void>;
  removeDevices(ws: string, markers: string[]): Promise<void>;
  /** Кому раздел открыт: tg_access (участники) + Owner'ы. */
  allowedUids(ws: string): Promise<Set<string>>;
  config(ws: string): Promise<{ apiId: number; apiHash: string } | null>;
  lease(ws: string, holder: string, ttlMs: number): Promise<boolean>;
  release(ws: string, holder: string): Promise<void>;
}

// deno-lint-ignore no-explicit-any
export type Tl = any;

export interface TgConn {
  call(request: Tl): Promise<Tl>;
  /** Скачать файл Telegram (сама ходит в нужный дата-центр). */
  download(location: Tl, opts: { dcId: number; fileSize?: number }): Promise<Uint8Array>;
  changePrimaryDc(dcId: number): Promise<void>;
  exportSession(): Promise<string>;
  destroy(): Promise<void>;
}

export interface Deps {
  ctx(token: string, ws: string): Promise<EdgeCtx>;
  db: Db;
  connect(config: { apiId: number; apiHash: string }, session: string | null): Promise<TgConn>;
  /** Bot API (HTTPS): проверить токен служебного бота — `getMe`. */
  botApi(token: string, method: string): Promise<Tl>;
  Long: LongCtor & { ZERO: unknown };
  randomLong(): unknown;
  sleep(ms: number): Promise<void>;
  now(): number;
  holderId(): string;
  runtime: string;
}

export interface EdgeResult {
  status: number;
  body: unknown;
}

export class EdgeError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

// ---------------------------------------------------------------------
// Помощники.
// ---------------------------------------------------------------------

function rpcText(error: unknown): string {
  const e = error as { text?: string; message?: string } | null;
  if (e && typeof e.text === "string") return e.text;
  const m = /([A-Z_]{3,}(?:_\d+)?)/.exec(e?.message ?? "");
  return m ? m[1] : e?.message ?? "UNKNOWN";
}

const LEASE_TTL = 30_000;
const LEASE_WAIT = 12_000;

async function withLease<T>(deps: Deps, ws: string, fn: () => Promise<T>): Promise<T> {
  const holder = deps.holderId();
  const started = deps.now();
  while (!(await deps.db.lease(ws, holder, LEASE_TTL))) {
    if (deps.now() - started > LEASE_WAIT) throw new EdgeError(503, "busy", "Telegram занят другим запросом — повторите через секунду.");
    await deps.sleep(300);
  }
  try {
    return await fn();
  } finally {
    await deps.db.release(ws, holder).catch(() => undefined);
  }
}

async function useConn<T>(deps: Deps, ws: string, session: string | null, fn: (conn: TgConn, config: { apiId: number; apiHash: string }) => Promise<T>): Promise<T> {
  const config = await deps.db.config(ws);
  if (!config) throw new EdgeError(409, "no_config", "Owner ещё не ввёл ключи Telegram (api_id / api_hash).");
  const conn = await deps.connect(config, session);
  try {
    return await fn(conn, config);
  } finally {
    await conn.destroy().catch(() => undefined);
  }
}

function inputPeer(deps: Deps, peer: PeerRef): Tl {
  const id = Number(peer.id);
  if (peer.type === "user") return { _: "inputPeerUser", userId: id, accessHash: deps.Long.fromString(peer.accessHash ?? "0") };
  if (peer.type === "chat") return { _: "inputPeerChat", chatId: id };
  return { _: "inputPeerChannel", channelId: id, accessHash: deps.Long.fromString(peer.accessHash ?? "0") };
}

function userName(user: Tl): string {
  if (!user) return "";
  return [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || String(user.id ?? "");
}

function accountOf(master: MasterRow | null) {
  if (!master?.session) return null;
  return { id: master.account_id, name: master.account_name, username: master.account_username };
}

const CLEAR_PENDING = {
  pending_session: null,
  pending_kind: null,
  pending_phone: null,
  pending_code_hash: null,
  pending_by: null,
  pending_at: null,
};

function mediaLabel(media: Tl): string | null {
  if (!media || media._ === "messageMediaEmpty") return null;
  switch (media._) {
    case "messageMediaPhoto":
      return "фото";
    case "messageMediaDocument": {
      const doc = media.document;
      const attrs: Tl[] = doc?.attributes ?? [];
      if (attrs.some((a) => a._ === "documentAttributeSticker")) return "стикер";
      const audio = attrs.find((a) => a._ === "documentAttributeAudio");
      if (audio) return audio.voice ? "голосовое" : "аудио";
      if (attrs.some((a) => a._ === "documentAttributeVideo")) return attrs.some((a) => a._ === "documentAttributeVideo" && a.roundMessage) ? "кружок" : "видео";
      return "файл";
    }
    case "messageMediaGeo":
    case "messageMediaGeoLive":
    case "messageMediaVenue":
      return "место";
    case "messageMediaContact":
      return "контакт";
    case "messageMediaPoll":
      return "опрос";
    default:
      return "вложение";
  }
}

/** Что за вложение — чтобы технарь видел фото, видео и файлы, а не «[файл]». */
export interface TechFile {
  kind: "photo" | "video" | "round" | "voice" | "audio" | "sticker" | "document";
  name: string | null;
  mime: string | null;
  size: number | null;
  w: number | null;
  h: number | null;
  duration: number | null;
  /** Есть превью, его отдаёт tech_media. */
  thumb: boolean;
}

export interface TechMessage {
  id: number;
  out: boolean;
  date: number;
  text: string;
  media: string | null;
  service: boolean;
  /** Кто написал (в группах и каналах); в личке — null. */
  from: string | null;
  file: TechFile | null;
}

/** Максимум, который технарь скачивает через сервер. */
export const TECH_FILE_MAX = 20 * 1024 * 1024;

const PHOTO_SIZE_TYPES = new Set(["photoSize", "photoSizeProgressive", "photoCachedSize"]);

function sizeBytes(s: Tl): number {
  if (!s) return 0;
  if (s._ === "photoSizeProgressive") return Number(s.sizes?.[s.sizes.length - 1] ?? 0);
  if (s._ === "photoCachedSize") return s.bytes?.length ?? 0;
  return Number(s.size ?? 0);
}

function photoSizes(list: Tl[] | undefined): Tl[] {
  return (list ?? []).filter((x) => PHOTO_SIZE_TYPES.has(x?._) && typeof x.type === "string");
}

function largest(list: Tl[]): Tl | null {
  return list.reduce<Tl | null>((best, x) => (!best || (x.w ?? 0) * (x.h ?? 0) > (best.w ?? 0) * (best.h ?? 0) ? x : best), null);
}

/** Превью ~320 px: «m», иначе самое маленькое из тех, что больше 100 px, иначе любое. */
function previewSize(list: Tl[]): Tl | null {
  if (!list.length) return null;
  const m = list.find((x) => x.type === "m");
  if (m) return m;
  const sorted = [...list].sort((a, b) => (a.w ?? 0) - (b.w ?? 0));
  return sorted.find((x) => (x.w ?? 0) >= 100) ?? sorted[sorted.length - 1];
}

function mediaFile(media: Tl): TechFile | null {
  if (!media) return null;
  if (media._ === "messageMediaPhoto" && media.photo?._ === "photo") {
    const big = largest(photoSizes(media.photo.sizes));
    return { kind: "photo", name: null, mime: "image/jpeg", size: big ? sizeBytes(big) : null, w: big?.w ?? null, h: big?.h ?? null, duration: null, thumb: Boolean(big) };
  }
  if (media._ === "messageMediaDocument" && media.document?._ === "document") {
    const doc = media.document;
    const attrs: Tl[] = doc.attributes ?? [];
    const video = attrs.find((a) => a._ === "documentAttributeVideo");
    const audio = attrs.find((a) => a._ === "documentAttributeAudio");
    const image = attrs.find((a) => a._ === "documentAttributeImageSize");
    const name = attrs.find((a) => a._ === "documentAttributeFilename")?.fileName ?? null;
    const kind: TechFile["kind"] = attrs.some((a) => a._ === "documentAttributeSticker")
      ? "sticker"
      : video
        ? video.roundMessage
          ? "round"
          : "video"
        : audio
          ? audio.voice
            ? "voice"
            : "audio"
          : String(doc.mimeType ?? "").startsWith("image/")
            ? "photo"
            : "document";
    return {
      kind,
      name,
      mime: doc.mimeType ?? null,
      size: Number(doc.size ?? 0) || null,
      w: video?.w ?? image?.w ?? null,
      h: video?.h ?? image?.h ?? null,
      duration: video?.duration ?? audio?.duration ?? null,
      thumb: photoSizes(doc.thumbs).length > 0,
    };
  }
  return null;
}

function toTechMessage(m: Tl, names?: Map<string, string>, group = false): TechMessage | null {
  if (!m || (m._ !== "message" && m._ !== "messageService")) return null;
  const from = group && !m.out ? (m.fromId ? names?.get(peerKey(m.fromId)) ?? null : m.postAuthor ?? null) : null;
  return {
    id: m.id,
    out: Boolean(m.out),
    date: (m.date ?? 0) * 1000,
    text: m._ === "message" ? (m.message ?? "") : "",
    media: m._ === "message" ? mediaLabel(m.media) : null,
    service: m._ === "messageService",
    from: from || null,
    file: m._ === "message" ? mediaFile(m.media) : null,
  };
}

/** Имена отправителей из ответа Telegram: user:id → имя, chat/channel:id → название. */
function namesOf(res: Tl): Map<string, string> {
  const map = new Map<string, string>();
  for (const u of (res?.users ?? []) as Tl[]) map.set(`user:${u.id}`, userName(u));
  for (const c of (res?.chats ?? []) as Tl[]) map.set(`${c._ === "channel" ? "channel" : "chat"}:${c.id}`, c.title ?? "");
  return map;
}

function toBase64(bytes: Uint8Array): string {
  let out = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(out);
}

/** Место файла для скачивания: превью или сам файл. */
function fileLocation(media: Tl, full: boolean): { location: Tl; dcId: number; size: number; mime: string; name: string | null } | null {
  if (media?._ === "messageMediaPhoto" && media.photo?._ === "photo") {
    const p = media.photo;
    const size = full ? largest(photoSizes(p.sizes)) : previewSize(photoSizes(p.sizes));
    if (!size) return null;
    return {
      location: { _: "inputPhotoFileLocation", id: p.id, accessHash: p.accessHash, fileReference: p.fileReference, thumbSize: size.type },
      dcId: p.dcId,
      size: sizeBytes(size),
      mime: "image/jpeg",
      name: null,
    };
  }
  if (media?._ === "messageMediaDocument" && media.document?._ === "document") {
    const d = media.document;
    const name = ((d.attributes ?? []) as Tl[]).find((a) => a._ === "documentAttributeFilename")?.fileName ?? null;
    if (full) {
      return {
        location: { _: "inputDocumentFileLocation", id: d.id, accessHash: d.accessHash, fileReference: d.fileReference, thumbSize: "" },
        dcId: d.dcId,
        size: Number(d.size ?? 0),
        mime: d.mimeType ?? "application/octet-stream",
        name,
      };
    }
    const thumb = previewSize(photoSizes(d.thumbs));
    if (!thumb) return null;
    return {
      location: { _: "inputDocumentFileLocation", id: d.id, accessHash: d.accessHash, fileReference: d.fileReference, thumbSize: thumb.type },
      dcId: d.dcId,
      size: sizeBytes(thumb),
      mime: "image/jpeg",
      name: null,
    };
  }
  return null;
}

function peerKey(p: Tl): string {
  if (!p) return "";
  if (p._ === "peerUser") return `user:${p.userId}`;
  if (p._ === "peerChat") return `chat:${p.chatId}`;
  if (p._ === "peerChannel") return `channel:${p.channelId}`;
  return "";
}

// ---------------------------------------------------------------------
// Файлы технаря — через служебного бота (просьба Nurba 28.09.2026: «технарь
// не может прикреплять файлы»). Видео по 250 МБ – 2 ГБ через функцию не
// провезти: у неё 150 МБ памяти и 150 с на вызов, а исходящий трафик
// Supabase — 5 ГБ в месяц. Поэтому файл идёт из браузера технаря прямо в
// Telegram: браузер входит БОТОМ (MTProto, до 2 ГБ) и кладёт файл в скрытую
// группу «аккаунт + бот», а функция главным входом отправляет его клиенту
// по ссылке на тот же документ (без повторной загрузки) и убирает из группы.
// Клиенту бот не пишет и чатов аккаунта не видит; кому технарь вправе
// отправить, решает то же разрешение, что и для текста.
// ---------------------------------------------------------------------

export const COURIER_TITLE = "Nova · файлы технарей";
/** Бот не бывает Premium — предел файла 2000 МБ. */
export const BOT_FILE_MAX = 2000 * 1024 * 1024;
const BOT_TOKEN_RE = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;
const MARKER_RE = /^[a-z0-9]{16,64}$/;

interface CourierBot {
  token: string;
  id: number;
  username: string | null;
  chatId: number;
}

function courierOf(master: MasterRow | null): CourierBot | null {
  const id = Number(master?.bot_id ?? 0);
  const chatId = Number(master?.courier_chat_id ?? 0);
  if (!master?.bot_token || !id || !chatId) return null;
  return { token: master.bot_token, id, username: master.bot_username ?? null, chatId };
}

function randomMarker(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 20);
}

/** id группы из ответа messages.createChat (новый слой — messages.invitedUsers). */
export function createdChatId(res: Tl): number | null {
  const updates = res?._ === "messages.invitedUsers" ? res.updates : res;
  const chat = ((updates?.chats ?? []) as Tl[]).find((c) => c?._ === "chat");
  return chat ? Number(chat.id) : null;
}

/** Медиа из сообщения — для повторной отправки тем же документом (без загрузки). */
export function reusableMedia(media: Tl): Tl | null {
  if (media?._ === "messageMediaPhoto" && media.photo?._ === "photo") {
    const p = media.photo;
    return { _: "inputMediaPhoto", id: { _: "inputPhoto", id: p.id, accessHash: p.accessHash, fileReference: p.fileReference } };
  }
  if (media?._ === "messageMediaDocument" && media.document?._ === "document") {
    const d = media.document;
    return { _: "inputMediaDocument", id: { _: "inputDocument", id: d.id, accessHash: d.accessHash, fileReference: d.fileReference } };
  }
  return null;
}

function fromUserId(m: Tl): number | null {
  return m?.fromId?._ === "peerUser" ? Number(m.fromId.userId) : null;
}

function grantOf(ctx: EdgeCtx, chatId: unknown): EdgeGrant {
  const id = Number(chatId);
  const grant = ctx.grants.find((g) => Number(g.chatId) === id);
  if (!grant) throw new EdgeError(403, "not_granted", "Этот чат вам не открыт. Доступ даёт ОС заказа.");
  return grant;
}

// ---------------------------------------------------------------------
// Вход главного аккаунта.
// ---------------------------------------------------------------------

async function saveAuth(deps: Deps, ws: string, ctx: EdgeCtx, conn: TgConn, auth: Tl, password: string | null) {
  if (!auth || auth._ !== "auth.authorization") {
    throw new EdgeError(409, "no_account", "На этот номер нет аккаунта Telegram — зарегистрируйтесь в приложении Telegram.");
  }
  const session = await conn.exportSession();
  const user = auth.user;
  await deps.db.saveMaster(ws, {
    session,
    account_id: typeof user?.id === "number" ? user.id : Number(user?.id ?? 0) || null,
    account_name: userName(user),
    account_username: user?.username ?? null,
    password,
    connected_by: ctx.uid,
    connected_at: new Date(deps.now()).toISOString(),
    ...CLEAR_PENDING,
  });
  return { state: "connected", account: { id: user?.id ?? null, name: userName(user), username: user?.username ?? null } };
}

async function passwordState(deps: Deps, ws: string, ctx: EdgeCtx, conn: TgConn) {
  const pw = await conn.call({ _: "account.getPassword" }).catch(() => null);
  await deps.db.saveMaster(ws, { pending_session: await conn.exportSession(), pending_kind: "password", pending_by: ctx.uid });
  return { state: "password", hint: pw?.hint ?? null };
}

async function handleLoginToken(deps: Deps, ws: string, ctx: EdgeCtx, conn: TgConn, res: Tl): Promise<unknown> {
  if (res._ === "auth.loginTokenMigrateTo") {
    await conn.changePrimaryDc(res.dcId);
    const next = await conn.call({ _: "auth.importLoginToken", token: res.token });
    return handleLoginToken(deps, ws, ctx, conn, next);
  }
  if (res._ === "auth.loginTokenSuccess") return saveAuth(deps, ws, ctx, conn, res.authorization, null);
  if (res._ === "auth.loginToken") {
    await deps.db.saveMaster(ws, {
      pending_session: await conn.exportSession(),
      pending_kind: "qr",
      pending_by: ctx.uid,
      pending_at: new Date(deps.now()).toISOString(),
    });
    return { state: "qr", url: `tg://login?token=${base64Url(res.token)}`, expires: (res.expires ?? 0) * 1000 };
  }
  throw new EdgeError(500, "unexpected", `Неожиданный ответ Telegram: ${String(res?._)}`);
}

async function exportToken(conn: TgConn, config: { apiId: number; apiHash: string }) {
  return conn.call({ _: "auth.exportLoginToken", apiId: config.apiId, apiHash: config.apiHash, exceptIds: [] });
}

function canConnect(ctx: EdgeCtx, master: MasterRow | null) {
  return ctx.owner || (ctx.full && !master?.session);
}

// ---------------------------------------------------------------------
// Действия.
// ---------------------------------------------------------------------

export async function handle(deps: Deps, token: string, input: Record<string, unknown>): Promise<EdgeResult> {
  try {
    const ws = typeof input.workspaceId === "string" ? input.workspaceId : "";
    const action = typeof input.action === "string" ? input.action : "";
    if (!ws || !action) throw new EdgeError(400, "bad_request", "Нет workspace или действия.");
    if (!token) throw new EdgeError(401, "no_token", "Нужен вход в Nova.");
    const ctx = await deps.ctx(token, ws);
    const body = await run(deps, ws, ctx, action, input);
    return { status: 200, body: { ok: true, ...(body as object) } };
  } catch (error) {
    if (error instanceof EdgeError) return { status: error.status, body: { ok: false, error: error.code, message: error.message } };
    const text = rpcText(error);
    return { status: 502, body: { ok: false, error: text, message: telegramErrorText(text) } };
  }
}

export function telegramErrorText(code: string): string {
  if (code === "PASSWORD_HASH_INVALID") return "Неверный облачный пароль.";
  if (code === "PHONE_CODE_INVALID") return "Неверный код.";
  if (code === "PHONE_CODE_EXPIRED") return "Код устарел — запросите новый.";
  if (code === "PHONE_NUMBER_INVALID") return "Неверный номер телефона.";
  if (code === "AUTH_TOKEN_EXPIRED") return "Код входа устарел — попробуйте ещё раз.";
  if (code === "API_ID_INVALID") return "Ключи api_id / api_hash не подошли.";
  if (code === "FLOOD_WAIT" || code.startsWith("FLOOD_WAIT")) return "Telegram просит подождать — повторите позже.";
  if (code === "AUTH_KEY_UNREGISTERED" || code === "SESSION_REVOKED" || code === "USER_DEACTIVATED")
    return "Аккаунт workspace отключён в Telegram — Owner должен подключить его снова.";
  if (code === "FRESH_RESET_AUTHORISATION_FORBIDDEN") return "Telegram не даёт сбросить устройства в первые 24 часа после подключения.";
  if (code === "PEER_ID_INVALID" || code === "CHANNEL_PRIVATE") return "Чат недоступен аккаунту workspace.";
  if (code === "BOT_GROUPS_BLOCKED") return "Боту запрещено вступать в группы — в @BotFather: Bot Settings → Allow Groups → Turn on, и подключите снова.";
  if (code === "USERNAME_NOT_OCCUPIED" || code === "USERNAME_INVALID") return "Аккаунт workspace не нашёл этого бота в Telegram.";
  return `Ошибка Telegram: ${code}`;
}

async function run(deps: Deps, ws: string, ctx: EdgeCtx, action: string, input: Record<string, unknown>): Promise<unknown> {
  const db = deps.db;

  switch (action) {
    case "status": {
      if (!ctx.full && !ctx.grants.length) throw new EdgeError(403, "denied", "Раздел Telegram вам закрыт.");
      const master = await db.master(ws);
      return {
        connected: Boolean(master?.session),
        account: accountOf(master),
        passwordSaved: Boolean(master?.password),
        pending: master?.session ? null : master?.pending_kind ?? null,
        canConnect: canConnect(ctx, master),
        canManage: ctx.owner,
        full: ctx.full,
        runtime: deps.runtime,
        // Служебный бот для файлов технарей: имя — всем, токен — никому.
        bot: courierOf(master) ? { username: master?.bot_username ?? null } : null,
      };
    }

    // --- Подключение главного входа ----------------------------------
    case "connect_qr_start": {
      return withLease(deps, ws, async () => {
        const master = await db.master(ws);
        if (!canConnect(ctx, master)) throw new EdgeError(403, "denied", "Подключает аккаунт Owner.");
        if (master?.session) throw new EdgeError(409, "already_connected", "Аккаунт уже подключён. Сначала отключите его.");
        return useConn(deps, ws, null, async (conn, config) => handleLoginToken(deps, ws, ctx, conn, await exportToken(conn, config)));
      });
    }
    case "connect_qr_poll": {
      return withLease(deps, ws, async () => {
        const master = await db.master(ws);
        if (master?.session) return { state: "connected", account: accountOf(master) };
        if (!canConnect(ctx, master)) throw new EdgeError(403, "denied", "Подключает аккаунт Owner.");
        if (master?.pending_kind === "password") return { state: "password", hint: null };
        if (master?.pending_kind !== "qr" || !master.pending_session) throw new EdgeError(409, "no_pending", "Начните подключение заново.");
        return useConn(deps, ws, master.pending_session, async (conn, config) => {
          try {
            return await handleLoginToken(deps, ws, ctx, conn, await exportToken(conn, config));
          } catch (error) {
            if (rpcText(error) === "SESSION_PASSWORD_NEEDED") return passwordState(deps, ws, ctx, conn);
            throw error;
          }
        });
      });
    }
    case "connect_password": {
      const password = typeof input.password === "string" ? input.password : "";
      if (!password) throw new EdgeError(400, "bad_request", "Введите облачный пароль.");
      return withLease(deps, ws, async () => {
        const master = await db.master(ws);
        if (!canConnect(ctx, master)) throw new EdgeError(403, "denied", "Подключает аккаунт Owner.");
        if (master?.pending_kind !== "password" || !master.pending_session) throw new EdgeError(409, "no_pending", "Начните подключение заново.");
        return useConn(deps, ws, master.pending_session, async (conn) => {
          const request = await conn.call({ _: "account.getPassword" });
          const srp = await computeSrp(request as PasswordRequest, password);
          const auth = await conn.call({ _: "auth.checkPassword", password: srp });
          return saveAuth(deps, ws, ctx, conn, auth, input.remember === false ? null : password);
        });
      });
    }
    case "connect_phone_send": {
      const phone = typeof input.phone === "string" ? input.phone.replace(/[^\d+]/g, "") : "";
      if (phone.length < 7) throw new EdgeError(400, "bad_request", "Введите номер телефона.");
      return withLease(deps, ws, async () => {
        const master = await db.master(ws);
        if (!canConnect(ctx, master)) throw new EdgeError(403, "denied", "Подключает аккаунт Owner.");
        if (master?.session) throw new EdgeError(409, "already_connected", "Аккаунт уже подключён.");
        return useConn(deps, ws, null, async (conn, config) => {
          const send = () =>
            conn.call({ _: "auth.sendCode", phoneNumber: phone, apiId: config.apiId, apiHash: config.apiHash, settings: { _: "codeSettings" } });
          let res: Tl;
          try {
            res = await send();
          } catch (error) {
            const m = /^(?:PHONE|NETWORK|USER)_MIGRATE_(\d+)$/.exec(rpcText(error));
            if (!m) throw error;
            await conn.changePrimaryDc(Number(m[1]));
            res = await send();
          }
          if (res._ === "auth.sentCodeSuccess") return saveAuth(deps, ws, ctx, conn, res.authorization, null);
          await db.saveMaster(ws, {
            pending_session: await conn.exportSession(),
            pending_kind: "phone",
            pending_phone: phone,
            pending_code_hash: res.phoneCodeHash,
            pending_by: ctx.uid,
            pending_at: new Date(deps.now()).toISOString(),
          });
          const via = res.type?._ === "auth.sentCodeTypeApp" ? "в Telegram" : res.type?._ === "auth.sentCodeTypeSms" ? "по SMS" : "";
          return { state: "code", via };
        });
      });
    }
    case "connect_phone_code": {
      const code = typeof input.code === "string" ? input.code.trim() : "";
      if (!code) throw new EdgeError(400, "bad_request", "Введите код.");
      return withLease(deps, ws, async () => {
        const master = await db.master(ws);
        if (!canConnect(ctx, master)) throw new EdgeError(403, "denied", "Подключает аккаунт Owner.");
        if (master?.pending_kind !== "phone" || !master.pending_session) throw new EdgeError(409, "no_pending", "Начните подключение заново.");
        return useConn(deps, ws, master.pending_session, async (conn) => {
          try {
            const auth = await conn.call({
              _: "auth.signIn",
              phoneNumber: master.pending_phone,
              phoneCodeHash: master.pending_code_hash,
              phoneCode: code,
            });
            return await saveAuth(deps, ws, ctx, conn, auth, null);
          } catch (error) {
            if (rpcText(error) === "SESSION_PASSWORD_NEEDED") return passwordState(deps, ws, ctx, conn);
            throw error;
          }
        });
      });
    }
    case "connect_cancel": {
      const master = await db.master(ws);
      if (!canConnect(ctx, master)) throw new EdgeError(403, "denied", "Подключает аккаунт Owner.");
      if (!master?.session) await db.saveMaster(ws, CLEAR_PENDING);
      return {};
    }
    case "save_password": {
      if (!ctx.owner) throw new EdgeError(403, "denied", "Пароль сохраняет Owner.");
      const password = typeof input.password === "string" ? input.password : "";
      return withLease(deps, ws, async () => {
        const master = await db.master(ws);
        if (!master?.session) throw new EdgeError(409, "not_connected", "Аккаунт не подключён.");
        if (!password) {
          await db.saveMaster(ws, { password: null });
          return { passwordSaved: false };
        }
        return useConn(deps, ws, master.session, async (conn) => {
          const request = await conn.call({ _: "account.getPassword" });
          if (!request?.hasPassword) throw new EdgeError(409, "no_password", "У аккаунта нет облачного пароля — сохранять нечего.");
          const srp = await computeSrp(request as PasswordRequest, password);
          await conn.call({ _: "account.getPasswordSettings", password: srp });
          await db.saveMaster(ws, { password });
          return { passwordSaved: true };
        });
      });
    }
    // --- Служебный бот для файлов технарей ---------------------------------
    case "bot_set": {
      if (!ctx.owner) throw new EdgeError(403, "denied", "Бота подключает Owner.");
      const token = typeof input.token === "string" ? input.token.trim() : "";
      if (!BOT_TOKEN_RE.test(token)) throw new EdgeError(400, "bad_token", "Токен бота выглядит так: 123456789:AAE… — скопируйте его у @BotFather целиком.");
      let me: Tl;
      try {
        me = await deps.botApi(token, "getMe");
      } catch {
        throw new EdgeError(502, "bot_unreachable", "Не удалось проверить токен у Telegram — повторите через минуту.");
      }
      if (!me?.ok || !me.result?.is_bot || !me.result?.username) {
        throw new EdgeError(400, "bad_token", "Токен не подошёл — скопируйте его у @BotFather ещё раз.");
      }
      const botId = Number(me.result.id);
      const botUsername = String(me.result.username);
      return withLease(deps, ws, async () => {
        const master = await db.master(ws);
        if (!master?.session) throw new EdgeError(409, "not_connected", "Сначала подключите аккаунт Telegram к workspace.");
        return useConn(deps, ws, master.session, async (conn) => {
          const resolved = await conn.call({ _: "contacts.resolveUsername", username: botUsername });
          const botUser = ((resolved?.users ?? []) as Tl[]).find((u) => Number(u?.id) === botId);
          if (!botUser) throw new EdgeError(502, "bot_not_found", "Аккаунт workspace не нашёл этого бота в Telegram.");
          const inputUser = { _: "inputUser", userId: botUser.id, accessHash: botUser.accessHash };

          // Тот же бот и группа жива — берём её, иначе заводим новую.
          let chatId: number | null = Number(master.bot_id ?? 0) === botId ? Number(master.courier_chat_id ?? 0) || null : null;
          if (chatId) {
            try {
              const full = await conn.call({ _: "messages.getFullChat", chatId });
              const members = ((full?.fullChat?.participants?.participants ?? []) as Tl[]).map((p) => Number(p?.userId));
              if (!members.includes(botId)) await conn.call({ _: "messages.addChatUser", chatId, userId: inputUser, fwdLimit: 0 });
            } catch {
              chatId = null;
            }
          }
          if (!chatId) {
            const created = await conn.call({ _: "messages.createChat", users: [inputUser], title: COURIER_TITLE });
            chatId = createdChatId(created);
            if (!chatId) throw new EdgeError(502, "courier_failed", "Не удалось создать группу для файлов — повторите.");
            const peer = { _: "inputPeerChat", chatId };
            // Без звука и в архиве: у ОС в списке чатов группа не мешает.
            await conn
              .call({ _: "account.updateNotifySettings", peer: { _: "inputNotifyPeer", peer }, settings: { _: "inputPeerNotifySettings", muteUntil: 2147483647 } })
              .catch(() => undefined);
            await conn.call({ _: "folders.editPeerFolders", folderPeers: [{ _: "inputFolderPeer", peer, folderId: 1 }] }).catch(() => undefined);
          }
          await db.saveMaster(ws, { bot_token: token, bot_id: botId, bot_username: botUsername, courier_chat_id: chatId });
          return { bot: { username: botUsername } };
        });
      });
    }
    case "bot_clear": {
      if (!ctx.owner) throw new EdgeError(403, "denied", "Бота отключает Owner.");
      await db.saveMaster(ws, { bot_token: null, bot_id: null, bot_username: null, courier_chat_id: null });
      return { bot: null };
    }

    case "disconnect": {
      if (!ctx.owner) throw new EdgeError(403, "denied", "Отключает аккаунт Owner.");
      return withLease(deps, ws, async () => {
        const master = await db.master(ws);
        const devices = await db.devices(ws);
        if (master?.session) {
          await useConn(deps, ws, master.session, async (conn) => {
            const hashes = new Set(devices.map((d) => d.auth_hash).filter(Boolean) as string[]);
            const list = await conn.call({ _: "account.getAuthorizations" }).catch(() => null);
            for (const a of (list?.authorizations ?? []) as Tl[]) {
              if (a.current) continue;
              const hash = String(a.hash);
              if (hashes.has(hash) || /^Nova ·/.test(String(a.deviceModel ?? ""))) {
                await conn.call({ _: "account.resetAuthorization", hash: a.hash }).catch(() => undefined);
              }
            }
            await conn.call({ _: "auth.logOut" }).catch(() => undefined);
          }).catch(() => undefined);
        }
        await db.saveMaster(ws, {
          session: null,
          account_id: null,
          account_name: null,
          account_username: null,
          password: null,
          connected_by: null,
          connected_at: null,
          // Группа-курьер принадлежала этому аккаунту — бота подключат заново.
          bot_token: null,
          bot_id: null,
          bot_username: null,
          courier_chat_id: null,
          ...CLEAR_PENDING,
        });
        await db.removeDevices(ws, devices.map((d) => d.marker));
        return { connected: false };
      });
    }

    // --- Устройства полного доступа -------------------------------------
    case "device_accept": {
      if (!ctx.full) throw new EdgeError(403, "denied", "Раздел Telegram вам закрыт.");
      const token = typeof input.token === "string" ? input.token : "";
      const marker = typeof input.marker === "string" ? input.marker.slice(0, 32) : "";
      if (!token || !marker) throw new EdgeError(400, "bad_request", "Нет кода устройства.");
      return withLease(deps, ws, async () => {
        const master = await db.master(ws);
        if (!master?.session) throw new EdgeError(409, "not_connected", "Аккаунт workspace ещё не подключён.");
        return useConn(deps, ws, master.session, async (conn) => {
          const auth = await conn.call({ _: "auth.acceptLoginToken", token: b64ToBytes(token) });
          await db.addDevice(ws, { uid: ctx.uid, marker, auth_hash: auth?.hash != null ? String(auth.hash) : null });
          return { accepted: true, passwordNeeded: false, accountId: master.account_id };
        });
      });
    }
    case "device_srp": {
      if (!ctx.full) throw new EdgeError(403, "denied", "Раздел Telegram вам закрыт.");
      const master = await db.master(ws);
      if (!master?.session) throw new EdgeError(409, "not_connected", "Аккаунт workspace ещё не подключён.");
      if (!master.password) throw new EdgeError(409, "password_not_saved", "Облачный пароль не сохранён — введите его на этом устройстве.");
      const request = tlDecode(input.request, deps.Long) as PasswordRequest;
      const srp = await computeSrp(request, master.password);
      return { answer: tlEncode(srp) };
    }
    case "devices_prune": {
      if (!ctx.owner) throw new EdgeError(403, "denied", "Снимает доступ Owner.");
      return withLease(deps, ws, async () => {
        const master = await db.master(ws);
        const devices = await db.devices(ws);
        const allowed = await db.allowedUids(ws);
        const gone = devices.filter((d) => !allowed.has(d.uid));
        if (!master?.session || !gone.length) return { revoked: 0, fresh: false };
        let revoked = 0;
        let fresh = false;
        const removed: string[] = [];
        await useConn(deps, ws, master.session, async (conn) => {
          // Устройство ищем и по отметке сеанса, и по метке «#…» в названии:
          // после переноса на DC аккаунта отметка сеанса могла смениться.
          const list = await conn.call({ _: "account.getAuthorizations" }).catch(() => null);
          const auths = ((list?.authorizations ?? []) as Tl[]).filter((a) => !a.current);
          for (const d of gone) {
            const hit = auths.filter(
              (a) => (d.auth_hash && String(a.hash) === d.auth_hash) || String(a.deviceModel ?? "").includes(`#${d.marker}`)
            );
            if (!hit.length) {
              removed.push(d.marker);
              continue;
            }
            let allDone = true;
            for (const a of hit) {
              try {
                await conn.call({ _: "account.resetAuthorization", hash: a.hash });
                revoked += 1;
              } catch (error) {
                const text = rpcText(error);
                if (text === "FRESH_RESET_AUTHORISATION_FORBIDDEN") {
                  fresh = true;
                  allDone = false;
                } else if (text !== "HASH_INVALID") throw error;
              }
            }
            if (allDone) removed.push(d.marker);
          }
        });
        await db.removeDevices(ws, removed);
        return { revoked, fresh };
      });
    }

    // --- Технарь: только разрешённые чаты ---------------------------------
    case "tech_chats": {
      if (!ctx.grants.length) return { chats: [] };
      const master = await db.master(ws);
      if (!master?.session) throw new EdgeError(409, "not_connected", "Аккаунт workspace не подключён.");
      return withLease(deps, ws, () =>
        useConn(deps, ws, master.session, async (conn) => {
          const res = await conn.call({
            _: "messages.getPeerDialogs",
            peers: ctx.grants.map((g) => ({ _: "inputDialogPeer", peer: inputPeer(deps, g.peer) })),
          });
          const byPeer = new Map<string, Tl>();
          for (const d of (res?.dialogs ?? []) as Tl[]) byPeer.set(peerKey(d.peer), d);
          const msgs = new Map<string, Tl>();
          for (const m of (res?.messages ?? []) as Tl[]) msgs.set(`${peerKey(m.peerId)}#${m.id}`, m);
          return {
            chats: ctx.grants.map((g) => {
              const key = `${g.peer.type}:${g.peer.id}`;
              const d = byPeer.get(key);
              const top = d ? toTechMessage(msgs.get(`${key}#${d.topMessage}`)) : null;
              return { chatId: g.chatId, title: g.title, unread: d?.unreadCount ?? 0, last: top };
            }),
            // Можно ли технарю отправлять файлы (подключён служебный бот).
            files: Boolean(courierOf(master)),
          };
        })
      );
    }
    case "tech_history": {
      const grant = grantOf(ctx, input.chatId);
      const master = await db.master(ws);
      if (!master?.session) throw new EdgeError(409, "not_connected", "Аккаунт workspace не подключён.");
      const limit = Math.min(Math.max(Number(input.limit) || 40, 1), 60);
      const offsetId = Math.max(Number(input.offsetId) || 0, 0);
      const minId = Math.max(Number(input.minId) || 0, 0);
      return withLease(deps, ws, () =>
        useConn(deps, ws, master.session, async (conn) => {
          const res = await conn.call({
            _: "messages.getHistory",
            peer: inputPeer(deps, grant.peer),
            offsetId,
            offsetDate: 0,
            addOffset: 0,
            limit,
            maxId: 0,
            minId,
            hash: deps.Long.ZERO,
          });
          const names = namesOf(res);
          const group = grant.peer.type !== "user";
          const messages = ((res?.messages ?? []) as Tl[]).map((m) => toTechMessage(m, names, group)).filter(Boolean) as TechMessage[];
          return { messages, done: messages.length < limit && !minId };
        })
      );
    }
    case "tech_media": {
      // Превью фото/видео/файлов пачкой (ids) или один файл целиком (full).
      const grant = grantOf(ctx, input.chatId);
      const full = input.full === true;
      const ids = (Array.isArray(input.ids) ? input.ids : [])
        .map((x: unknown) => Math.trunc(Number(x)))
        .filter((x: number) => Number.isFinite(x) && x > 0)
        .slice(0, full ? 1 : 40);
      if (!ids.length) throw new EdgeError(400, "bad_request", "Нет сообщений.");
      const master = await db.master(ws);
      if (!master?.session) throw new EdgeError(409, "not_connected", "Аккаунт workspace не подключён.");
      const want = `${grant.peer.type}:${grant.peer.id}`;
      return withLease(deps, ws, () =>
        useConn(deps, ws, master.session, async (conn) => {
          const idList = ids.map((id: number) => ({ _: "inputMessageID", id }));
          const res =
            grant.peer.type === "channel"
              ? await conn.call({
                  _: "channels.getMessages",
                  channel: { _: "inputChannel", channelId: Number(grant.peer.id), accessHash: deps.Long.fromString(grant.peer.accessHash ?? "0") },
                  id: idList,
                })
              : await conn.call({ _: "messages.getMessages", id: idList });
          // messages.getMessages ищет по общему ящику аккаунта — берём ТОЛЬКО
          // сообщения этого чата, иначе по чужому id отдали бы чужую переписку.
          const own = ((res?.messages ?? []) as Tl[]).filter((m) => m?._ === "message" && peerKey(m.peerId) === want);
          if (full) {
            const m = own[0];
            const loc = m ? fileLocation(m.media, true) : null;
            if (!loc) throw new EdgeError(404, "no_file", "Файла в этом сообщении нет.");
            if (loc.size > TECH_FILE_MAX) throw new EdgeError(413, "too_big", "Файл больше 20 МБ — его открывают в Telegram у ОС.");
            const bytes = await conn.download(loc.location, { dcId: loc.dcId, fileSize: loc.size || undefined });
            return { id: m.id, name: loc.name, mime: loc.mime, size: bytes.length, data: toBase64(bytes) };
          }
          const thumbs: Record<string, string> = {};
          for (const m of own) {
            const loc = fileLocation(m.media, false);
            if (!loc || loc.size > 512 * 1024) continue;
            try {
              const bytes = await conn.download(loc.location, { dcId: loc.dcId, fileSize: loc.size || undefined });
              thumbs[String(m.id)] = `data:${loc.mime};base64,${toBase64(bytes)}`;
            } catch {
              // Превью не скачалось (ссылка на файл устарела) — покажем значок.
            }
          }
          return { thumbs };
        })
      );
    }
    case "tech_send": {
      const grant = grantOf(ctx, input.chatId);
      const text = typeof input.text === "string" ? input.text.trim() : "";
      if (!text) throw new EdgeError(400, "bad_request", "Пустое сообщение.");
      if (text.length > 4096) throw new EdgeError(400, "too_long", "Сообщение длиннее 4096 знаков.");
      const master = await db.master(ws);
      if (!master?.session) throw new EdgeError(409, "not_connected", "Аккаунт workspace не подключён.");
      return withLease(deps, ws, () =>
        useConn(deps, ws, master.session, async (conn) => {
          await conn.call({ _: "messages.sendMessage", peer: inputPeer(deps, grant.peer), message: text, randomId: deps.randomLong() });
          return { sent: true };
        })
      );
    }
    case "tech_upload_begin": {
      // Что нужно браузеру технаря, чтобы самому загрузить файл ботом.
      const grant = grantOf(ctx, input.chatId);
      const master = await db.master(ws);
      if (!master?.session) throw new EdgeError(409, "not_connected", "Аккаунт workspace не подключён.");
      const bot = courierOf(master);
      if (!bot) {
        throw new EdgeError(409, "no_bot", "Отправка файлов ещё не включена: Owner подключает служебного бота в разделе Telegram («Файлы технарей»).");
      }
      const config = await db.config(ws);
      if (!config) throw new EdgeError(409, "no_config", "Owner ещё не ввёл ключи Telegram (api_id / api_hash).");
      return {
        chatId: grant.chatId,
        apiId: config.apiId,
        apiHash: config.apiHash,
        botToken: bot.token,
        botId: String(bot.id),
        courierChatId: bot.chatId,
        marker: randomMarker(),
        maxBytes: BOT_FILE_MAX,
      };
    }
    case "tech_upload_finish": {
      // Файл уже лежит в группе-курьере — отправить его клиенту от аккаунта.
      const grant = grantOf(ctx, input.chatId);
      const marker = typeof input.marker === "string" ? input.marker : "";
      if (!MARKER_RE.test(marker)) throw new EdgeError(400, "bad_request", "Нет метки файла.");
      const caption = typeof input.caption === "string" ? input.caption.trim() : "";
      if (caption.length > 1024) throw new EdgeError(400, "too_long", "Подпись к файлу длиннее 1024 знаков.");
      const master = await db.master(ws);
      if (!master?.session) throw new EdgeError(409, "not_connected", "Аккаунт workspace не подключён.");
      const bot = courierOf(master);
      if (!bot) throw new EdgeError(409, "no_bot", "Служебный бот для файлов отключён — отправьте файл ещё раз, когда Owner подключит его.");
      const tag = `nova:${marker}`;
      return withLease(deps, ws, () =>
        useConn(deps, ws, master.session, async (conn) => {
          const courier = { _: "inputPeerChat", chatId: bot.chatId };
          let found: Tl = null;
          let fromBot: Tl[] = [];
          // Сообщение бота видно аккаунту сразу, но между дата-центрами бывает задержка.
          for (let attempt = 0; attempt < 4 && !found; attempt++) {
            if (attempt) await deps.sleep(700);
            const res = await conn.call({
              _: "messages.getHistory",
              peer: courier,
              offsetId: 0,
              offsetDate: 0,
              addOffset: 0,
              limit: 30,
              maxId: 0,
              minId: 0,
              hash: deps.Long.ZERO,
            });
            fromBot = ((res?.messages ?? []) as Tl[]).filter((m) => m?._ === "message" && fromUserId(m) === bot.id);
            found = fromBot.find((m) => m.media && String(m.message ?? "").trim() === tag) ?? null;
          }
          if (!found) throw new EdgeError(404, "no_upload", "Файл не дошёл до Telegram — отправьте его ещё раз.");
          const media = reusableMedia(found.media);
          if (!media) throw new EdgeError(415, "bad_media", "Этот файл не переслать — отправьте его документом.");
          await conn.call({ _: "messages.sendMedia", peer: inputPeer(deps, grant.peer), media, message: caption, randomId: deps.randomLong() });
          // Убрать из группы этот файл и забытые (застряли дольше 2 часов).
          const staleBefore = deps.now() / 1000 - 2 * 3600;
          const drop = [found.id, ...fromBot.filter((m) => m.id !== found.id && (m.date ?? 0) < staleBefore).map((m) => m.id)];
          await conn.call({ _: "messages.deleteMessages", id: drop, revoke: true }).catch(() => undefined);
          return { sent: true };
        })
      );
    }
    case "tech_read": {
      const grant = grantOf(ctx, input.chatId);
      const maxId = Math.max(Number(input.maxId) || 0, 0);
      const master = await db.master(ws);
      if (!master?.session) throw new EdgeError(409, "not_connected", "Аккаунт workspace не подключён.");
      return withLease(deps, ws, () =>
        useConn(deps, ws, master.session, async (conn) => {
          if (grant.peer.type === "channel") {
            await conn.call({
              _: "channels.readHistory",
              channel: { _: "inputChannel", channelId: Number(grant.peer.id), accessHash: deps.Long.fromString(grant.peer.accessHash ?? "0") },
              maxId,
            });
          } else {
            await conn.call({ _: "messages.readHistory", peer: inputPeer(deps, grant.peer), maxId });
          }
          return { read: true };
        })
      );
    }
  }
  throw new EdgeError(400, "bad_action", `Неизвестное действие ${action}.`);
}
