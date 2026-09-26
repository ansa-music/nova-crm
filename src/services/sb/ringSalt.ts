import { supabaseRows } from "@/lib/supabaseRows";
import { isSbMissingError } from "@/services/sb/sbCollections";

/**
 * Соль тем «звонков» Realtime (SaaS этап 4, SQL 20261023_tenants.sql:
 * `rows_workspaces.ring_salt`).
 *
 * Звонки идут открытым broadcast-каналом анонимного ключа — ключ публичный, и
 * посторонний, зная id workspace или стола, мог слушать тему
 * `nova:{ws}:…` / `rows-ring:{ws}:{стол}` и видеть «там что-то поменяли».
 * Соль читает только участник (политика `rows_workspaces_read`), и тема
 * `nova:{ws}~{соль}:…` постороннему недоступна.
 *
 * Переход без заметных перемен: слушаем ОБЕ темы (прежняя пуста, когда в неё
 * никто не звонит, — слушать её безвредно), звоним в обе до
 * RING_SALT_TRANSITION_END (вкладки на старом коде слышат прежнюю), потом —
 * только в солёную. Соли нет (SQL не накатан, человека нет в копии прав,
 * сеть) — прежняя тема, как было.
 */

/** До этого момента звоним и в прежние темы — вкладки на старом коде их слушают. */
export const RING_SALT_TRANSITION_END = Date.UTC(2026, 9, 5);

const RETRY_MS = 5 * 60_000;

type Entry = { salt: string | null; loading: boolean; failedAt: number; missing: boolean; waiters: Set<(salt: string) => void> };
const entries = new Map<string, Entry>();

let loader: (workspaceId: string) => Promise<string | null> = loadFromSupabase;

/** Для проверок: подменить чтение соли (null — соли нет). */
export function setRingSaltLoader(next: ((workspaceId: string) => Promise<string | null>) | null) {
  loader = next ?? loadFromSupabase;
  entries.clear();
}

async function loadFromSupabase(workspaceId: string): Promise<string | null> {
  const { data, error } = await supabaseRows
    .from("rows_workspaces")
    .select("ring_salt")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  const salt = (data as { ring_salt?: unknown } | null)?.ring_salt;
  return typeof salt === "string" && /^[0-9a-f]{16,64}$/.test(salt) ? salt : null;
}

function entryOf(workspaceId: string): Entry {
  let e = entries.get(workspaceId);
  if (!e) {
    e = { salt: null, loading: false, failedAt: 0, missing: false, waiters: new Set() };
    entries.set(workspaceId, e);
  }
  return e;
}

function ensure(workspaceId: string, e: Entry) {
  if (e.salt || e.loading || e.missing || !workspaceId) return;
  if (e.failedAt && Date.now() - e.failedAt < RETRY_MS) return;
  e.loading = true;
  loader(workspaceId)
    .then((salt) => {
      e.loading = false;
      if (!salt) {
        e.failedAt = Date.now();
        return;
      }
      e.salt = salt;
      const waiters = [...e.waiters];
      e.waiters.clear();
      for (const w of waiters) w(salt);
    })
    .catch((error) => {
      e.loading = false;
      e.failedAt = Date.now();
      if (isSbMissingError(error)) e.missing = true;
    });
}

/** Соль, если уже известна (и заодно запросить её, если нет). */
export function ringSaltOf(workspaceId: string): string | null {
  const e = entryOf(workspaceId);
  ensure(workspaceId, e);
  return e.salt;
}

/** Позвать `cb`, когда соль станет известна (сразу — если уже). Возвращает отписку. */
export function whenRingSalt(workspaceId: string, cb: (salt: string) => void): () => void {
  const e = entryOf(workspaceId);
  if (e.salt) {
    cb(e.salt);
    return () => {};
  }
  e.waiters.add(cb);
  ensure(workspaceId, e);
  return () => {
    e.waiters.delete(cb);
  };
}

/** Workspace из темы `nova:{ws}:…` / `rows-ring:{ws}:…`. */
export function workspaceOfTopic(topic: string): string | null {
  const parts = topic.split(":");
  return parts.length >= 3 && parts[1] ? parts[1] : null;
}

/** Солёная тема: `nova:{ws}:x` → `nova:{ws}~{соль}:x`. */
export function saltedTopic(topic: string, salt: string): string {
  const parts = topic.split(":");
  if (parts.length < 3 || !parts[1]) return topic;
  parts[1] = `${parts[1]}~${salt}`;
  return parts.join(":");
}

/** Куда звонить сейчас: солёная тема, до конца перехода — и прежняя. */
export function ringTargets(topic: string, now = Date.now()): string[] {
  const ws = workspaceOfTopic(topic);
  const salt = ws ? ringSaltOf(ws) : null;
  if (!salt) return [topic];
  const salted = saltedTopic(topic, salt);
  return now < RING_SALT_TRANSITION_END ? [salted, topic] : [salted];
}
