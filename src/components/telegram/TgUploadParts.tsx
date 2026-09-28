import { useEffect, useState } from "react";
import { File as FileIcon, Film, RotateCcw, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { TgUpload } from "@/services/telegram/tgClient";
import { cn } from "@/utils/cn";

/**
 * Отправка файла в Telegram — общий вид у ОС (TgChats, свой вход) и технаря
 * (TgTechChats, служебный бот): выбранный файл с подписью и строка прогресса.
 */

export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2).replace(".", ",")} ГБ`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1).replace(".", ",")} МБ`;
  if (n >= 1024) return `${Math.round(n / 1024)} КБ`;
  return `${n} Б`;
}

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h} ч ${m % 60} мин`;
  if (m > 0) return `${m} мин ${s % 60} с`;
  return `${s} с`;
}

export function PendingFile({ file, onCancel, onSend }: { file: File; onCancel: () => void; onSend: (caption: string, asDocument: boolean) => void }) {
  const [caption, setCaption] = useState("");
  const [asDocument, setAsDocument] = useState(false);
  const isImage = file.type.startsWith("image/");
  const isVideo = file.type.startsWith("video/");
  return (
    <div className="space-y-2 border-t border-border p-3">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/[0.12] text-primary">
          {isVideo ? <Film className="h-4 w-4" /> : <FileIcon className="h-4 w-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{file.name}</span>
          <span className="block text-[11px] text-muted-foreground">
            {formatBytes(file.size)}
            {isVideo ? " · уйдёт видео в исходном качестве" : ""}
          </span>
        </span>
        <Button variant="ghost" size="icon" onClick={onCancel} aria-label="Не отправлять">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <Input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Подпись (необязательно)" />
      {isImage && (
        <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <Checkbox checked={asDocument} onCheckedChange={(v) => setAsDocument(v === true)} /> Отправить файлом, без сжатия
        </label>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          Отмена
        </Button>
        <Button onClick={() => onSend(caption, asDocument)} className="gap-1.5">
          <Send className="h-4 w-4" /> Отправить
        </Button>
      </div>
    </div>
  );
}

/** Шаги отправки технаря, кроме самой загрузки (у ОС шагов нет). */
const PHASE_TEXT: Record<"queued" | "prepare" | "deliver", string> = {
  queued: "ждёт предыдущий файл",
  prepare: "готовлю отправку…",
  deliver: "передаю клиенту…",
};

export function UploadRow({
  upload,
  onCancel,
  onDismiss,
  onRetry,
}: {
  upload: TgUpload;
  onCancel: () => void;
  onDismiss: () => void;
  onRetry?: () => void;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (upload.status !== "uploading") return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [upload.status]);
  const pct = upload.size ? upload.sent / upload.size : 0;
  const elapsed = (Date.now() - upload.startedAt) / 1000;
  const speed = elapsed > 1 ? upload.sent / elapsed : 0;
  const left = speed > 0 ? (upload.size - upload.sent) / speed : null;
  const step = upload.phase && upload.phase !== "upload" ? PHASE_TEXT[upload.phase] : null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="flex items-center gap-2 text-[12px]">
        <span className="min-w-0 flex-1 truncate font-medium">{upload.fileName}</span>
        {upload.status === "uploading" ? (
          <>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {step ?? (
                <>
                  {Math.round(pct * 100)}% · {formatBytes(upload.sent)} из {formatBytes(upload.size)}
                  {left !== null && pct > 0.01 ? ` · ещё ${formatDuration(left)}` : ""}
                </>
              )}
            </span>
            {upload.phase !== "deliver" && (
              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onCancel}>
                Отменить
              </Button>
            )}
          </>
        ) : (
          <>
            <span
              className={cn(
                "min-w-0 shrink text-right",
                upload.status === "done" ? "text-success" : upload.status === "error" ? "text-destructive" : "text-muted-foreground"
              )}
            >
              {upload.status === "done" ? "Отправлено" : upload.status === "cancelled" ? "Отменено" : upload.error}
            </span>
            {upload.status === "error" && upload.canRetry && onRetry && (
              <Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1 px-2" onClick={onRetry}>
                <RotateCcw className="h-3.5 w-3.5" /> Повторить
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onDismiss} aria-label="Убрать">
              <X className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
      {upload.status === "uploading" && (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full bg-primary transition-[width] duration-300", step && upload.phase !== "deliver" && "animate-pulse")}
            style={{ width: `${upload.phase === "deliver" ? 100 : Math.round(pct * 100)}%` }}
          />
        </div>
      )}
      {upload.status === "uploading" && <p className="mt-1 text-[11px] text-muted-foreground">Не закрывайте вкладку, пока файл уходит. По другим страницам Nova ходить можно.</p>}
    </div>
  );
}
