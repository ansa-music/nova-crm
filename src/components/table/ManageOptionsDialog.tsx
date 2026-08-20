import { useEffect, useState } from "react";
import { GripVertical, Loader2, Plus, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/sonner";
import { ColorPicker, COLOR_PRESETS } from "@/components/common/ColorPicker";
import { generateId } from "@/utils/id";
import type { StatusOption } from "@/types";

interface ManageOptionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  options: StatusOption[];
  onSave: (options: StatusOption[]) => Promise<void>;
}

export function ManageOptionsDialog({
  open,
  onOpenChange,
  title,
  description,
  options,
  onSave,
}: ManageOptionsDialogProps) {
  const [draft, setDraft] = useState<StatusOption[]>(options);
  const [isSaving, setIsSaving] = useState(false);

  // Re-sync the working copy every time the dialog opens with fresh data —
  // otherwise a second open in the same session would show stale edits.
  useEffect(() => {
    if (open) setDraft(options);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function addOption() {
    const color = COLOR_PRESETS[draft.length % COLOR_PRESETS.length];
    setDraft((prev) => [...prev, { value: generateId("opt"), label: "", color }]);
  }

  function updateLabel(index: number, label: string) {
    setDraft((prev) => prev.map((o, i) => (i === index ? { ...o, label } : o)));
  }

  function updateColor(index: number, color: string) {
    setDraft((prev) => prev.map((o, i) => (i === index ? { ...o, color } : o)));
  }

  function removeOption(index: number) {
    setDraft((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    const cleaned = draft
      .map((o) => ({ ...o, label: o.label.trim() }))
      .filter((o) => o.label.length > 0);
    setIsSaving(true);
    try {
      await onSave(cleaned);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex max-h-80 flex-col gap-2 overflow-y-auto scrollbar-thin">
          {draft.length === 0 && (
            <p className="py-2 text-sm text-muted-foreground">Пока нет ни одного варианта.</p>
          )}
          {draft.map((opt, index) => (
            <div key={opt.value} className="flex items-center gap-2">
              <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/50" />
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="h-6 w-6 shrink-0 rounded-full ring-1 ring-border transition-transform hover:scale-110"
                    style={{ backgroundColor: `hsl(${opt.color})` }}
                    title="Изменить цвет"
                  />
                </PopoverTrigger>
                <PopoverContent className="w-auto p-3">
                  <ColorPicker value={opt.color} onChange={(color) => updateColor(index, color)} />
                </PopoverContent>
              </Popover>
              <Input
                value={opt.label}
                onChange={(e) => updateLabel(index, e.target.value)}
                placeholder="Название варианта"
                className="flex-1"
              />
              <button
                type="button"
                onClick={() => removeOption(index)}
                className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
                title="Удалить"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>

        <Button variant="outline" size="sm" className="w-fit gap-1.5" onClick={addOption}>
          <Plus className="h-3.5 w-3.5" /> Добавить вариант
        </Button>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Отмена
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
