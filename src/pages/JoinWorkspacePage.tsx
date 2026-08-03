import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Building2, Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  getPublicWorkspaceInfo,
  submitJoinRequest,
  subscribeToOwnJoinRequest,
} from "@/services/joinRequestService";
import { addOwnWorkspaceId } from "@/services/authService";
import type { JoinRequest, Workspace } from "@/types";

export default function JoinWorkspacePage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { workspaces, isLoadingWorkspaces } = useWorkspace();
  const [workspace, setWorkspace] = useState<Workspace | null | undefined>(undefined);
  const [ownRequest, setOwnRequest] = useState<JoinRequest | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    getPublicWorkspaceInfo(workspaceId).then(setWorkspace);
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
            setTimeout(() => navigate("/", { replace: true }), 400);
          })
          .catch((err) => console.error("Не удалось сохранить workspace в профиле:", err));
      }
    });
  }, [workspaceId, profile?.uid, navigate]);

  async function handleRequestAccess() {
    if (!workspaceId || !profile) return;
    setIsSubmitting(true);
    try {
      await submitJoinRequest(workspaceId, profile.uid, profile.email, profile.name, profile.photoURL);
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
            Чтобы работать в этом workspace, нужно одобрение от его владельца.
          </p>
        </div>

        {ownRequest?.status === "pending" ? (
          <div className="flex items-center gap-2 rounded-lg bg-muted px-4 py-2.5 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" /> Заявка отправлена, ждём подтверждения
          </div>
        ) : ownRequest?.status === "approved" ? (
          <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Доступ открыт, переходим в workspace...
          </div>
        ) : (
          <Button onClick={handleRequestAccess} disabled={isSubmitting} className="w-full">
            {isSubmitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Запросить доступ
          </Button>
        )}
      </div>
    </div>
  );
}
