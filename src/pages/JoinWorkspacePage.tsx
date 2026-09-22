import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Building2, Loader2 } from "lucide-react";
import { JoinRequestForm } from "@/components/members/JoinRequestForm";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { getPublicWorkspaceInfo, submitJoinRequest, subscribeToOwnJoinRequest } from "@/services/joinRequestService";
import { addOwnWorkspaceId } from "@/services/authService";
import type { JoinRequest, JoinRequestRole, Workspace } from "@/types";
import { clearJoinIntent, rememberJoinIntent } from "@/utils/joinIntent";

export default function JoinWorkspacePage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { workspaces, isLoadingWorkspaces } = useWorkspace();
  const [workspace, setWorkspace] = useState<Workspace | null | undefined>(undefined);
  const [ownRequest, setOwnRequest] = useState<JoinRequest | null | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    rememberJoinIntent(workspaceId);
    getPublicWorkspaceInfo(workspaceId).then(setWorkspace).catch(() => setWorkspace(null));
  }, [workspaceId]);

  // If this account is already a member (most importantly: the Owner
  // themselves clicking their own invite link) — never let them go through
  // the request-access flow at all. Approving a join request for someone
  // who's already a member overwrites their existing role, which is
  // catastrophic if that someone happens to be the Owner. Uses the live
  // workspace list (not a possibly-stale profile snapshot) so this is
  // reliable even right after gaining access some other way.
  useEffect(() => {
    if (!workspaceId || isLoadingWorkspaces) return;
    if (workspaces.some((w) => w.id === workspaceId)) {
      clearJoinIntent();
      navigate("/", { replace: true });
    }
  }, [workspaceId, workspaces, isLoadingWorkspaces, navigate]);

  useEffect(() => {
    if (!workspaceId || !profile?.uid) return;
    return subscribeToOwnJoinRequest(workspaceId, profile.uid, (request) => {
      setOwnRequest(request);
      if (request?.status === "approved") {
        addOwnWorkspaceId(profile.uid, workspaceId)
          .then(() => {
            // Give the workspace-list listener a beat to pick up the fresh
            // id before navigating, so the app doesn't land on an empty
            // "create a workspace" screen for a split second.
            setTimeout(() => {
              clearJoinIntent();
              navigate("/", { replace: true });
            }, 400);
          })
          .catch((err) => console.error("Не удалось сохранить workspace в профиле:", err));
      }
    });
  }, [workspaceId, profile?.uid, navigate]);

  async function handleRequestAccess(wish: { role: JoinRequestRole; nick: string }) {
    if (!workspaceId || !profile) return;
    setIsSubmitting(true);
    try {
      await submitJoinRequest(workspaceId, profile.uid, profile.email, profile.name, profile.photoURL, wish);
      toast.success("Заявка отправлена — Тимлид подтвердит роль и ник");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось отправить заявку");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (workspace === undefined) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (workspace === null) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2 bg-background text-center">
        <p className="text-lg font-semibold">Workspace не найден</p>
        <p className="text-sm text-muted-foreground">Проверьте, что ссылка скопирована полностью и без опечаток.</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center bg-background px-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <span
          className="flex h-14 w-14 items-center justify-center rounded-xl"
          style={{ backgroundColor: `hsl(${workspace.color} / 0.15)`, color: `hsl(${workspace.color})` }}
        >
          <Building2 className="h-7 w-7" />
        </span>
        <div>
          <h1 className="text-lg font-semibold">{workspace.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Новые участники приходят без роли: выберите, кем работаете, и Тимлид вас впустит.
          </p>
        </div>

        {ownRequest === undefined ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : ownRequest?.status === "approved" ? (
          <div className="flex items-center gap-2 rounded-lg bg-success/10 px-4 py-2.5 text-sm text-success">
            <Loader2 className="h-4 w-4 animate-spin" /> Доступ открыт, переходим в workspace...
          </div>
        ) : (
          <JoinRequestForm
            workspace={workspace}
            request={ownRequest}
            submitting={isSubmitting}
            onSubmit={(wish) => void handleRequestAccess(wish)}
          />
        )}
      </div>
    </div>
  );
}
