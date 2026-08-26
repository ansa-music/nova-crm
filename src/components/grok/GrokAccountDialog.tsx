import { useEffect, useRef, useState } from "react";
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
import { LoginMethodPicker } from "@/components/grok/LoginMethodPicker";
import { createGrokAccount, findDuplicateGrokAccount, updateGrokAccount } from "@/services/grokAccountService";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { displayNameOf } from "@/utils/displayName";
import { autoFormatManualDateTimeInput, formatDateTimeManual, parseDateTimeManual, MANUAL_DATETIME_PLACEHOLDER } from "@/utils/date";
import { grokLoginMethodOf, type GrokLoginMethod } from "@/types/grokAccount";
import { cn } from "@/utils/cn";
import type { GrokAccount } from "@/types";

interface GrokAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: GrokAccount | null;
  accounts: GrokAccount[];
}

export function GrokAccountDialog({ open, onOpenChange, editing, accounts }: GrokAccountDialogProps) {
  const { profile } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const { role } = usePermissions();
  const canName = role === "owner" || role === "admin";
  const [nickname, setNickname] = useState(editing?.nickname ?? "");
  const [email, setEmail] = useState(editing?.email ?? "");
  const [password, setPassword] = useState(editing?.password ?? "");
  const [phone, setPhone] = useState(editing?.phone ?? "");
  const [loginMethod, setLoginMethod] = useState<GrokLoginMethod>(() => grokLoginMethodOf(editing?.loginMethod));
  const [resetAt, setResetAt] = useState(() => formatDateTimeManual(editing?.limitResetAt ?? null));
  const [isSaving, setIsSaving] = useState(false);
  const wasShownRef = useRef(false);

  useEffect(() => {
    if (open && !wasShownRef.current) {
      wasShownRef.current = true;
      setNickname(editing?.nickname ?? "");
      setEmail(editing?.email ?? "");
      setPassword(editing?.password ?? "");
      setPhone(editing?.phone ?? "");
      setLoginMethod(grokLoginMethodOf(editing?.loginMethod));
      setResetAt(formatDateTimeManual(editing?.limitResetAt ?? null));
    } else if (!open) {
      wasShownRef.current = false;
    }
  }, [open, editing]);

  const parsedResetAt = parseDateTimeManual(resetAt);
  const dateInvalid = parsedResetAt === undefined;
  const duplicate = findDuplicateGrokAccount(accounts, email, editing?.id);

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
    if (duplicate) {
      toast.error(`Аккаунт с таким email уже есть в списке`);
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
          {
            email: email.trim(),
            password,
            phone: phone.trim(),
            loginMethod,
            limitResetAt,
            ...(canName ? { nickname: nickname.trim() } : {}),
          },
          profile.uid,
          actorName
        );
      } else {
        await createGrokAccount({
          workspaceId: activeWorkspaceId,
          email: email.trim(),
          password,
          phone: phone.trim(),
          loginMethod,
          limitResetAt,
          ...(canName ? { nickname: nickname.trim() } : {}),
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
          <DialogDescription>Как входить и когда лимит. Видно всем в workspace.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {canName && (
            <div className="flex flex-col gap-1.5">
              <Label>Название</Label>
              <Input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="Никнейм аккаунта"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">Крупно на карточке. Видно всем, меняют только админ и овнер.</p>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label>Способ входа</Label>
            <LoginMethodPicker value={loginMethod} onChange={setLoginMethod} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Email</Label>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="account@example.com"
              autoFocus
              autoComplete="off"
              className={cn(duplicate && "border-destructive focus-visible:ring-destructive")}
            />
            {duplicate && <p className="text-xs text-destructive">Такой email уже есть в списке</p>}
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
            <Label>Номер телефона</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+7 …"
              autoComplete="off"
              inputMode="tel"
            />
            <p className="text-xs text-muted-foreground">Для входа или кода. Можно пустым.</p>
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
          <Button onClick={handleSave} disabled={isSaving || Boolean(duplicate)}>
            {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
            {editing ? "Сохранить" : "Добавить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
