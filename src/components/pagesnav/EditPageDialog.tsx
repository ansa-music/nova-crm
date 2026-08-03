import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/sonner";
import { IconPicker } from "@/components/common/IconPicker";
import { ColorPicker } from "@/components/common/ColorPicker";
import { renamePage, setPageResponsible, updatePageAppearance, updatePagePermissions } from "@/services/pageService";
import { useWorkspace } from "@/hooks/useWorkspace";
import type { PageIconName, WorkspacePage } from "@/types";

interface EditPageDialogProps {
  page: WorkspacePage | null;
  onOpenChange: (open: boolean) => void;
}

export function EditPageDialog({ page, onOpenChange }: EditPageDialogProps) {
  const { members } = useWorkspace();
  const [name, setName] = useState(page?.name ?? "");
  const [icon, setIcon] = useState<PageIconName>(page?.icon ?? "LayoutGrid");
  const [color, setColor] = useState(page?.color ?? "243 75% 59%");
  const [allowedUsers, setAllowedUsers] = useState<string[]>(page?.allowedUsers ?? []);
  const [responsibleUserId, setResponsibleUserId] = useState<string>(page?.responsibleUserId ?? "");
  const [isSaving, setIsSaving] = useState(false);

  if (!page) return null;

  function toggleUser(uid: string) {
    setAllowedUsers((prev) => (prev.includes(uid) ? prev.filter((u) => u !== uid) : [...prev, uid]));
  }

  async function handleSave() {
    if (!page) return;
    setIsSaving(true);
    try {
      if (name.trim() && name !== page.name) await renamePage(page.workspaceId, page.id, name.trim());
      if (icon !== page.icon || color !== page.color) {
        await updatePageAppearance(page.workspaceId, page.id, { icon, color });
      }
      await updatePagePermissions(page.workspaceId, page.id, allowedUsers);
      const nextResponsible = responsibleUserId || null;
      if (nextResponsible !== (page.responsibleUserId ?? null)) {
        await setPageResponsible(page.workspaceId, page.id, nextResponsible);
      }
      toast.success("Страница обновлена");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить изменения");
    } finally {
      setIsSaving(false);
    }
  }

  const owner = members.find((m) => m.role === "owner");

  return (
    <Dialog open={Boolean(page)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Настройки страницы</DialogTitle>
          <DialogDescription>Внешний вид и права доступа для «{page.name}».</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="general">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="general">Общее</TabsTrigger>
            <TabsTrigger value="access">Доступ</TabsTrigger>
          </TabsList>
          <TabsContent value="general" className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-page-name">Название</Label>
              <Input id="edit-page-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Цвет</Label>
              <ColorPicker value={color} onChange={setColor} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Иконка</Label>
              <IconPicker value={icon} onChange={setIcon} color={color} />
            </div>
          </TabsContent>
          <TabsContent value="access" className="flex flex-col gap-4">
            <p className="text-xs text-muted-foreground">
              Owner ({owner?.name ?? "вы"}) всегда видит эту страницу. Остальные — только если отмечены ниже.
            </p>
            <div className="flex max-h-64 flex-col gap-2 overflow-y-auto rounded-lg border border-border p-3">
              {members
                .filter((m) => m.status === "active" && m.role !== "owner")
                .map((m) => (
                  <label key={m.uid} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={allowedUsers.includes(m.uid)} onCheckedChange={() => toggleUser(m.uid)} />
                    <span className="truncate">{m.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{m.email}</span>
                  </label>
                ))}
              {members.filter((m) => m.status === "active" && m.role !== "owner").length === 0 && (
                <p className="text-xs text-muted-foreground">
                  В workspace пока нет других участников — пригласите их на странице «Пользователи».
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5 border-t border-border pt-4">
              <Label className="flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" /> Ответственный за страницу
              </Label>
              <p className="text-xs text-muted-foreground">
                Только этот человек сможет скрывать или снова показывать страницу остальным участникам
                из списка выше — независимо от вас.
              </p>
              <Select value={responsibleUserId || "none"} onValueChange={(v) => setResponsibleUserId(v === "none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Не назначен" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Не назначен</SelectItem>
                  {members
                    .filter((m) => m.status === "active" && m.role !== "owner")
                    .map((m) => (
                      <SelectItem key={m.uid} value={m.uid}>
                        {m.name} ({m.email})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
