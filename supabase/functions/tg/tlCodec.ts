// Объекты TL (с байтами и Long) ↔ JSON для пересылки между браузером и
// функцией. Копия — в src/services/telegram/tlCodec.ts (держать одинаковыми).

export interface LongLike {
  toString(): string;
}

export interface LongCtor {
  fromString(value: string): unknown;
}

function isLong(v: unknown): v is LongLike {
  return (
    !!v &&
    typeof v === "object" &&
    "low" in (v as Record<string, unknown>) &&
    "high" in (v as Record<string, unknown>) &&
    "unsigned" in (v as Record<string, unknown>)
  );
}

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function tlEncode(value: unknown): unknown {
  if (value instanceof Uint8Array) return { $b: b64(value) };
  if (isLong(value)) return { $l: value.toString() };
  if (Array.isArray(value)) return (value as unknown[]).map(tlEncode);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined || typeof v === "function") continue;
      out[k] = tlEncode(v);
    }
    return out;
  }
  return value;
}

export function tlDecode(value: unknown, Long: LongCtor): unknown {
  if (Array.isArray(value)) return value.map((v) => tlDecode(v, Long));
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.$b === "string" && Object.keys(o).length === 1) return unb64(o.$b);
    if (typeof o.$l === "string" && Object.keys(o).length === 1) return Long.fromString(o.$l);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) out[k] = tlDecode(v, Long);
    return out;
  }
  return value;
}

export function bytesToB64(bytes: Uint8Array): string {
  return b64(bytes);
}

export function b64ToBytes(text: string): Uint8Array {
  return unb64(text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "="));
}

export function base64Url(bytes: Uint8Array): string {
  return b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
