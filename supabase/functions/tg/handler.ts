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
  changePrimaryDc(dcId: number): Promise<void>;
  exportSession(): Promise<string>;
  destroy(): Promise<void>;
}

export interface Deps {
  ctx(token: string, ws: string): Promise<EdgeCtx>;
  db: Db;
  connect(config: { apiId: number; apiHash: string }, session: string | null): Promise<TgConn>;
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

export interface TechMessage {
  id: number;
  out: boolean;
  date: number;
  text: string;
  media: string | null;
  service: boolean;
}

function toTechMessage(m: Tl): TechMessage | null {
  if (!m || (m._ !== "message" && m._ !== "messageService")) return null;
  return {
    id: m.id,
    out: Boolean(m.out),
    date: (m.date ?? 0) * 1000,
    text: m._ === "message" ? (m.message ?? "") : "",
    media: m._ === "message" ? mediaLabel(m.media) : null,
    service: m._ === "messageService",
  };
}

function peerKey(p: Tl): string {
  if (!p) return "";
  if (p._ === "peerUser") return `user:${p.userId}`;
  if (p._ === "peerChat") return `chat:${p.chatId}`;
  if (p._ === "peerChannel") return `channel:${p.channelId}`;
  return "";
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
          const messages = ((res?.messages ?? []) as Tl[]).map(toTechMessage).filter(Boolean) as TechMessage[];
          return { messages, done: messages.length < limit && !minId };
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
