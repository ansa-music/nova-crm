import { useState } from "react";
import { KeyRound, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { changeUserPassword, hasPasswordSignIn, sendResetPasswordEmail } from "@/firebase/auth";
import { getAuthErrorMessage } from "@/utils/firebaseErrors";

const MIN_LENGTH = 6;

/**
 * «Пароль» в «Настройки → Профиль» (просьба Nurba 25.09.2026: «сделай смену
 * пароля рабочей»). Раньше было одно поле «Новый пароль», и Firebase отвечал
 * `requires-recent-login` всем, кто вошёл не сегодня. Теперь:
 * - есть вход по паролю — текущий пароль + новый дважды (подтверждение
 *   личности текущим паролем);
 * - только Google — «задать пароль»: подтверждаем окном Google и добавляем
 *   вход по почте и паролю;
 * - текущий пароль забыт — письмо со ссылкой сброса на свою почту.
 * Firebase Auth не зависит от квоты Firestore — работает и когда база встала.
 */
export function PasswordCard({ email }: { email: string | null | undefined }) {
  const withPassword = hasPasswordSignIn();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = next.length > 0 && next.length < MIN_LENGTH;
  const mismatch = repeat.length > 0 && repeat !== next;
  const canSave = (!withPassword || current.length > 0) && next.length >= MIN_LENGTH && repeat === next && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await changeUserPassword({ currentPassword: withPassword ? current : undefined, newPassword: next });
      toast.success(withPassword ? "Пароль изменён" : "Пароль задан — теперь можно входить и по почте");
      setCurrent("");
      setNext("");
      setRepeat("");
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function sendReset() {
    if (!email) return;
    setSending(true);
    setError(null);
    try {
      await sendResetPasswordEmail(email);
      toast.success("Письмо для сброса отправлено", { description: `${email} — проверьте и «Спам»` });
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-primary" /> Пароль
        </CardTitle>
        <CardDescription>
          {withPassword
            ? "Чтобы сменить пароль, подтвердите текущий."
            : "Вы входите через Google. Можно задать пароль — тогда получится входить и по почте; подтвердить нужно окном Google."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex max-w-md flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {/* Для менеджеров паролей: email-поле рядом, но невидимое. */}
          <input type="email" name="email" autoComplete="username" value={email ?? ""} readOnly hidden />
          {withPassword && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pw-current">Текущий пароль</Label>
              <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pw-new">Новый пароль</Label>
            <Input
              id="pw-new"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              aria-invalid={tooShort || undefined}
            />
            {tooShort && <p className="text-xs text-destructive">Не короче {MIN_LENGTH} символов</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pw-repeat">Повторите новый пароль</Label>
            <Input
              id="pw-repeat"
              type="password"
              autoComplete="new-password"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              aria-invalid={mismatch || undefined}
            />
            {mismatch && <p className="text-xs text-destructive">Пароли не совпадают</p>}
          </div>
          {error && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" className="gap-1.5" disabled={!canSave}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {withPassword ? "Сменить пароль" : "Задать пароль"}
            </Button>
            {withPassword && email && (
              <Button type="button" variant="ghost" className="gap-1.5 text-muted-foreground" onClick={() => void sendReset()} disabled={sending}>
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                Забыли текущий? Письмо для сброса
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
