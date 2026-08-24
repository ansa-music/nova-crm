import { useRef, useState } from "react";
import { FileText, Plus } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/utils/cn";
import {
  deleteRowAttachment,
  isImageMime,
  isPdfMime,
  type RowAttachmentTarget,
  uploadRowFiles,
} from "@/services/rowAttachmentService";
import type { RowAttachment } from "@/types";

export const ROW_FILES_COLUMN_WIDTH = 156;

interface RowFilesCellProps {
  attachments: RowAttachment[] | undefined;
  target: RowAttachmentTarget;
  canEdit: boolean;
}

export function RowFilesCell({ attachments, target, canEdit }: RowFilesCellProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const files = attachments ?? [];
  const images = files.filter((f) => isImageMime(f.mime));
  const pdfs = files.filter((f) => isPdfMime(f.mime));
  const thumbs = images.slice(0, 3);
  const extraImages = images.length - thumbs.length;

  async function addFiles(list: FileList | File[]) {
    if (!canEdit || busy) return;
    const incoming = Array.from(list);
    if (incoming.length === 0) return;
    setBusy(true);
    try {
      await uploadRowFiles(target, incoming, files);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить файл");
    } finally {
      setBusy(false);
    }
  }

  return (
    <td
      className={cn(
        "border-b border-r border-border/40 bg-background px-1.5 group-hover/row:bg-transparent",
        dragOver && canEdit && "bg-primary/10"
      )}
      style={{ width: ROW_FILES_COLUMN_WIDTH, minWidth: ROW_FILES_COLUMN_WIDTH }}
      onDragOver={(e) => {
        if (!canEdit) return;
        e.preventDefault();
        e.stopPropagation();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (!canEdit) return;
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
        void addFiles(e.dataTransfer.files);
      }}
    >
      <div className="flex h-full items-center gap-1">
        {thumbs.map((file) => (
          <a
            key={file.id}
            href={file.publicUrl}
            target="_blank"
            rel="noreferrer"
            title={file.name}
            className="h-7 w-7 shrink-0 overflow-hidden rounded-md border border-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            <img src={file.publicUrl} alt="" className="h-full w-full object-cover" />
          </a>
        ))}
        {extraImages > 0 && (
          <span className="text-[10px] tabular text-muted-foreground">+{extraImages}</span>
        )}
        {pdfs.length > 0 && (
          <a
            href={pdfs[0].publicUrl}
            target="_blank"
            rel="noreferrer"
            title={pdfs.length === 1 ? pdfs[0].name : `${pdfs.length} PDF`}
            className="inline-flex max-w-[64px] items-center gap-0.5 truncate rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-muted-foreground"
            onClick={(e) => e.stopPropagation()}
          >
            <FileText className="h-3 w-3 shrink-0 text-primary" />
            <span className="truncate">{pdfs.length > 1 ? `PDF ${pdfs.length}` : "PDF"}</span>
          </a>
        )}
        {canEdit && (
          <>
            <button
              type="button"
              disabled={busy}
              title="Добавить файл"
              className="ml-auto inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-white/10 text-muted-foreground hover:border-primary/50 hover:text-primary"
              onClick={(e) => {
                e.stopPropagation();
                inputRef.current?.click();
              }}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,image/avif,application/pdf"
              multiple
              className="hidden"
              onChange={(e) => {
                const list = e.target.files;
                e.target.value = "";
                if (list) void addFiles(list);
              }}
            />
          </>
        )}
      </div>
    </td>
  );
}

interface RowAttachmentsPanelProps {
  attachments: RowAttachment[] | undefined;
  target: RowAttachmentTarget | null;
  canEdit: boolean;
}

export function RowAttachmentsPanel({ attachments, target, canEdit }: RowAttachmentsPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const files = attachments ?? [];

  async function addFiles(list: FileList | File[]) {
    if (!canEdit || !target || busy) return;
    const incoming = Array.from(list);
    if (incoming.length === 0) return;
    setBusy(true);
    try {
      await uploadRowFiles(target, incoming, files);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить файл");
    } finally {
      setBusy(false);
    }
  }

  async function remove(file: RowAttachment) {
    if (!canEdit || !target || busy) return;
    setBusy(true);
    try {
      await deleteRowAttachment(target, file, files);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось удалить файл");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="eyebrow mb-3">Вложения</p>
      {canEdit && (
        <button
          type="button"
          disabled={busy || !target}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void addFiles(e.dataTransfer.files);
          }}
          className={cn(
            "mb-4 flex min-h-[88px] w-full flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/5 px-3 py-4 text-center text-sm text-muted-foreground transition-colors",
            dragOver && "border-primary/60 bg-primary/10 text-primary"
          )}
        >
          Перетащи сюда
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/avif,application/pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          const list = e.target.files;
          e.target.value = "";
          if (list) void addFiles(list);
        }}
      />
      <div className="grid grid-cols-2 gap-2">
        {files.map((file) => (
          <div key={file.id} className="group relative overflow-hidden rounded-xl border border-white/10 bg-white/5">
            {isImageMime(file.mime) ? (
              <a href={file.publicUrl} target="_blank" rel="noreferrer">
                <img src={file.publicUrl} alt={file.name} className="aspect-square w-full object-cover" />
              </a>
            ) : (
              <a
                href={file.publicUrl}
                target="_blank"
                rel="noreferrer"
                className="flex aspect-square flex-col items-center justify-center gap-2 p-3 text-center"
              >
                <FileText className="h-7 w-7 text-primary" />
                <span className="line-clamp-2 text-[11px] leading-tight">{file.name}</span>
              </a>
            )}
            {canEdit && (
              <button
                type="button"
                title="Удалить"
                disabled={busy}
                className="absolute right-1.5 top-1.5 rounded-md bg-background/80 px-1.5 py-0.5 text-[10px] text-destructive opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => void remove(file)}
              >
                Удалить
              </button>
            )}
          </div>
        ))}
      </div>
      {files.length === 0 && (
        <p className="text-sm text-muted-foreground">Пока нет файлов</p>
      )}
    </div>
  );
}
