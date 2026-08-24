import { useEffect, useState } from "react";
import { GripVertical, Loader2, Plus, X } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/sonner";
import { ColorPicker, COLOR_PRESETS } from "@/components/common/ColorPicker";
import { generateId } from "@/utils/id";
import { DEFAULT_STATUS_OPTIONS, ensureDoneStatus } from "@/utils/columnOptions";
import { cn } from "@/utils/cn";
import type { StatusOption } from "@/types";

function releaseBodyScrollLock() {
  document.body.style.pointerEvents = "";
  document.body.style.removeProperty("pointer-events");
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
}

interface ManageOptionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  options: StatusOption[];
  onSave: (options: StatusOption[]) => Promise<void>;
  /** Owner-only editing. When false the sheet is read-only (or should not be opened). */
  canEdit?: boolean;
  ensureDone?: boolean;
}

export function ManageOptionsDialog({
  open,
  onOpenChange,
  title,
  description,
  options,
  onSave,
  canEdit = true,
  ensureDone = false,
}: ManageOptionsDialogProps) {
  const [draft, setDraft] = useState<StatusOption[]>(() => ensureDoneStatus(options.length ? options : DEFAULT_STATUS_OPTIONS));
  const [isSaving, setIsSaving] = useState(false);
  const shown = open && canEdit;

  useEffect(() => {
    if (!shown) {
      releaseBodyScrollLock();
      return;
    }
    const next = ensureDone
      ? ensureDoneStatus(options.length ? options : DEFAULT_STATUS_OPTIONS)
      : (options.length ? options : []);
    setDraft(next);
  }, [shown, options, ensureDone]);

  useEffect(() => {
    if (!shown) return;
    return () => {
      releaseBodyScrollLock();
    };
  }, [shown]);

  function close() {
    onOpenChange(false);
    requestAnimationFrame(releaseBodyScrollLock);
  }

  function addOption() {
    if (!canEdit) return;
    const color = COLOR_PRESETS[draft.length % COLOR_PRESETS.length];
    setDraft((prev) => [...prev, { value: generateId("opt"), label: "", color }]);
  }

  function updateLabel(index: number, label: string) {
    if (!canEdit) return;
    setDraft((prev) => prev.map((o, i) => (i === index ? { ...o, label } : o)));
  }

  function updateColor(index: number, color: string) {
    if (!canEdit) return;
    setDraft((prev) => prev.map((o, i) => (i === index ? { ...o, color } : o)));
  }

  function removeOption(index: number) {
    if (!canEdit) return;
    setDraft((prev) => prev.filter((_, i) => i !== index));
  }

  function moveOption(index: number, dir: -1 | 1) {
    if (!canEdit) return;
    const next = index + dir;
    if (next < 0 || next >= draft.length) return;
    setDraft((prev) => {
      const copy = [...prev];
      const tmp = copy[index];
      copy[index] = copy[next];
      copy[next] = tmp;
      return copy;
    });
  }

  async function handleSave() {
    if (!canEdit) {
      close();
      return;
    }
    const cleaned = draft
      .map((o) => ({ ...o, label: o.label.trim() }))
      .filter((o) => o.label.length > 0);
    setIsSaving(true);
    try {
      await onSave(ensureDone ? ensureDoneStatus(cleaned) : cleaned);
      close();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog
      modal
      open={shown}
      onOpenChange={(next) => {
        if (!next) close();
        else onOpenChange(true);
      }}
    >
      <DialogPortal>
        <DialogOverlay
          className="pointer-events-auto"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        />
        <DialogPrimitive.Content
          onPointerDownOutside={(e) => {
            if (e.target === e.currentTarget) close();
          }}
          onEscapeKeyDown={() => close()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className={cn(
            "glass-float animate-glass-pop fixed left-[50%] top-[50%] z-[110] grid w-[calc(100%-2rem)] max-w-lg max-h-[min(90dvh,36rem)] translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto rounded-md p-6 hud-frame"
          )}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="flex max-h-80 flex-col gap-2 overflow-y-auto overscroll-contain scrollbar-thin">
            {draft.length === 0 && (
              <p className="py-2 text-sm text-muted-foreground">Пока нет ни одного варианта.</p>
            )}
            {draft.map((opt, index) => (
              <div key={opt.value} className="flex items-center gap-2">
                {canEdit && (
                  <button
                    type="button"
                    className="shrink-0 rounded p-1 text-muted-foreground/50 hover:bg-accent hover:text-foreground"
                    title="Порядок"
                    onClick={() => moveOption(index, index === 0 ? 1 : -1)}
                  >
                    <GripVertical className="h-4 w-4" />
                  </button>
                )}
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      disabled={!canEdit}
                      className="h-6 w-6 shrink-0 rounded-full ring-1 ring-border transition-transform hover:scale-110 disabled:opacity-70"
                      style={{ backgroundColor: `hsl(${opt.color})` }}
                      title="Изменить цвет"
                    />
                  </PopoverTrigger>
                  {canEdit && (
                    <PopoverContent className="w-auto p-3">
                      <ColorPicker value={opt.color} onChange={(color) => updateColor(index, color)} />
                    </PopoverContent>
                  )}
                </Popover>
                <Input
                  value={opt.label}
                  onChange={(e) => updateLabel(index, e.target.value)}
                  placeholder="Название варианта"
                  className="flex-1"
                  readOnly={!canEdit}
                  disabled={!canEdit}
                />
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => removeOption(index)}
                    className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
                    title="Удалить"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {canEdit && (
            <Button variant="outline" size="sm" className="w-fit gap-1.5" onClick={addOption}>
              <Plus className="h-3.5 w-3.5" /> Добавить вариант
            </Button>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={isSaving}>
              {canEdit ? "Отмена" : "Закрыть"}
            </Button>
            {canEdit && (
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                Сохранить
              </Button>
            )}
          </DialogFooter>
          <DialogPrimitive.Close
            className="absolute right-4 top-4 rounded-md opacity-60 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring"
            onClick={close}
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Закрыть</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
