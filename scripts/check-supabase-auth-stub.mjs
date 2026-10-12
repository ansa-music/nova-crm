// Проверка: подмена `@supabase/auth-js` пустышкой (src/lib/supabaseAuthStub.ts)
// не меняет ни одного запроса к Supabase.
//
// Один и тот же сценарий (чтение/запись строк, rpc, хранилище, realtime-токен)
// собирается esbuild-ом дважды — с настоящим модулем входа и с пустышкой — и
// выполняется с поддельным fetch, который ничего не шлёт в сеть, а записывает
// запросы. Записи обоих прогонов должны совпасть полностью (метод, адрес,
// заголовки, тело). Запуск: node scripts/check-supabase-auth-stub.mjs
import { build } from "esbuild";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const work = mkdtempSync(path.join(tmpdir(), "nova-auth-stub-"));

// Сценарий: два клиента — как в src/lib/supabase.ts и src/lib/supabaseRows.ts.
// `STORAGE_OPTS` подставляется сборкой: старая настройка хранилища или новая.
const scenario = `
import { createClient } from "@supabase/supabase-js";
export async function run(STORAGE_OPTS) {
  const calls = [];
  const fetchMock = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url ?? String(input);
    const headers = {};
    new Headers(init.headers ?? (typeof input === "object" ? input.headers : undefined)).forEach((v, k) => {
      // Версии клиента и служебные заголовки среды не относятся к делу.
      if (!/^(x-client-info|user-agent|x-supabase-client-platform.*|x-supabase-client-runtime.*)$/i.test(k)) headers[k] = v;
    });
    let body = init.body ?? null;
    if (body && typeof body !== "string") body = "[" + (body.constructor?.name ?? typeof body) + "]";
    calls.push({ method: (init.method ?? "GET").toUpperCase(), url, headers, body });
    return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
  };
  const URL_ = "https://example.supabase.co";
  const KEY = "anon-key";
  const rows = createClient(URL_, KEY, { accessToken: async () => "FIREBASE_ID_TOKEN", global: { fetch: fetchMock } });
  const storage = createClient(URL_, KEY, { ...STORAGE_OPTS, global: { fetch: fetchMock } });

  await rows.from("desk_rows").select("*").eq("workspace_id", "W").limit(5);
  await rows.from("desk_rows").upsert({ workspace_id: "W", page_id: "P", tab_id: "", id: "r1", cells: { a: 1 } }, { onConflict: "workspace_id,page_id,tab_id,id" });
  await rows.from("desk_rows").update({ cells: { a: 2 } }).eq("id", "r1");
  await rows.from("desk_rows").delete().eq("id", "r1");
  await rows.rpc("order_write", { p_workspace: "W", p_id: "o1", p_op: "claim", p_args: { on: true } });
  await rows.rpc("nova_schema_version");
  await storage.storage.from("row-files").list("W/P", { limit: 10 });
  await storage.storage.from("row-files").upload("W/P/a.txt", new Blob(["x"], { type: "text/plain" }), { upsert: true });
  await storage.storage.from("row-files").createSignedUrl("W/P/a.txt", 60);
  await storage.storage.from("row-files").remove(["W/P/a.txt"]);
  const publicUrl = storage.storage.from("row-files").getPublicUrl("W/P/a.txt").data.publicUrl;

  // Токен для realtime: у клиента строк — токен Firebase, у хранилища — анонимный ключ.
  const rowsToken = await rows._getAccessToken();
  const storageToken = await storage._getAccessToken();
  let rowsAuthBlocked = false;
  try { rows.auth.getSession; } catch { rowsAuthBlocked = true; }
  const channel = rows.channel("nova:test");
  const channelOk = typeof channel.subscribe === "function";
  await rows.removeAllChannels();
  return { calls, publicUrl, rowsToken, storageToken, rowsAuthBlocked, channelOk };
}
`;
writeFileSync(path.join(work, "scenario.mjs"), scenario);

async function bundle(name, withStub) {
  const outfile = path.join(work, `${name}.mjs`);
  await build({
    entryPoints: [path.join(work, "scenario.mjs")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
    nodePaths: [path.join(root, "node_modules")],
    alias: withStub ? { "@supabase/auth-js": path.join(root, "src/lib/supabaseAuthStub.ts") } : {},
  });
  return (await import(pathToFileURL(outfile).href)).run;
}

const OLD_STORAGE = { auth: { persistSession: false, autoRefreshToken: false } };
const NEW_STORAGE = { accessToken: async () => null };

let failed = 0;
function check(label, a, b) {
  const same = JSON.stringify(a) === JSON.stringify(b);
  if (!same) failed++;
  console.log(`${same ? "ok  " : "FAIL"} ${label}`);
  if (!same) {
    console.log("   было :", JSON.stringify(a).slice(0, 600));
    console.log("   стало:", JSON.stringify(b).slice(0, 600));
  }
}

try {
  const before = await (await bundle("before", false))(OLD_STORAGE);
  const after = await (await bundle("after", true))(NEW_STORAGE);
  console.log(`запросов записано: было ${before.calls.length}, стало ${after.calls.length}`);
  check("число запросов", before.calls.length, after.calls.length);
  before.calls.forEach((call, i) => check(`запрос ${i + 1}: ${call.method} ${call.url.replace("https://example.supabase.co", "")}`, call, after.calls[i]));
  check("публичная ссылка на файл", before.publicUrl, after.publicUrl);
  check("токен realtime у клиента строк (токен Firebase)", before.rowsToken, after.rowsToken);
  check("токен realtime у клиента хранилища (анонимный ключ)", before.storageToken, after.storageToken);
  check("клиент строк не даёт обратиться к auth", before.rowsAuthBlocked, after.rowsAuthBlocked);
  check("канал realtime создаётся", before.channelOk, after.channelOk);
  // Самопроверка: сравнение не пустое — заголовки доступа действительно записаны и различаются у двух клиентов.
  const rowsAuth = after.calls[0]?.headers.authorization;
  const storageAuth = after.calls[6]?.headers.authorization;
  check("строки идут с токеном Firebase", rowsAuth, "Bearer FIREBASE_ID_TOKEN");
  check("хранилище идёт с анонимным ключом", storageAuth, "Bearer anon-key");
  check("ключ проекта есть в каждом запросе", after.calls.every((c) => c.headers.apikey === "anon-key"), true);
  console.log(`\nстарый токен строк: ${before.rowsToken}; хранилища: ${before.storageToken}`);
  console.log(failed === 0 ? "ИТОГ: запросы совпадают полностью" : `ИТОГ: расхождений ${failed}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(failed === 0 ? 0 : 1);
