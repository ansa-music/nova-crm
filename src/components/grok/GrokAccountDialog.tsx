import { useState } from "react";
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
import { createGrokAccount, updateGrokAccount } from "@/services/grokAccountService";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useAuth } from "@/hooks/useAuth";
import { displayNameOf } from "@/utils/displayName";
import { autoFormatManualDateTimeInput, formatDateTimeManual, parseDateTimeManual, MANUAL_DATETIME_PLACEHOLDER } from "@/utils/date";
import { cn } from "@/utils/cn";
import type { GrokAccount } from "@/types";

interface GrokAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: GrokAccount | null;
}

export function GrokAccountDialog({ open, onOpenChange, editing }: GrokAccountDialogProps) {
  const { profile } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const [email, setEmail] = useState(editing?.email ?? "");
  const [password, setPassword] = useState(editing?.password ?? "");
  const [resetAt, setResetAt] = useState(() => formatDateTimeManual(editing?.limitResetAt ?? null));
  const [isSaving, setIsSaving] = useState(false);

  const parsedResetAt = parseDateTimeManual(resetAt);
  const dateInvalid = parsedResetAt === undefined;

  async function handleSave() {
    if (!activeWorkspaceId || !profile) return;
    if (!email.trim()) {
      toast.error("Введите email аккаунта");
      return;
    }
    if (dateInvalid) {
      toast.error(`Дата в формате ${MANUAL_DATETIME_PLACEHOLDER}, или оставьте поле пустым`);
      return;
    }
    setIsSaving(true);
    try {
      const actorName = displayNameOf(profile);
      const limitResetAt = parsedResetAt ?? null;
      if (editing) {
        await updateGrokAccount(
          activeWorkspaceId,
          editing.id,
          { email: email.trim(), password, limitResetAt },
          profile.uid,
          actorName
        );
      } else {
        await createGrokAccount({
          workspaceId: activeWorkspaceId,
          email: email.trim(),
          password,
          limitResetAt,
          actorUid: profile.uid,
          actorName,
        });
      }
      toast.success(editing ? "Аккаунт обновлён" : "Аккаунт добавлен");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить аккаунт");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{editing ? "Редактировать аккаунт" : "Новый аккаунт Grok"}</DialogTitle>
          <DialogDescription>Видно и редактируется всеми участниками workspace.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Email</Label>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="account@example.com"
              autoFocus
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Пароль</Label>
            <Input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Пароль"
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Лимит восстановится</Label>
            <Input
              value={resetAt}
              onChange={(e) => setResetAt(autoFormatManualDateTimeInput(e.target.value))}
              inputMode="numeric"
              placeholder={MANUAL_DATETIME_PLACEHOLDER}
              className={cn("tabular-nums", dateInvalid && "border-destructive focus-visible:ring-destructive")}
            />
            <p className={cn("text-xs text-muted-foreground", dateInvalid && "text-destructive")}>
              {dateInvalid
                ? `Формат: ${MANUAL_DATETIME_PLACEHOLDER}`
                : `Формат: ${MANUAL_DATETIME_PLACEHOLDER} — оставьте пустым, если лимита нет`}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
            {editing ? "Сохранить" : "Добавить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
