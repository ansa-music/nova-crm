// SRP для облачного пароля Telegram (2FA) — повтор computeSrpParams из
// @mtcute/core/utils на WebCrypto, чтобы не зависеть от путей пакета в
// Supabase Edge. Проверяется юнит-тестом против самого mtcute.

type Bytes = Uint8Array;

export interface PasswordAlgo {
  _: string;
  salt1: Bytes;
  salt2: Bytes;
  g: number;
  p: Bytes;
}

export interface PasswordRequest {
  currentAlgo?: PasswordAlgo | null;
  srpB?: Bytes | null;
  srpId?: unknown;
}

export interface SrpAnswer {
  _: "inputCheckPasswordSRP";
  srpId: unknown;
  A: Bytes;
  M1: Bytes;
}

const ALGO = "passwordKdfAlgoSHA256SHA256PBKDF2HMACSHA512iter100000SHA256ModPow";

function concat(...parts: Bytes[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function toBig(bytes: Bytes): bigint {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

function toBytes(v: bigint, len: number): Bytes {
  const out = new Uint8Array(len);
  for (let i = len - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  base %= mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    base = (base * base) % mod;
    exp >>= 1n;
  }
  return result;
}

async function sha256(data: Bytes): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

async function pbkdf2(password: Bytes, salt: Bytes, iterations: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", password, "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-512", salt, iterations }, key, 512);
  return new Uint8Array(bits);
}

async function passwordHash(password: string, salt1: Bytes, salt2: Bytes): Promise<Bytes> {
  const SH = (data: Bytes, salt: Bytes) => sha256(concat(salt, data, salt));
  const ph1 = await SH(await SH(new TextEncoder().encode(password), salt1), salt2);
  return SH(await pbkdf2(ph1, salt1, 100000), salt2);
}

/** Ответ на запрос пароля (account.getPassword) другого устройства. `a` — для тестов. */
export async function computeSrp(request: PasswordRequest, password: string, aBytes?: Bytes): Promise<SrpAnswer> {
  const algo = request.currentAlgo;
  if (!algo || algo._ !== ALGO) throw new Error(`Unknown password algo ${algo?._ ?? "none"}`);
  if (!request.srpB || request.srpId == null) throw new Error("SRP_B or SRP_ID missing");
  const g = BigInt(algo.g);
  const gBytes = toBytes(g, 256);
  const p = toBig(algo.p);
  const gB = toBig(request.srpB);
  const a = toBig(aBytes ?? crypto.getRandomValues(new Uint8Array(256)));
  const gA = modPow(g, a, p);
  const gABytes = toBytes(gA, 256);
  const k = toBig(await sha256(concat(algo.p, gBytes)));
  const u = toBig(await sha256(concat(gABytes, request.srpB)));
  const x = toBig(await passwordHash(password, algo.salt1, algo.salt2));
  const v = modPow(g, x, p);
  const kV = (k * v) % p;
  let t = gB - kV;
  if (t < 0n) t += p;
  const sA = modPow(t, a + u * x, p);
  const kA = await sha256(toBytes(sA, 256));
  const hp = await sha256(algo.p);
  const hg = await sha256(gBytes);
  const xor = hp.map((b, i) => b ^ hg[i]);
  const M1 = await sha256(concat(xor, await sha256(algo.salt1), await sha256(algo.salt2), gABytes, request.srpB, kA));
  return { _: "inputCheckPasswordSRP", srpId: request.srpId, A: gABytes, M1 };
}
