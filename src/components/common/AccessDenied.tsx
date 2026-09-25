import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ArrowLeft, Home, Lock, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { setActiveRole } from "@/services/memberService";
import { cn } from "@/utils/cn";
import { ROLE_LABELS } from "@/types";

export interface AccessDeniedProps {
  /** Почему закрыто — одной фразой: «Команду ведут Owner и Тимлид». */
  reason: ReactNode;
  /** Заголовок, по умолчанию «Доступ ограничен». */
  title?: string;
  /** Куда вести вместо «На главную». */
  backTo?: { to: string; label: string };
  /** Что сделать, чтобы открылось: «попросите ответственного…». */
  hint?: ReactNode;
  /** Свои действия (например, «Запросить просмотр»). */
  children?: ReactNode;
  className?: string;
}

/**
 * Единый экран «Доступ ограничен» — вместо семи самописных на разных
 * страницах: они разъехались по иконке, кеглю и тому, есть ли выход.
 *
 * Выход есть всегда: «На главную» (или `backTo`). Owner, который смотрит
 * приложение в режиме другой роли, чаще всего упирается сюда именно из-за
 * симуляции — ему предлагается вернуть реальную роль прямо здесь, а не идти
 * искать переключатель в меню аккаунта.
 */
export function AccessDenied({ reason, title = "Доступ ограничен", backTo, hint, children, className }: AccessDeniedProps) {
  const permissions = usePermissions();
  const { profile } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const [restoring, setRestoring] = useState(false);
  // Только настоящий Owner: у остальных симуляции нет, а застрявший
  // `activeRole` у них клиент и так не учитывает.
  const canRestoreRole = permissions.isSimulating && permissions.upkeepOwner;

  async function restoreRole() {
    if (!activeWorkspaceId || !profile) return;
    setRestoring(true);
    try {
      await setActiveRole(activeWorkspaceId, profile.uid, null);
      toast.success("Вернулись к реальной роли");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось вернуть роль");
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className={cn("flex h-full min-h-[60vh] w-full items-center justify-center p-4 sm:p-8", className)}>
      <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-xl border border-border bg-card px-5 py-8 text-center sm:px-8">
        <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/12 text-primary">
          <Lock className="h-5 w-5" />
        </span>
        <div className="flex flex-col gap-1.5">
          <h1 className="font-serif text-[24px] font-light leading-tight tracking-[-0.01em]">{title}</h1>
          <p className="text-sm text-muted-foreground">{reason}</p>
          {hint ? <p className="text-[12.5px] text-muted-foreground">{hint}</p> : null}
          {canRestoreRole ? (
            <p className="text-[12.5px] text-warning">
              Сейчас включён режим «{ROLE_LABELS[permissions.role]}», ваша реальная роль — {ROLE_LABELS[permissions.realRole]}.
            </p>
          ) : null}
        </div>
        {children ? <div className="w-full">{children}</div> : null}
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:justify-center">
          {canRestoreRole ? (
            <Button className="min-h-11 gap-1.5 sm:min-h-9" disabled={restoring} onClick={() => void restoreRole()}>
              <Undo2 className="h-4 w-4" /> Вернуть реальную роль
            </Button>
          ) : null}
          <Button asChild variant={canRestoreRole ? "outline" : "default"} className="min-h-11 gap-1.5 sm:min-h-9">
            <Link to={backTo?.to ?? "/"}>
              {backTo ? <ArrowLeft className="h-4 w-4" /> : <Home className="h-4 w-4" />}
              {backTo?.label ?? "На главную"}
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
