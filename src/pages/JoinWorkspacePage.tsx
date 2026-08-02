import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { Building2, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import {
  getPublicWorkspaceInfo,
  submitJoinRequest,
  subscribeToOwnJoinRequest,
} from "@/services/joinRequestService";
import type { JoinRequest, Workspace } from "@/types";

export default function JoinWorkspacePage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const { profile } = useAuth();
  const [workspace, setWorkspace] = useState<Workspace | null | undefined>(undefined);
  const [ownRequest, setOwnRequest] = useState<JoinRequest | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    getPublicWorkspaceInfo(workspaceId).then(setWorkspace);
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId || !profile?.uid) return;
    return subscribeToOwnJoinRequest(workspaceId, profile.uid, setOwnRequest);
  }, [workspaceId, profile?.uid]);

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
            <CheckCircle2 className="h-4 w-4" /> Доступ открыт — обновите страницу
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
