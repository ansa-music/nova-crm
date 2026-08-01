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
import { createWorkspace } from "@/services/workspaceService";
import { seedDefaultWorkspacePages } from "@/services/onboardingService";
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
      const workspace = await createWorkspace({
        name: values.name,
        icon,
        color,
        ownerId: profile.uid,
        ownerEmail: profile.email,
        ownerName: profile.name,
      });
      await seedDefaultWorkspacePages(workspace.id, profile.uid);
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
