import { useState } from "react";
import { deleteField } from "firebase/firestore";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { saveTechLoadStatusKinds, updateWorkspace } from "@/services/workspaceService";
import { autoTechLoadKind, TECH_LOAD_KIND_LABELS, techLoadKindForOption } from "@/utils/techLoad";
import type { StatusOption, TechLoadKind } from "@/types";

const KINDS: TechLoadKind[] = ["busy", "free", "payment", "rework", "freeze"];

/** Owner-only: how each shared status counts on «Технари». Workspace writes are Owner-only in firestore.rules. */
export function TechLoadStatusDialog({
  workspaceId,
  statusOptions,
  kinds,
  onClose,
}: {
  workspaceId: string;
  statusOptions: StatusOption[];
  kinds: Record<string, TechLoadKind> | undefined;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, TechLoadKind>>(() =>
    Object.fromEntries(statusOptions.map((o) => [o.value, techLoadKindForOption(o, kinds)]))
  );
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      // Only what differs from the automatic guess: statuses nobody touched
      // keep following their names when those rules improve.
      const overrides = Object.fromEntries(
        statusOptions
          .filter((o) => draft[o.value] && draft[o.value] !== autoTechLoadKind(o.label, o.value))
          .map((o) => [o.value, draft[o.value]])
      );
      await saveTechLoadStatusKinds(workspaceId, overrides);
      toast.success("Статусы для «Технари» сохранены");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setSaving(true);
    try {
      await updateWorkspace(workspaceId, {
        techLoadStatusKinds: deleteField() as unknown as Record<string, TechLoadKind>,
        techLoadStatusKindsVersion: deleteField() as unknown as number,
      });
      toast.success("Вернули автоматическое распределение");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сбросить");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Статусы на «Технари»</DialogTitle>
          <DialogDescription>
            Технар «Занят», если в этом месяце у него есть хоть один заказ в статусе «Занят». «Свободен» — заказ
            закрыт. «Ждём оплату», «Переделка» и «Заморозка» не занимают, их число видно отдельно. Заказ без статуса
            не занимает.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 flex-col gap-2">
          {statusOptions.map((option) => (
            <div key={option.value} className="flex min-w-0 items-center gap-3">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: `hsl(${option.color})` }} />
              <span className="min-w-0 flex-1 truncate text-sm">{option.label}</span>
              <Select
                value={draft[option.value]}
                onValueChange={(value) => setDraft((prev) => ({ ...prev, [option.value]: value as TechLoadKind }))}
              >
                <SelectTrigger className="h-8 w-36 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {TECH_LOAD_KIND_LABELS[kind]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={handleReset} disabled={saving || !kinds} title="Вернуть распределение по названиям статусов">
            Сбросить
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" onClick={onClose}>
              Отмена
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              Сохранить
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
