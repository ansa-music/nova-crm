#!/usr/bin/env node
/**
 * SQL в Supabase без ручного SQL Editor.
 *
 *   node scripts/supabase-sql.mjs apply [--if-configured]   накатить изменённые файлы supabase/migrations/*.sql
 *   node scripts/supabase-sql.mjs status                    что накатано, есть ли строки в Realtime
 *   node scripts/supabase-sql.mjs query "select 1"          разовый запрос (для диагностики)
 *
 * Доступ — ОДНА из переменных окружения:
 *   SUPABASE_ACCESS_TOKEN  личный токен (supabase.com/dashboard/account/tokens) — через Management API, порт 443;
 *   SUPABASE_DB_URL        строка подключения «Session pooler» (Supabase → Connect) — через psql.
 * SUPABASE_PROJECT_REF — проект (по умолчанию xoqivqqcmunavuwpsmsd).
 *
 * Каждый файл миграции повторяемый (create or replace / if not exists), но
 * гонять его на каждом деплое незачем: что уже накатано, помнит таблица
 * `public.nova_sql_applied` (имя файла + sha256). Файл изменился — он
 * накатывается ЦЕЛИКОМ ОДНОЙ транзакцией вместе с отметкой: несколько команд
 * в одном запросе Postgres выполняет одной неявной транзакцией, так что
 * ошибка посередине откатывает весь файл, а не оставляет половину политик.
 * Ошибка — код выхода 1: деплой сайта не пойдёт дальше с кодом, которому
 * нужен ещё не накатанный SQL.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const REF = process.env.SUPABASE_PROJECT_REF || "xoqivqqcmunavuwpsmsd";
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || "";
const DB_URL = process.env.SUPABASE_DB_URL || "";

const LEDGER = `
create table if not exists public.nova_sql_applied (
  file text primary key,
  sha256 text not null,
  applied_at timestamptz not null default now()
);
alter table public.nova_sql_applied enable row level security;
revoke all on public.nova_sql_applied from anon, authenticated;
`;

function lit(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Запрос → строки результата ПОСЛЕДНЕЙ команды. */
async function run(sql) {
  if (TOKEN) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 800)}`);
    try {
      const data = JSON.parse(text);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }
  if (DB_URL) {
    // SQL — через stdin (аргументом длинный файл упёрся бы в лимит длины
    // командной строки), `-1` — весь текст одной транзакцией. Результат
    // читаем как «поле<US>поле» без заголовков.
    try {
      const out = execFileSync("psql", [DB_URL, "-1", "-v", "ON_ERROR_STOP=1", "-X", "-q", "-A", "-t", "-F", "\u001f", "-f", "-"], {
        input: sql,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      return out
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => line.split("\u001f"));
    } catch (error) {
      // В сообщении execFileSync — вся командная строка, то есть и пароль из
      // строки подключения. Наружу отдаём только ответ базы.
      const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr).trim() : "";
      throw new Error(stderr || "psql завершился с ошибкой");
    }
  }
  throw new Error("Нет доступа: задайте SUPABASE_ACCESS_TOKEN или SUPABASE_DB_URL.");
}

/** Значение первого столбца строк — одинаково для обоих способов доступа. */
function firstColumn(rows) {
  return rows.map((row) => (Array.isArray(row) ? row[0] : Object.values(row)[0]));
}

function migrationFiles() {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => {
      const sql = readFileSync(join(MIGRATIONS, name), "utf8");
      return { name, sql, sha: createHash("sha256").update(sql).digest("hex") };
    });
}

async function appliedMap() {
  await run(LEDGER);
  const rows = await run("select file || '=' || sha256 from public.nova_sql_applied");
  return new Map(firstColumn(rows).map((line) => String(line).split("=")));
}

async function realtimeHasRows() {
  const rows = await run(
    "select count(*)::text from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'desk_rows'"
  );
  return String(firstColumn(rows)[0] ?? "0") !== "0";
}

async function apply() {
  const done = await appliedMap();
  let changed = 0;
  // Изменился файл — накатываем и ВСЕ файлы после него: поздние файлы
  // перекрывают функции ранних (`desk_rows_guard` из 20261001_tech_fill.sql
  // заменяет версию из 20260923_desk_rows.sql), и повтор одного раннего файла
  // молча вернул бы старую версию. Файлы повторяемые, лишний накат безопасен.
  let cascade = false;
  for (const file of migrationFiles()) {
    if (!cascade && done.get(file.name) === file.sha) {
      console.log(`  = ${file.name} — уже накатан`);
      continue;
    }
    cascade = true;
    console.log(`  → ${file.name} — накатываю…`);
    await run(
      `${file.sql}\n;\ninsert into public.nova_sql_applied (file, sha256, applied_at) values (${lit(file.name)}, ${lit(file.sha)}, now())\n` +
        "on conflict (file) do update set sha256 = excluded.sha256, applied_at = excluded.applied_at;"
    );
    changed += 1;
    console.log(`  ✓ ${file.name}`);
  }
  console.log(changed ? `Накатано файлов: ${changed}.` : "Всё уже накатано.");
  if (!(await realtimeHasRows())) {
    // Публикацию добавляет сам SQL; если её нет, значит в проекте выключен
    // Realtime — живые строки не придут, работает только страховка по отметке.
    console.log("::warning::Таблица desk_rows не в публикации supabase_realtime — живых событий не будет.");
  } else {
    console.log("Realtime: desk_rows в публикации supabase_realtime.");
  }
}

async function status() {
  const done = await appliedMap();
  for (const file of migrationFiles()) {
    const state = !done.has(file.name) ? "НЕ накатан" : done.get(file.name) === file.sha ? "накатан" : "УСТАРЕЛ (файл изменился)";
    console.log(`  ${file.name}: ${state}`);
  }
  console.log(`Realtime: ${(await realtimeHasRows()) ? "desk_rows в публикации" : "desk_rows НЕ в публикации"}`);
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (!TOKEN && !DB_URL) {
    if (rest.includes("--if-configured")) {
      console.log("::notice::SQL в Supabase не накатан: не задан секрет SUPABASE_ACCESS_TOKEN или SUPABASE_DB_URL.");
      process.exit(0);
    }
    throw new Error("Нет доступа: задайте SUPABASE_ACCESS_TOKEN или SUPABASE_DB_URL.");
  }
  if (command === "apply") await apply();
  else if (command === "status") await status();
  else if (command === "query") console.log(JSON.stringify(await run(rest.join(" ")), null, 2));
  else {
    console.log("Использование: node scripts/supabase-sql.mjs apply|status|query \"SQL\"");
    process.exit(2);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`::error::${message}`);
  process.exit(1);
}
