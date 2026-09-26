import { removeRowFiles, rowFilePublicUrl, uploadRowFile } from "@/services/storageClient";

export const MAX_ORDER_SOUND_BYTES = 2 * 1024 * 1024;
/** Дольше — это уже не звук уведомления, а песня: мешает работать и съедает трафик. */
export const MAX_ORDER_SOUND_SECONDS = 20;

const EXT_BY_MIME: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
};

function extOf(file: File): string | null {
  const byMime = EXT_BY_MIME[(file.type || "").toLowerCase()];
  if (byMime) return byMime;
  const byName = /\.(mp3|wav|ogg|webm|m4a|aac)$/i.exec(file.name)?.[1];
  return byName ? byName.toLowerCase() : null;
}

export function validateOrderSoundFile(file: File): string | null {
  if (file.size > MAX_ORDER_SOUND_BYTES) return "Файл больше 2 МБ — возьмите короткий звук";
  if (!extOf(file)) return "Нужен аудиофайл: mp3, wav, ogg, m4a";
  return null;
}

function soundId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Свой звук заказа — в тот же бакет `row-files`, под `{workspaceId}/sounds/…`:
 * политики бакета написаны под пути, начинающиеся с id workspace (как у
 * аватарок). Ссылку в документ workspace пишет вызывающий
 * (`updateOrderSound`); прежний файл — `removeOrderSoundFile` после записи.
 */
export async function uploadOrderSoundFile(workspaceId: string, file: File): Promise<{ url: string; path: string }> {
  const error = validateOrderSoundFile(file);
  if (error) throw new Error(error);
  const ext = extOf(file)!;
  const path = `${workspaceId}/sounds/order-${soundId()}.${ext}`;
  const { error: uploadError } = await uploadRowFile(path, file, {
    cacheControl: "86400",
    contentType: file.type || `audio/${ext === "mp3" ? "mpeg" : ext}`,
  });
  if (uploadError) {
    // Бакет с явным списком типов, где нет аудио (см. 20261008b_storage_audio.sql).
    if (/mime type/i.test(uploadError.message)) {
      throw new Error(
        "Хранилище файлов не принимает аудио. Owner: Supabase → Storage → row-files → Edit bucket → Allowed MIME types → добавить audio/*"
      );
    }
    throw new Error(uploadError.message);
  }
  const data = { publicUrl: rowFilePublicUrl(path) };
  return { url: data.publicUrl, path };
}

export async function removeOrderSoundFile(path: string | null | undefined) {
  if (!path) return;
  await removeRowFiles([path]);
}
