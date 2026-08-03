import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/hooks/useAuth";
import { updateUserDoc, syncNicknameToMemberships } from "@/services/authService";

export function NicknamePrompt() {
  const { profile } = useAuth();
  const [value, setValue] = useState(profile?.name ?? "");
  const [isSaving, setIsSaving] = useState(false);

  if (!profile || profile.nickname) return null;

  async function handleSave() {
    const nickname = value.trim();
    if (!nickname) {
      toast.error("Введите отображаемое имя");
      return;
    }
    if (nickname.length > 30) {
      toast.error("Слишком длинно — до 30 символов");
      return;
    }
    setIsSaving(true);
    try {
      await updateUserDoc(profile!.uid, { nickname });
      if (profile?.workspaceIds?.length) {
        await syncNicknameToMemberships(profile.uid, profile.workspaceIds, nickname);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open>
      <DialogContent className="sm:max-w-sm" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Придумайте отображаемое имя</DialogTitle>
          <DialogDescription>
            Оно будет видно другим участникам вместо email — например «Nurba», «Alihan», «Manager1».
          </DialogDescription>
        </DialogHeader>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Ваш никнейм"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
          }}
        />
        <Button onClick={handleSave} disabled={isSaving} className="w-full">
          {isSaving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          Сохранить
        </Button>
      </DialogContent>
    </Dialog>
  );
}
