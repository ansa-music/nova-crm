import { InputMedia } from "@mtcute/web";

/**
 * Как файл уходит в Telegram — одно правило на ОС (свой вход, tgClient) и
 * технаря (служебный бот, tgTechUpload): видео — видео в исходном качестве с
 * плеером (длительность, размер, кадр-обложка 320 px), фото до 10 МБ — фото
 * (Telegram его сожмёт), остальное и «как файл» — документом без сжатия.
 */

const MB = 1024 * 1024;

/** Длительность, размер и кадр-обложка видео — чтобы Telegram показал его плеером. */
export async function probeVideo(file: File): Promise<{ duration: number; width: number; height: number; thumb: Uint8Array | null } | null> {
  if (typeof document === "undefined") return null;
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.src = url;
    const ok = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 8000);
      video.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve(true);
      };
      video.onerror = () => {
        clearTimeout(timer);
        resolve(false);
      };
    });
    if (!ok) return null;
    const meta = { duration: Math.round(video.duration || 0), width: video.videoWidth, height: video.videoHeight };
    let thumb: Uint8Array | null = null;
    try {
      video.currentTime = Math.min(1, (video.duration || 0) / 2);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 4000);
        video.onseeked = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      const scale = Math.min(1, 320 / Math.max(meta.width || 1, meta.height || 1));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round((meta.width || 320) * scale));
      canvas.height = Math.max(1, Math.round((meta.height || 180) * scale));
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
      if (blob) thumb = new Uint8Array(await blob.arrayBuffer());
    } catch {
      thumb = null;
    }
    return { ...meta, thumb };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Видео, фото или документ — по правилу выше. */
export async function buildInputMedia(file: File, opts: { caption?: string; asDocument?: boolean } = {}) {
  const caption = opts.caption?.trim() || undefined;
  const common = { fileName: file.name, fileMime: file.type || undefined, fileSize: file.size, caption };
  if (!opts.asDocument && file.type.startsWith("video/")) {
    const meta = await probeVideo(file);
    return InputMedia.video(file, {
      ...common,
      supportsStreaming: true,
      ...(meta ? { duration: meta.duration, width: meta.width, height: meta.height } : {}),
      ...(meta?.thumb ? { thumb: meta.thumb } : {}),
    });
  }
  if (!opts.asDocument && file.type.startsWith("image/") && file.size <= 10 * MB) {
    return InputMedia.photo(file, { fileSize: file.size, caption });
  }
  return InputMedia.document(file, common);
}
