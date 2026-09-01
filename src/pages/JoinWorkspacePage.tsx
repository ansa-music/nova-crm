import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Building2, Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  getPublicWorkspaceInfo,
  selfJoinWorkspace,
  submitJoinRequest,
  subscribeToOwnJoinRequest,
} from "@/services/joinRequestService";
import { addOwnWorkspaceId } from "@/services/authService";
import type { JoinRequest, Workspace } from "@/types";
import { clearJoinIntent, rememberJoinIntent } from "@/utils/joinIntent";

export default function JoinWorkspacePage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { workspaces, isLoadingWorkspaces } = useWorkspace();
  const [workspace, setWorkspace] = useState<Workspace | null | undefined>(undefined);
  const [ownRequest, setOwnRequest] = useState<JoinRequest | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [autoJoinFailed, setAutoJoinFailed] = useState(false);
  const autoJoinAttemptedRef = useRef(false);

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

  // Instant join: the workspace has autoApproveJoins on, so skip the
  // request-and-wait flow entirely — create the member record the moment
  // we know who's asking, no click needed. Guarded by a ref (not just
  // state) so a re-render mid-flight — e.g. StrictMode's double-invoke, or
  // `workspace`/`profile` settling on different ticks — can never fire a
  // second concurrent attempt; selfJoinWorkspace is separately idempotent
  // (returns the existing doc if one already exists) as a second layer.
  useEffect(() => {
    if (!workspaceId || !workspace?.autoApproveJoins || !profile?.uid) return;
    if (isLoadingWorkspaces || workspaces.some((w) => w.id === workspaceId)) return;
    if (autoJoinAttemptedRef.current) return;
    autoJoinAttemptedRef.current = true;
    selfJoinWorkspace(workspaceId, profile.uid, profile.email, profile.name, profile.photoURL)
      .then(() => addOwnWorkspaceId(profile.uid, workspaceId))
      .then(() => {
        // Same brief delay as the approved-request path below, for the same
        // reason: give the workspace-list listener a beat to pick up the
        // fresh id before navigating in.
        setTimeout(() => {
          clearJoinIntent();
          navigate("/", { replace: true });
        }, 400);
      })
      .catch((error) => {
        console.error("Не удалось выполнить мгновенный вход:", error);
        toast.error("Не удалось войти автоматически — отправьте запрос вручную");
        autoJoinAttemptedRef.current = false;
        setAutoJoinFailed(true);
      });
  }, [workspaceId, workspace?.autoApproveJoins, profile, isLoadingWorkspaces, workspaces, navigate]);

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

  async function handleRequestAccess() {
    if (!workspaceId || !profile) return;
    setIsSubmitting(true);
    try {
      await submitJoinRequest(workspaceId, profile.uid, profile.email, profile.name, profile.photoURL);
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

  // Instant join is on and hasn't failed — never show "Запросить доступ" at
  // all, just the brief loading beat while the effect above lets them in.
  // If it does fail (e.g. a rules deploy lag), autoJoinFailed flips and we
  // fall through to the normal request-and-wait card below as a safety net.
  if (workspace.autoApproveJoins && !autoJoinFailed) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-background px-4 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Входим в «{workspace.name}»...</p>
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
          <div className="flex items-center gap-2 rounded-lg bg-success/10 px-4 py-2.5 text-sm text-success">
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
