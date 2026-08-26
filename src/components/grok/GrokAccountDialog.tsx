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
import type { GrokAccount } from "@/types";

interface GrokAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: GrokAccount | null;
}

/** <input type="datetime-local"> works in local wall-clock time with no timezone info — convert both ways via local Date parts, never UTC/ISO. */
function msToLocalInputValue(ms: number | null): string {
  if (ms == null) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputValueToMs(value: string): number | null {
  if (!value) return null;
  const d = new Date(value);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function GrokAccountDialog({ open, onOpenChange, editing }: GrokAccountDialogProps) {
  const { profile } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const [email, setEmail] = useState(editing?.email ?? "");
  const [password, setPassword] = useState(editing?.password ?? "");
  const [resetAt, setResetAt] = useState(() => msToLocalInputValue(editing?.limitResetAt ?? null));
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave() {
    if (!activeWorkspaceId || !profile) return;
    if (!email.trim()) {
      toast.error("Введите email аккаунта");
      return;
    }
    setIsSaving(true);
    try {
      const actorName = displayNameOf(profile);
      const limitResetAt = localInputValueToMs(resetAt);
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
              type="datetime-local"
              value={resetAt}
              onChange={(e) => setResetAt(e.target.value)}
              className="tabular-nums"
            />
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
