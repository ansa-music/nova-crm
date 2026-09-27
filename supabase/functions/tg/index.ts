// Supabase Edge Function `tg` — главный вход Telegram workspace на сервере.
// Логика — handler.ts; здесь только Deno, база и mtcute.
//
// Деплой: `supabase functions deploy tg --no-verify-jwt` (шаг в deploy.yml).
// Токен в запросе — ID-токен Firebase: его проверяет сама база, когда
// функция зовёт tg_edge_ctx с этим токеном (Third-party Auth → Firebase).

import * as mt from "npm:@mtcute/web@0.32.3";
import { handle, type Db, type DeviceRow, type EdgeCtx, type MasterRow, type TgConn } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ---------------------------------------------------------------------
// mtcute: веб-вариант (WebSocket). Пакет под Deno (jsr:@mtcute/deno) сборка
// Supabase не принимает — тянет `node:sqlite`. Модуль шифрования (wasm) берём
// с CDN по явному адресу: искать файл внутри npm-пакета сборке не нужно.
// Платформа — своя: в Deno у navigator нет onLine, и веб-платформа сочла бы
// себя «без сети».
// ---------------------------------------------------------------------

// Версия — та, что берёт @mtcute/web 0.32.3 (`^0.32.0`, новее нет): клей JS и wasm обязаны совпасть.
const WASM_URLS = [
  "https://cdn.jsdelivr.net/npm/@mtcute/wasm@0.32.0/mtcute.wasm",
  "https://unpkg.com/@mtcute/wasm@0.32.0/mtcute.wasm",
];
let wasmModule: Promise<WebAssembly.Module> | null = null;

/** Скомпилированный модуль, а не байты: из байтов `WebAssembly.instantiate` вернул бы {module, instance}. */
function loadWasm(): Promise<WebAssembly.Module> {
  if (!wasmModule) {
    wasmModule = (async () => {
      let last: unknown = null;
      for (const url of WASM_URLS) {
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`wasm ${res.status} ${url}`);
          return await WebAssembly.compile(await res.arrayBuffer());
        } catch (error) {
          last = error;
        }
      }
      throw last;
    })();
    wasmModule.catch(() => {
      wasmModule = null;
    });
  }
  return wasmModule;
}

class EdgePlatform extends mt.WebPlatform {
  override getDeviceModel() {
    return "Supabase Edge";
  }
  override isOnline() {
    return true;
  }
  override onNetworkChanged() {
    return () => undefined;
  }
}

async function connect(config: { apiId: number; apiHash: string }, session: string | null): Promise<TgConn> {
  const wasmInput = await loadWasm();
  const client = new mt.TelegramClient({
    apiId: config.apiId,
    apiHash: config.apiHash,
    storage: new mt.MemoryStorage(),
    crypto: new mt.WebCryptoProvider({ wasmInput }),
    platform: new EdgePlatform(),
    disableUpdates: true,
    initConnectionOptions: {
      deviceModel: "Nova · сервер workspace",
      systemVersion: "Supabase Edge",
      appVersion: "Nova CRM",
      langCode: "ru",
      systemLangCode: "ru",
    },
    logLevel: 1,
  });
  if (session) await client.importSession(session, true);
  return {
    call: (request) => client.call(request),
    download: (location, opts) => client.downloadAsBuffer(location, { dcId: opts.dcId, fileSize: opts.fileSize }),
    changePrimaryDc: (dcId) => client.changePrimaryDc(dcId),
    exportSession: () => client.exportSession(),
    destroy: () => client.destroy(),
  };
}

// ---------------------------------------------------------------------
// База: service role для главного входа, токен человека — для прав.
// ---------------------------------------------------------------------

async function rest(path: string, init: RequestInit & { key?: string; token?: string } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("apikey", init.key ?? SERVICE_KEY);
  headers.set("Authorization", `Bearer ${init.token ?? SERVICE_KEY}`);
  if (init.body) headers.set("Content-Type", "application/json");
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers });
}

async function restJson<T>(path: string, init: RequestInit & { key?: string; token?: string } = {}): Promise<T> {
  const res = await rest(path, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`db ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

class DenyError extends Error {}

async function ctxOf(token: string, ws: string): Promise<EdgeCtx> {
  const res = await rest("rpc/tg_edge_ctx", {
    method: "POST",
    key: ANON_KEY,
    token,
    body: JSON.stringify({ p_workspace: ws }),
  });
  const text = await res.text();
  if (!res.ok) throw new DenyError(text.slice(0, 200));
  const data = JSON.parse(text);
  return {
    uid: String(data.uid),
    owner: data.owner === true,
    full: data.full === true,
    grants: Array.isArray(data.grants) ? data.grants : [],
  };
}

const enc = encodeURIComponent;

const db: Db = {
  async master(ws) {
    const rows = await restJson<MasterRow[]>(`tg_master?workspace_id=eq.${enc(ws)}&select=*`);
    return rows[0] ?? null;
  },
  async saveMaster(ws, patch) {
    await restJson(`tg_master?on_conflict=workspace_id`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ workspace_id: ws, ...patch, updated_at: new Date().toISOString() }),
    });
  },
  async devices(ws) {
    return restJson<DeviceRow[]>(`tg_devices?workspace_id=eq.${enc(ws)}&select=uid,marker,auth_hash`);
  },
  async addDevice(ws, row) {
    await restJson(`tg_devices?on_conflict=workspace_id,uid,marker`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ workspace_id: ws, ...row }),
    });
  },
  async removeDevices(ws, markers) {
    if (!markers.length) return;
    const list = markers.map((m) => `"${m.replace(/"/g, "")}"`).join(",");
    await restJson(`tg_devices?workspace_id=eq.${enc(ws)}&marker=in.(${enc(list)})`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  },
  async allowedUids(ws) {
    const [access, owners] = await Promise.all([
      restJson<{ uid: string }[]>(`tg_access?workspace_id=eq.${enc(ws)}&select=uid`),
      restJson<{ uid: string }[]>(`rows_members?workspace_id=eq.${enc(ws)}&role=eq.owner&select=uid`),
    ]);
    const members = new Set(
      (await restJson<{ uid: string }[]>(`rows_members?workspace_id=eq.${enc(ws)}&select=uid`)).map((r) => r.uid)
    );
    const out = new Set<string>();
    for (const r of access) if (members.has(r.uid)) out.add(r.uid);
    for (const r of owners) out.add(r.uid);
    return out;
  },
  async config(ws) {
    const rows = await restJson<{ api_id: number; api_hash: string }[]>(`tg_config?workspace_id=eq.${enc(ws)}&select=api_id,api_hash`);
    return rows[0] ? { apiId: Number(rows[0].api_id), apiHash: rows[0].api_hash } : null;
  },
  async lease(ws, holder, ttlMs) {
    return restJson<boolean>("rpc/tg_srv_lease", {
      method: "POST",
      body: JSON.stringify({ p_workspace: ws, p_holder: holder, p_ttl_ms: ttlMs }),
    });
  },
  async release(ws, holder) {
    await restJson("rpc/tg_srv_release", { method: "POST", body: JSON.stringify({ p_workspace: ws, p_holder: holder }) });
  },
};

// ---------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return new Response("method", { status: 405, headers: CORS });
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  let input: Record<string, unknown> = {};
  try {
    input = await req.json();
  } catch {
    /* пусто */
  }
  const result = await handle(
    {
      ctx: async (t, ws) => {
        try {
          return await ctxOf(t, ws);
        } catch (error) {
          if (error instanceof DenyError) {
            const { EdgeError } = await import("./handler.ts");
            throw new EdgeError(403, "denied", "Нет доступа к Telegram этого workspace.");
          }
          throw error;
        }
      },
      db,
      connect,
      Long: mt.Long,
      randomLong: () => {
        const b = crypto.getRandomValues(new Uint32Array(2));
        return new mt.Long(b[0], b[1]);
      },
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: () => Date.now(),
      holderId: () => crypto.randomUUID(),
      runtime: "mtcute-web",
    },
    token,
    input
  );
  return Response.json(result.body, { status: result.status, headers: CORS });
});
