import { supabase, ROW_FILES_BUCKET } from "@/lib/supabase";
import { supabaseRows } from "@/lib/supabaseRows";

/**
 * Файлы бакета `row-files` — по токену Firebase (SaaS этап 4, SQL
 * 20261024_storage_policies.sql).
 *
 * Раньше каждая загрузка шла анонимным ключом, и политики бакета пускали роль
 * anon в папку ЛЮБОЙ компании. Теперь запрос несёт токен человека, и политики
 * `nova_rowfiles_*` пускают только в папку его workspace (аватар — только
 * свой, звук заказа — только Owner).
 *
 * Незаметно для людей: не прошло по токену (SQL не накатан, Storage не принял
 * токен, сеть) — тот же запрос анонимным ключом, как было, и память на 10
 * минут, чтобы не стучаться дважды. Старые anon-политики панели пока живы,
 * поэтому откат работает. Ссылки на файлы — прежние публичные.
 */

const TOKEN_RETRY_MS = 10 * 60_000;
let tokenFailedAt = 0;
let reported = false;

function tokenPathOpen(): boolean {
  return Date.now() - tokenFailedAt > TOKEN_RETRY_MS;
}

function noteTokenFailure(reason: string) {
  tokenFailedAt = Date.now();
  if (!reported) {
    reported = true;
    console.info(`[storage] файлы по токену не прошли (${reason}) — анонимным ключом, как раньше`);
  }
}

/** Как шли последние загрузки — для диагностики. */
export function storageAuthMode(): "token" | "anon" {
  return tokenPathOpen() ? "token" : "anon";
}

export type UploadOptions = { cacheControl?: string; contentType?: string };

/** Загрузить файл; ошибка — `{ message }` последней попытки (как у supabase-js). */
export async function uploadRowFile(
  path: string,
  file: Blob,
  options: UploadOptions = {}
): Promise<{ error: { message: string } | null }> {
  const opts = { cacheControl: options.cacheControl ?? "3600", upsert: false, contentType: options.contentType };
  if (tokenPathOpen()) {
    try {
      const { error } = await supabaseRows.storage.from(ROW_FILES_BUCKET).upload(path, file, opts);
      if (!error) return { error: null };
      // Тип файла и размер бакет отвергнет и анонимно — не повторяем.
      if (/mime type|too large|exceeded|payload/i.test(error.message)) return { error };
      noteTokenFailure(error.message);
    } catch (error) {
      noteTokenFailure(error instanceof Error ? error.message : String(error));
    }
  }
  const { error } = await supabase.storage.from(ROW_FILES_BUCKET).upload(path, file, opts);
  return { error: error ? { message: error.message } : null };
}

/**
 * Удалить файлы. Отказ политики Storage возвращает НЕ ошибку, а пустой
 * список удалённых — поэтому «удалено меньше, чем просили» тоже повод
 * повторить анонимно.
 */
export async function removeRowFiles(paths: string[]): Promise<{ error: { message: string } | null }> {
  const list = paths.filter(Boolean);
  if (!list.length) return { error: null };
  if (tokenPathOpen()) {
    try {
      const { data, error } = await supabaseRows.storage.from(ROW_FILES_BUCKET).remove(list);
      if (!error && (data?.length ?? 0) >= list.length) return { error: null };
      // Файла могло и не быть — это не повод уводить загрузки на анонимный ключ.
      if (error) noteTokenFailure(error.message);
    } catch (error) {
      noteTokenFailure(error instanceof Error ? error.message : String(error));
    }
  }
  const { error } = await supabase.storage.from(ROW_FILES_BUCKET).remove(list);
  return { error: error ? { message: error.message } : null };
}

/** Публичная ссылка — как раньше (бакет публичный, пути с uuid). */
export function rowFilePublicUrl(path: string): string {
  return supabase.storage.from(ROW_FILES_BUCKET).getPublicUrl(path).data.publicUrl;
}
