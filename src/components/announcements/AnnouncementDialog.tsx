import { useEffect, useMemo, useRef, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { createAnnouncement, updateAnnouncement } from "@/services/announcementService";
import { resolveNotificationTargets, sendNotification } from "@/services/notificationService";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { displayNameOf } from "@/utils/displayName";
import type { Announcement, AnnouncementPriority, NotificationTargetKind, Role } from "@/types";

interface AnnouncementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: Announcement | null;
}

const PRIORITY_LABELS: Record<AnnouncementPriority, string> = {
  normal: "Обычный",
  important: "Важный",
  urgent: "Срочный",
};

export function AnnouncementDialog({ open, onOpenChange, editing }: AnnouncementDialogProps) {
  const { profile } = useAuth();
  const { activeWorkspaceId, members, pages } = useWorkspace();
  const permissions = usePermissions();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<AnnouncementPriority>("normal");
  const [pinned, setPinned] = useState(false);
  const [notify, setNotify] = useState(false);
  const [target, setTarget] = useState<NotificationTargetKind>("all");
  const [selectedUids, setSelectedUids] = useState<string[]>([]);
  const [targetRole, setTargetRole] = useState<Role>("manager");
  const [isSaving, setIsSaving] = useState(false);
  const wasShownRef = useRef(false);

  // Re-sync ONLY on the closed→open transition, never while already open —
  // same pattern/reasoning as ManageOptionsDialog.tsx. This dialog is
  // mounted once by AnnouncementsPage and just toggles `open`/`editing`, so
  // without this its useState initializers only ever ran on the very first
  // render (while `editing` was still null): every "Редактировать" click
  // opened a BLANK form, and saving it wrote priority: "normal", pinned:
  // false over the real announcement regardless of what it actually held.
  useEffect(() => {
    if (!open) {
      wasShownRef.current = false;
      return;
    }
    if (wasShownRef.current) return;
    wasShownRef.current = true;
    setTitle(editing?.title ?? "");
    setBody(editing?.body ?? "");
    setPriority(editing?.priority ?? "normal");
    setPinned(editing?.pinned ?? false);
    setNotify(false);
    setTarget("all");
    setSelectedUids([]);
    setTargetRole("manager");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const otherMembers = useMemo(
    () => members.filter((m) => m.status === "active" && m.uid !== profile?.uid),
    [members, profile?.uid]
  );

  function toggleSelected(uid: string) {
    setSelectedUids((prev) => (prev.includes(uid) ? prev.filter((u) => u !== uid) : [...prev, uid]));
  }

  async function handleSave() {
    if (!activeWorkspaceId || !profile) return;
    if (!title.trim() || !body.trim()) {
      toast.error("Заполните заголовок и текст");
      return;
    }
    setIsSaving(true);
    try {
      let announcementId: string;
      if (editing) {
        await updateAnnouncement(activeWorkspaceId, editing.id, { title: title.trim(), body: body.trim(), priority, pinned });
        announcementId = editing.id;
      } else {
        const created = await createAnnouncement({
          workspaceId: activeWorkspaceId,
          title: title.trim(),
          body: body.trim(),
          priority,
          pinned,
          authorUid: profile.uid,
          authorName: profile.nickname || profile.name,
          authorPhotoURL: profile.photoURL,
        });
        announcementId = created.id;
      }

      if (notify && permissions.canSendNotifications) {
        const targetUids = resolveNotificationTargets(target, otherMembers, pages, {
          selectedUids,
          role: targetRole,
        });
        await sendNotification(
          {
            workspaceId: activeWorkspaceId,
            title: `Объявление: ${title.trim()}`,
            body: body.trim(),
            priority,
            fromUid: profile.uid,
            fromName: profile.nickname || profile.name,
            relatedAnnouncementId: announcementId,
            target,
          },
          targetUids
        );
      }

      toast.success(editing ? "Объявление обновлено" : "Объявление опубликовано");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить объявление");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Редактировать объявление" : "Новое объявление"}</DialogTitle>
          <DialogDescription>Видно всем участникам workspace.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Заголовок</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например, Обновление регламента" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Текст</Label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="Текст объявления..." />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Приоритет</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as AnnouncementPriority)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PRIORITY_LABELS) as AnnouncementPriority[]).map((p) => (
                  <SelectItem key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={pinned} onCheckedChange={(v) => setPinned(Boolean(v))} />
            Закрепить сверху
          </label>

          {permissions.canSendNotifications && (
            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox checked={notify} onCheckedChange={(v) => setNotify(Boolean(v))} />
                Также отправить уведомление
              </label>
              {notify && (
                <div className="flex flex-col gap-2 pl-6">
                  <Select value={target} onValueChange={(v) => setTarget(v as NotificationTargetKind)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Всем пользователям Workspace</SelectItem>
                      <SelectItem value="selected">Только выбранным</SelectItem>
                      <SelectItem value="role">По роли</SelectItem>
                      <SelectItem value="responsible">Только ответственным</SelectItem>
                    </SelectContent>
                  </Select>

                  {target === "role" && (
                    <Select value={targetRole} onValueChange={(v) => setTargetRole(v as Role)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Только Admin</SelectItem>
                        <SelectItem value="manager">Только технари</SelectItem>
                        <SelectItem value="viewer">Только Viewer</SelectItem>
                      </SelectContent>
                    </Select>
                  )}

                  {target === "selected" && (
                    <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-lg border border-border p-2">
                      {otherMembers.map((m) => (
                        <label key={m.uid} className="flex items-center gap-2 text-sm">
                          <Checkbox checked={selectedUids.includes(m.uid)} onCheckedChange={() => toggleSelected(m.uid)} />
                          {displayNameOf(m)}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
            {editing ? "Сохранить" : "Опубликовать"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
