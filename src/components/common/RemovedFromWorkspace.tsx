import { useEffect, useState } from "react";
import { Clock, Loader2, LogOut, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { signOutUser } from "@/firebase/auth";
import { removeOwnWorkspaceId } from "@/services/authService";
import { submitJoinRequest, subscribeToOwnJoinRequest } from "@/services/joinRequestService";
import type { JoinRequest } from "@/types";

/**
 * Аккаунт, которого удалили из участников, всё ещё видит workspace: его id
 * остаётся в `users/{uid}.workspaceIds` (чужой профиль Owner править не
 * может), документ workspace читается любым вошедшим, а участников, столов
 * и прав уже нет. Раньше такой человек попадал в пустую оболочку без единой
 * кнопки. Здесь ему честно сказано, что произошло, и даны три выхода:
 * попросить доступ снова (та же заявка, что и при первом входе — Owner
 * увидит её на «Пользователи», после одобрения экран сам сменится на
 * приложение), убрать workspace из своего списка или выйти.
 */
export function RemovedFromWorkspace() {
  const { profile } = useAuth();
  const { activeWorkspace, activeWorkspaceId, workspaces, setActiveWorkspaceId } = useWorkspace();
  const [request, setRequest] = useState<JoinRequest | null | undefined>(undefined);
  const [busy, setBusy] = useState<"request" | "remove" | "signout" | null>(null);

  useEffect(() => {
    setRequest(undefined);
    if (!activeWorkspaceId || !profile?.uid) return;
    return subscribeToOwnJoinRequest(activeWorkspaceId, profile.uid, setRequest);
  }, [activeWorkspaceId, profile?.uid]);

  const others = workspaces.filter((w) => w.id !== activeWorkspaceId);

  async function handleRequest() {
    if (!activeWorkspaceId || !profile) return;
    setBusy("request");
    try {
      await submitJoinRequest(activeWorkspaceId, profile.uid, profile.email, profile.name, profile.photoURL);
      toast.success("Заявка отправлена");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось отправить заявку");
    } finally {
      setBusy(null);
    }
  }

  async function handleRemove() {
    if (!activeWorkspaceId || !profile) return;
    setBusy("remove");
    try {
      await removeOwnWorkspaceId(profile.uid, activeWorkspaceId);
      setActiveWorkspaceId(others[0]?.id ?? null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось убрать workspace");
      setBusy(null);
    }
  }

  async function handleSignOut() {
    setBusy("signout");
    try {
      await signOutUser();
    } finally {
      setBusy(null);
    }
  }

  const pending = request?.status === "pending";

  return (
    <div className="cyber-grid flex h-screen flex-col items-center justify-center gap-5 bg-background px-4 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
        <UserX className="h-5 w-5" />
      </div>
      <div>
        <p className="eyebrow mb-2 text-primary">Workspace</p>
        <h1 className="display text-2xl">Вас нет среди участников «{activeWorkspace?.name ?? "workspace"}»</h1>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          Аккаунт удалили из workspace или доступ ещё не выдали. Столы и данные закрыты, пока Owner или Тимлид не примут вас снова.
        </p>
      </div>
      <div className="flex w-full max-w-xs flex-col gap-2">
        {pending ? (
          <div className="flex items-center justify-center gap-2 rounded-lg bg-muted px-4 py-2.5 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" /> Заявка отправлена, ждём подтверждения
          </div>
        ) : (
          <Button onClick={() => void handleRequest()} disabled={busy !== null || request === undefined}>
            {busy === "request" && <Loader2 className="h-4 w-4 animate-spin" />}
            {request?.status === "rejected" ? "Запросить доступ ещё раз" : "Запросить доступ"}
          </Button>
        )}
        {others.map((w) => (
          <Button key={w.id} variant="outline" onClick={() => setActiveWorkspaceId(w.id)} disabled={busy !== null}>
            Перейти в «{w.name}»
          </Button>
        ))}
        <Button variant="ghost" className="text-muted-foreground" onClick={() => void handleRemove()} disabled={busy !== null}>
          {busy === "remove" && <Loader2 className="h-4 w-4 animate-spin" />}
          Убрать из моего списка
        </Button>
        <Button variant="ghost" className="gap-1.5 text-muted-foreground" onClick={() => void handleSignOut()} disabled={busy !== null}>
          <LogOut className="h-4 w-4" /> Выйти
        </Button>
      </div>
    </div>
  );
}
