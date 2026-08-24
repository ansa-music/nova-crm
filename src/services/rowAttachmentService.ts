import { setDoc } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { ROW_FILES_BUCKET, supabase } from "@/lib/supabase";
import type { RowAttachment } from "@/types";

export const MAX_ROW_FILE_BYTES = 10 * 1024 * 1024;

export const ALLOWED_ROW_FILE_MIMES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "application/pdf",
]);

export function isImageMime(mime: string) {
  return mime.startsWith("image/");
}

export function isPdfMime(mime: string) {
  return mime === "application/pdf";
}

function safeFileName(name: string) {
  const base = name.split(/[/\\]/).pop() || "file";
  const cleaned = base.replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_").replace(/^\.+/, "");
  return (cleaned || "file").slice(0, 80);
}

function newAttachmentId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `att_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export function validateRowFile(file: File): string | null {
  if (file.size > MAX_ROW_FILE_BYTES) return "Файл больше 10 МБ";
  const mime = file.type || "";
  if (!ALLOWED_ROW_FILE_MIMES.has(mime)) return "Можно только jpeg, png, webp, gif, avif или pdf";
  return null;
}

export interface RowAttachmentTarget {
  workspaceId: string;
  pageId: string;
  rowId: string;
  /** When set, metadata is written to the subpage row — still merge-only on attachments. */
  subPageId?: string;
}

function rowRef(target: RowAttachmentTarget) {
  if (target.subPageId) {
    return paths.subPageRow(target.workspaceId, target.pageId, target.subPageId, target.rowId);
  }
  return paths.row(target.workspaceId, target.pageId, target.rowId);
}

/** Merge-update ONLY the attachments field. Never writes cells. */
export async function setRowAttachments(target: RowAttachmentTarget, attachments: RowAttachment[]) {
  if (!db) throw new Error("Firebase не настроен");
  await setDoc(rowRef(target), { attachments }, { merge: true });
}

export async function uploadRowFiles(
  target: RowAttachmentTarget,
  files: File[],
  existing: RowAttachment[] | undefined
): Promise<RowAttachment[]> {
  const next = [...(existing ?? [])];
  for (const file of files) {
    const error = validateRowFile(file);
    if (error) throw new Error(error);

    const id = newAttachmentId();
    const fileName = safeFileName(file.name);
    const path = `${target.workspaceId}/${target.pageId}/${target.rowId}/${id}_${fileName}`;

    const { error: uploadError } = await supabase.storage.from(ROW_FILES_BUCKET).upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || undefined,
    });
    if (uploadError) throw new Error(uploadError.message);

    const { data } = supabase.storage.from(ROW_FILES_BUCKET).getPublicUrl(path);
    const attachment: RowAttachment = {
      id,
      name: file.name,
      mime: file.type,
      size: file.size,
      path,
      publicUrl: data.publicUrl,
      createdAt: Date.now(),
    };
    next.push(attachment);
    try {
      await setRowAttachments(target, next);
    } catch (err) {
      await supabase.storage.from(ROW_FILES_BUCKET).remove([path]);
      throw err;
    }
  }
  return next;
}

export async function deleteRowAttachment(
  target: RowAttachmentTarget,
  attachment: RowAttachment,
  existing: RowAttachment[] | undefined
) {
  const { error } = await supabase.storage.from(ROW_FILES_BUCKET).remove([attachment.path]);
  if (error) throw new Error(error.message);
  const next = (existing ?? []).filter((item) => item.id !== attachment.id);
  await setRowAttachments(target, next);
  return next;
}
