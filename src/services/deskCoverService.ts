import { removeRowFiles, rowFilePublicUrl, uploadRowFile } from "@/services/storageClient";
import { setPageCover } from "@/services/pageService";

export const MAX_COVER_BYTES = 10 * 1024 * 1024;

export const ALLOWED_COVER_MIMES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

export function validateCoverFile(file: File): string | null {
  if (file.size > MAX_COVER_BYTES) return "Файл больше 10 МБ";
  const mime = file.type || "";
  if (!ALLOWED_COVER_MIMES.has(mime)) return "Можно только jpeg, png или webp";
  return null;
}

function coverId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function coverExt(mime: string) {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

/**
 * Desk cover photo — stored in the existing `row-files` bucket, separate from
 * row `attachments`. Path: `{workspaceId}/covers/{pageId}/{uuid}.ext`
 */
export async function uploadDeskCover(
  workspaceId: string,
  pageId: string,
  file: File,
  previousPath?: string | null
): Promise<{ coverUrl: string; coverPath: string }> {
  const error = validateCoverFile(file);
  if (error) throw new Error(error);

  const id = coverId();
  const path = `${workspaceId}/covers/${pageId}/${id}.${coverExt(file.type)}`;

  const { error: uploadError } = await uploadRowFile(path, file, {
    cacheControl: "3600",
    contentType: file.type || undefined,
  });
  if (uploadError) throw new Error(uploadError.message);

  const data = { publicUrl: rowFilePublicUrl(path) };
  const cover = { coverUrl: data.publicUrl, coverPath: path };

  try {
    await setPageCover(workspaceId, pageId, cover);
  } catch (err) {
    await removeRowFiles([path]);
    throw err;
  }

  if (previousPath && previousPath !== path) {
    void removeRowFiles([previousPath]);
  }

  return cover;
}

export async function removeDeskCover(workspaceId: string, pageId: string, coverPath?: string | null) {
  await setPageCover(workspaceId, pageId, null);
  if (coverPath) {
    void removeRowFiles([coverPath]);
  }
}
