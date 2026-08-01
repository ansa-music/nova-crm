import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/components/ui/sonner";
import { IconPicker } from "@/components/common/IconPicker";
import { ColorPicker, COLOR_PRESETS } from "@/components/common/ColorPicker";
import { pageSchema, type PageFormValues } from "@/utils/validation";
import { createPage } from "@/services/pageService";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import type { PageColumn, PageIconName } from "@/types";

interface CreatePageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const BLANK_COLUMNS: Omit<PageColumn, "id">[] = [
  { key: "name", label: "Название", type: "text", width: 220, order: 0 },
  { key: "status", label: "Статус", type: "status", width: 150, order: 1, statusOptions: [
    { value: "todo", label: "К выполнению", color: "240 4% 46%" },
    { value: "active", label: "В работе", color: "38 92% 50%" },
    { value: "done", label: "Готово", color: "142 71% 45%" },
  ] },
  { key: "note", label: "Примечание", type: "text", width: 220, order: 2 },
];

export function CreatePageDialog({ open, onOpenChange }: CreatePageDialogProps) {
  const { profile } = useAuth();
  const { activeWorkspaceId, pages, members } = useWorkspace();
  const [icon, setIcon] = useState<PageIconName>("LayoutGrid");
  const [color, setColor] = useState(COLOR_PRESETS[2]);
  const [allowedUsers, setAllowedUsers] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<PageFormValues>({
    resolver: zodResolver(pageSchema),
    defaultValues: { name: "" },
  });

  function toggleUser(uid: string) {
    setAllowedUsers((prev) => (prev.includes(uid) ? prev.filter((u) => u !== uid) : [...prev, uid]));
  }

  async function onSubmit(values: PageFormValues) {
    if (!profile || !activeWorkspaceId) return;
    setIsSubmitting(true);
    try {
      await createPage({
        workspaceId: activeWorkspaceId,
        name: values.name,
        icon,
        color,
        columns: BLANK_COLUMNS,
        allowedUsers,
        createdBy: profile.uid,
        order: pages.length,
      });
      toast.success(`Страница «${values.name}» создана`);
      form.reset();
      setAllowedUsers([]);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось создать страницу");
    } finally {
      setIsSubmitting(false);
    }
  }

  const otherMembers = members.filter((m) => m.status === "active" && m.uid !== profile?.uid);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Новая страница</DialogTitle>
          <DialogDescription>Таблица с настраиваемыми столбцами внутри текущего workspace.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="page-name">Название</Label>
            <Input id="page-name" placeholder="Например, Задачи" {...form.register("name")} />
            {form.formState.errors.name && (
              <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Цвет</Label>
            <ColorPicker value={color} onChange={setColor} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Иконка</Label>
            <IconPicker value={icon} onChange={setIcon} color={color} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Кому дать доступ (кроме вас — вы Owner и видите всё)</Label>
            <div className="flex max-h-40 flex-col gap-2 overflow-y-auto rounded-lg border border-border p-3">
              {otherMembers.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  В workspace пока нет других участников — доступ можно выдать позже на странице «Пользователи».
                </p>
              )}
              {otherMembers.map((m) => (
                <label key={m.uid} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={allowedUsers.includes(m.uid)} onCheckedChange={() => toggleUser(m.uid)} />
                  <span className="truncate">{m.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{m.email}</span>
                </label>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Создать страницу
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
