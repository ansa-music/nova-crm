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
import { createGrokAppAccount, findDuplicateGrokAppAccount, updateGrokAppAccount } from "@/services/grokAppAccountService";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { displayNameOf } from "@/utils/displayName";
import { autoFormatManualDateTimeInput, formatDateTimeManual, parseDateTimeManual, MANUAL_DATETIME_PLACEHOLDER } from "@/utils/date";
import { grokLoginMethodOf, type GrokLoginMethod } from "@/types/grokAccount";
import { GROK_APP_PROVIDERS, type GrokAppAccount, type GrokAppProvider } from "@/types/grokAppAccount";
import { cn } from "@/utils/cn";

interface GrokAppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: GrokAppAccount | null;
  accounts: GrokAppAccount[];
}

export function GrokAppDialog({ open, onOpenChange, editing, accounts }: GrokAppDialogProps) {
  const { profile } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const { role } = usePermissions();
  const canName = role === "owner" || role === "admin";
  const [provider, setProvider] = useState<GrokAppProvider>(editing?.provider ?? "elevenlabs");
  const [providerOther, setProviderOther] = useState(editing?.providerOther ?? "");
  const [email, setEmail] = useState(editing?.email ?? "");
  const [password, setPassword] = useState(editing?.password ?? "");
  const [phone, setPhone] = useState(editing?.phone ?? "");
  const [note, setNote] = useState(editing?.note ?? "");
  const [nickname, setNickname] = useState(editing?.nickname ?? "");
  const [loginMethod, setLoginMethod] = useState<GrokLoginMethod>(() => grokLoginMethodOf(editing?.loginMethod));
  const [resetAt, setResetAt] = useState(() => formatDateTimeManual(editing?.limitResetAt ?? null));
  const [isSaving, setIsSaving] = useState(false);
  const wasShownRef = useRef(false);

  useEffect(() => {
    if (open && !wasShownRef.current) {
      wasShownRef.current = true;
      setProvider(editing?.provider ?? "elevenlabs");
      setProviderOther(editing?.providerOther ?? "");
      setEmail(editing?.email ?? "");
      setPassword(editing?.password ?? "");
      setPhone(editing?.phone ?? "");
      setNote(editing?.note ?? "");
      setNickname(editing?.nickname ?? "");
      setLoginMethod(grokLoginMethodOf(editing?.loginMethod));
      setResetAt(formatDateTimeManual(editing?.limitResetAt ?? null));
    } else if (!open) {
      wasShownRef.current = false;
    }
  }, [open, editing]);

  const parsedResetAt = parseDateTimeManual(resetAt);
  const dateInvalid = parsedResetAt === undefined;
  const duplicate = findDuplicateGrokAppAccount(accounts, provider, email, editing?.id);

  async function handleSave() {
    if (!activeWorkspaceId || !profile) return;
    if (!email.trim()) {
      toast.error("Введите email или логин");
      return;
    }
    if (provider === "other" && !providerOther.trim()) {
      toast.error("Напишите название сервиса");
      return;
    }
    if (dateInvalid) {
      toast.error(`Дата в формате ${MANUAL_DATETIME_PLACEHOLDER}, или оставьте поле пустым`);
      return;
    }
    if (duplicate) {
      toast.error("Такой аккаунт уже есть у этого сервиса");
      return;
    }
    setIsSaving(true);
    try {
      const actorName = displayNameOf(profile);
      const limitResetAt = parsedResetAt ?? null;
      if (editing) {
        await updateGrokAppAccount(
          activeWorkspaceId,
          editing.id,
          {
            provider,
            providerOther: provider === "other" ? providerOther.trim() : "",
            email: email.trim(),
            password,
            phone: phone.trim(),
            note: note.trim(),
            loginMethod,
            limitResetAt,
            ...(canName ? { nickname: nickname.trim() } : {}),
          },
          profile.uid,
          actorName
        );
      } else {
        await createGrokAppAccount({
          workspaceId: activeWorkspaceId,
          provider,
          providerOther: providerOther.trim(),
          email: email.trim(),
          password,
          phone: phone.trim(),
          note: note.trim(),
          loginMethod,
          limitResetAt,
          ...(canName ? { nickname: nickname.trim() } : {}),
          actorUid: profile.uid,
          actorName,
        });
      }
      toast.success(editing ? "Подписка обновлена" : "Подписка добавлена");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{editing ? "Редактировать подписку" : "Новая подписка"}</DialogTitle>
          <DialogDescription>ElevenLabs, Higgsfield, Suno и другие логины рядом с Grok.</DialogDescription>
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
            <Label>Сервис</Label>
            <div className="flex flex-wrap gap-1">
              {GROK_APP_PROVIDERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setProvider(item.id)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                    provider === item.id
                      ? "border-primary/50 bg-primary/15 text-primary"
                      : "border-border bg-background/40 text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {provider === "other" && (
              <Input value={providerOther} onChange={(e) => setProviderOther(e.target.value)} placeholder="Название сервиса" className="mt-1" />
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Способ входа</Label>
            <LoginMethodPicker value={loginMethod} onChange={setLoginMethod} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Email / логин</Label>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="account@example.com"
              autoFocus
              autoComplete="off"
              className={cn(duplicate && "border-destructive focus-visible:ring-destructive")}
            />
            {duplicate && <p className="text-xs text-destructive">Такой логин уже есть у этого сервиса</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Пароль</Label>
            <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Пароль" autoComplete="off" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Номер телефона</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7 …" autoComplete="off" inputMode="tel" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>План / заметка</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Creator, Pro…" autoComplete="off" />
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
