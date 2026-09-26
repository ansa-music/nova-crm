import { removeRowFiles, rowFilePublicUrl, uploadRowFile } from "@/services/storageClient";

/**
 * Логотип компании («Конструктор сайта»): бакет `row-files`, путь
 * `{ws}/brand/logo-{id}.{ext}` — политики пускают писать туда только Owner
 * (20261029_brand_storage.sql). Ссылку в `workspace.site.brand` пишет
 * вызывающий; прежний файл — `removeBrandLogo` после записи новой ссылки.
 */

export const MAX_LOGO_BYTES = 512 * 1024;
const LOGO_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

export function validateLogoFile(file: File): string | null {
  if (!LOGO_TYPES[file.type]) return "Логотип — PNG, JPG, WEBP или SVG";
  if (file.size > MAX_LOGO_BYTES) return "Логотип — не больше 512 КБ";
  return null;
}

function logoId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
    : Math.random().toString(36).slice(2, 18);
}

export async function uploadBrandLogo(workspaceId: string, file: File): Promise<{ url: string; path: string }> {
  const error = validateLogoFile(file);
  if (error) throw new Error(error);
  const path = `${workspaceId}/brand/logo-${logoId()}.${LOGO_TYPES[file.type]}`;
  const { error: uploadError } = await uploadRowFile(path, file, { cacheControl: "86400", contentType: file.type });
  if (uploadError) throw new Error(uploadError.message);
  return { url: rowFilePublicUrl(path), path };
}

export async function removeBrandLogo(path: string | null | undefined) {
  if (!path) return;
  await removeRowFiles([path]);
}
