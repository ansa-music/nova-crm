import { ROW_FILES_BUCKET, supabase } from "@/lib/supabase";
import { syncPhotoToMemberships, updateUserDoc } from "@/services/authService";

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

export const ALLOWED_AVATAR_MIMES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

export function validateAvatarFile(file: File): string | null {
  if (file.size > MAX_AVATAR_BYTES) return "Файл больше 5 МБ";
  if (!ALLOWED_AVATAR_MIMES.has(file.type || "")) return "Можно только jpeg, png или webp";
  return null;
}

function avatarId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function avatarExt(mime: string) {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

/**
 * Личная аватарка — ОДНА на человека и никак не связана с обложкой стола
 * (`deskCoverService`): обложка описывает стол, аватарка — самого человека и
 * едет за ним во все workspace, где он состоит.
 *
 * Файл всё же кладётся под `{workspaceId}/avatars/…`, а не в корень бакета:
 * политики `row-files` написаны под существующие пути, которые все
 * начинаются с id workspace, и путь вне этой формы мог бы молча упереться в
 * отказ политики. Где физически лежит файл — деталь хранения; «общей»
 * аватарку делает то, что ссылка пишется в `users/{uid}` и оттуда
 * разъезжается по всем member-документам.
 */
export async function uploadUserAvatar(input: {
  uid: string;
  /** Куда положить файл — любой workspace, где человек состоит. */
  workspaceId: string;
  /** Все workspace человека: ссылка синхронизируется в каждый member-документ. */
  workspaceIds: string[];
  file: File;
  previousPath?: string | null;
}): Promise<{ photoURL: string; photoPath: string }> {
  const error = validateAvatarFile(input.file);
  if (error) throw new Error(error);

  const path = `${input.workspaceId}/avatars/${input.uid}/${avatarId()}.${avatarExt(input.file.type)}`;
  const { error: uploadError } = await supabase.storage.from(ROW_FILES_BUCKET).upload(path, input.file, {
    cacheControl: "3600",
    upsert: false,
    contentType: input.file.type || undefined,
  });
  if (uploadError) throw new Error(uploadError.message);

  const { data } = supabase.storage.from(ROW_FILES_BUCKET).getPublicUrl(path);
  const photoURL = data.publicUrl;

  try {
    await updateUserDoc(input.uid, { photoURL, photoPath: path });
  } catch (err) {
    // Профиль не записался — файл в бакете никому не нужен. Как в
    // uploadDeskCover: за собой убираем, иначе копятся осиротевшие картинки.
    await supabase.storage.from(ROW_FILES_BUCKET).remove([path]);
    throw err;
  }

  // Member-документы — уже best-effort: профиль записан, аватарка у человека
  // есть, и отказ в одном workspace не должен рушить всю операцию.
  await syncPhotoToMemberships(input.uid, input.workspaceIds, photoURL);

  if (input.previousPath && input.previousPath !== path) {
    void supabase.storage.from(ROW_FILES_BUCKET).remove([input.previousPath]);
  }

  return { photoURL, photoPath: path };
}

/** Убирает аватарку: снова буквы на цветном фоне (`MemberAvatar` рисует их сам). */
export async function removeUserAvatar(input: {
  uid: string;
  workspaceIds: string[];
  photoPath?: string | null;
}) {
  await updateUserDoc(input.uid, { photoURL: null, photoPath: null });
  await syncPhotoToMemberships(input.uid, input.workspaceIds, null);
  if (input.photoPath) {
    void supabase.storage.from(ROW_FILES_BUCKET).remove([input.photoPath]);
  }
}
