// Supabase Edge Function `tg` — главный вход Telegram workspace на сервере.
// Логика — handler.ts; здесь только Deno, база и mtcute.
//
// Деплой: `supabase functions deploy tg --no-verify-jwt` (шаг в deploy.yml).
// Токен в запросе — ID-токен Firebase: его проверяет сама база, когда
// функция зовёт tg_edge_ctx с этим токеном (Third-party Auth → Firebase).

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
// mtcute: сначала пакет под Deno, иначе веб-вариант (оба — на WebSocket/TCP).
// ---------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
type Mt = any;
let mtModule: Promise<{ mod: Mt; runtime: string }> | null = null;

function loadMtcute() {
  if (!mtModule) {
    mtModule = (async () => {
      try {
        const mod = await import("jsr:@mtcute/deno@0.32");
        return { mod, runtime: "mtcute-deno" };
      } catch (error) {
        console.warn("[tg] @mtcute/deno не загрузился, беру @mtcute/web", error);
        const mod = await import("npm:@mtcute/web@0.32.3");
        return { mod, runtime: "mtcute-web" };
      }
    })();
  }
  return mtModule;
}

async function connect(config: { apiId: number; apiHash: string }, session: string | null): Promise<TgConn> {
  const { mod } = await loadMtcute();
  const client = new mod.TelegramClient({
    apiId: config.apiId,
    apiHash: config.apiHash,
    storage: new mod.MemoryStorage(),
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
  const { mod, runtime } = await loadMtcute().catch((error) => {
    console.error("[tg] mtcute не загрузился", error);
    return { mod: null, runtime: "none" };
  });
  if (!mod && input.action !== "status") {
    return Response.json({ ok: false, error: "no_mtcute", message: "Сервер Telegram не запустился (библиотека не загрузилась)." }, { status: 500, headers: CORS });
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
      Long: mod?.Long ?? { fromString: (s: string) => s, ZERO: 0 },
      randomLong: () => {
        const b = crypto.getRandomValues(new Uint32Array(2));
        return new mod.Long(b[0], b[1]);
      },
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: () => Date.now(),
      holderId: () => crypto.randomUUID(),
      runtime,
    },
    token,
    input
  );
  return Response.json(result.body, { status: result.status, headers: CORS });
});
