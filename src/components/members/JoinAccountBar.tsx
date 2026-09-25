import { useState } from "react";
import { ArrowLeft, Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { signOutUser } from "@/firebase/auth";

/**
 * Низ экрана заявки на вход: под каким аккаунтом человек сейчас и как отсюда
 * уйти (просьба Nurba 25.09.2026: «новый пользователь не может выйти с этого
 * окна, не может подать заявку с другого аккаунта»). «Выйти» разлогинивает и
 * ведёт на вход; ссылка приглашения запомнена (`joinIntent`), поэтому после
 * входа другим аккаунтом человек вернётся на эту же заявку. Если у человека
 * есть другие workspace — «Назад в мои workspace».
 */
export function JoinAccountBar({ email, onBack }: { email: string | null | undefined; onBack?: () => void }) {
  const [leaving, setLeaving] = useState(false);

  async function leave() {
    setLeaving(true);
    try {
      await signOutUser();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось выйти");
      setLeaving(false);
    }
  }

  return (
    <div className="flex w-full flex-col items-center gap-2 border-t border-border pt-4">
      {email ? (
        <p className="max-w-full truncate text-[12px] text-muted-foreground">
          Вы вошли как <span className="text-foreground">{email}</span>
        </p>
      ) : null}
      <div className="flex w-full flex-wrap justify-center gap-2">
        {onBack ? (
          <Button type="button" variant="ghost" className="min-h-11 gap-1.5 sm:min-h-9" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" /> Назад в мои workspace
          </Button>
        ) : null}
        <Button type="button" variant="outline" className="min-h-11 gap-1.5 sm:min-h-9" onClick={() => void leave()} disabled={leaving}>
          {leaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
          Выйти / войти другим аккаунтом
        </Button>
      </div>
    </div>
  );
}
