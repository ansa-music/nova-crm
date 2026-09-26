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
import { toast } from "@/components/ui/sonner";
import { IconPicker } from "@/components/common/IconPicker";
import { ColorPicker, COLOR_PRESETS } from "@/components/common/ColorPicker";
import { workspaceSchema, type WorkspaceFormValues } from "@/utils/validation";
import { registerCompany } from "@/services/companyService";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceStore } from "@/store/workspaceStore";
import type { PageIconName } from "@/types";

interface CreateWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateWorkspaceDialog({ open, onOpenChange }: CreateWorkspaceDialogProps) {
  const { profile } = useAuth();
  const setActiveWorkspaceId = useWorkspaceStore((s) => s.setActiveWorkspaceId);
  const [icon, setIcon] = useState<PageIconName>("Building2");
  const [color, setColor] = useState(COLOR_PRESETS[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<WorkspaceFormValues>({
    resolver: zodResolver(workspaceSchema),
    defaultValues: { name: "" },
  });

  async function onSubmit(values: WorkspaceFormValues) {
    if (!profile) return;
    setIsSubmitting(true);
    try {
      // Та же регистрация, что у компаний по коду (SaaS этап 2): id
      // `ws_{uid}_…`, строка в реестре Supabase и строки таблиц сразу там.
      // Без кода — только администратор платформы (этот диалог есть лишь у него).
      const { workspace } = await registerCompany({
        uid: profile.uid,
        email: profile.email,
        ownerName: profile.name,
        companyName: values.name,
        icon,
        color,
        code: null,
      });
      setActiveWorkspaceId(workspace.id);
      toast.success(`Workspace «${workspace.name}» создан`);
      form.reset();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось создать workspace");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Новый workspace</DialogTitle>
          <DialogDescription>
            Отдельное рабочее пространство со своими страницами, сотрудниками и данными.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="workspace-name">Название</Label>
            <Input id="workspace-name" placeholder="Например, Finance" {...form.register("name")} />
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
          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Создать workspace
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
