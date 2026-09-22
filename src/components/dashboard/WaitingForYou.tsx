import { useEffect, useMemo, useState } from "react";
import { Check, Mail, UserPlus, X } from "lucide-react";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { ApproveJoinDialog } from "@/components/members/ApproveJoinDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { refreshWorkspaceMembers, useWorkspace } from "@/hooks/useWorkspace";
import { fetchJoinRequests, rejectJoinRequest, subscribeJoinRequests } from "@/services/joinRequestService";
import { resendInvite } from "@/services/memberService";
import { ROLE_LABELS, type JoinRequest, type WorkspaceMember } from "@/types";
import { timeAgo } from "@/utils/date";

function normalizeEmail(email: string | undefined | null): string {
  return email?.trim().toLowerCase() ?? "";
}

/** Owner-only feed of pending join requests and unused invite stubs. Empty → nothing. */
export function WaitingForYou() {
  const { profile } = useAuth();
  const { activeWorkspaceId, activeWorkspace, members } = useWorkspace();
  const permissions = usePermissions();
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [approveRequest, setApproveRequest] = useState<JoinRequest | null>(null);

  const canShow = permissions.canManageUsers;

  useEffect(() => {
    if (!activeWorkspaceId || !canShow) {
      setJoinRequests([]);
      return;
    }
    return subscribeJoinRequests(activeWorkspaceId, setJoinRequests);
  }, [activeWorkspaceId, canShow]);

  const joins = useMemo(
    () => [...joinRequests].sort((a, b) => a.requestedAt - b.requestedAt),
    [joinRequests]
  );

  const pendingInvites = useMemo(() => {
    const roster = Array.isArray(members) ? members : [];
    const joinEmails = new Set(joins.map((r) => normalizeEmail(r.email)).filter(Boolean));
    const activeEmails = new Set(
      roster
        .filter((m) => m.status === "active")
        .map((m) => normalizeEmail(m.email))
        .filter(Boolean)
    );
    const seen = new Set<string>();
    const invites: WorkspaceMember[] = [];
    for (const member of roster) {
      if (member.status !== "invited") continue;
      const email = normalizeEmail(member.email);
      if (!email || seen.has(email)) continue;
      if (joinEmails.has(email) || activeEmails.has(email)) continue;
      seen.add(email);
      invites.push(member);
    }
    invites.sort((a, b) => a.invitedAt - b.invitedAt);
    return invites;
  }, [members, joins]);

  // Заявку рассмотрели в другом месте — диалог по ней закрываем; иначе он
  // исчез бы вместе с пустым списком и открылся сам при следующей заявке.
  useEffect(() => {
    if (approveRequest && !joins.some((r) => r.uid === approveRequest.uid)) setApproveRequest(null);
  }, [joins, approveRequest]);

  if (!canShow || !activeWorkspaceId) return null;
  if (joins.length === 0 && pendingInvites.length === 0) return null;

  async function afterApprove() {
    await refreshWorkspaceMembers(activeWorkspaceId!);
    try {
      setJoinRequests(await fetchJoinRequests(activeWorkspaceId!));
    } catch {
      // Подписка на заявки и так обновит список.
    }
  }

  async function handleReject(uid: string) {
    try {
      await rejectJoinRequest(activeWorkspaceId!, uid, profile?.uid);
      toast.success("Заявка отклонена");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось отклонить заявку");
    } finally {
      try {
        setJoinRequests(await fetchJoinRequests(activeWorkspaceId!));
      } catch {
        setJoinRequests((prev) => prev.filter((r) => r.uid !== uid));
      }
    }
  }

  async function handleResend(email: string) {
    const normalized = email.trim().toLowerCase();
    if (!normalized) {
      toast.error("Нет email для повторного приглашения");
      return;
    }
    try {
      await resendInvite(activeWorkspaceId!, normalized);
      await refreshWorkspaceMembers(activeWorkspaceId!);
      toast.success("Приглашение обновлено");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось обновить приглашение");
    }
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlus className="h-4 w-4 text-primary" />
          Ждут тебя
          <Badge variant="outline">{joins.length + pendingInvites.length}</Badge>
        </CardTitle>
        <CardDescription>Заявки на вход и приглашения, которые ещё висят. Старые сверху.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {joins.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Хотят вступить</p>
            {joins.map((request) => (
              <div
                key={request.uid}
                className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center"
              >
                <MemberAvatar
                  id={request.uid}
                  name={request.name}
                  photoURL={request.photoURL}
                  className="h-8 w-8"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{request.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{request.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {request.requestedRole ? `${ROLE_LABELS[request.requestedRole]}` : "роль не выбрал"}
                    {request.requestedNick ? ` · ник «${request.requestedNick}»` : ""} · {timeAgo(request.requestedAt)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 sm:shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-11 flex-1 gap-1.5 sm:flex-none"
                    onClick={() => handleReject(request.uid)}
                  >
                    <X className="h-3.5 w-3.5" /> Отклонить
                  </Button>
                  <Button
                    size="sm"
                    className="min-h-11 flex-1 gap-1.5 sm:flex-none"
                    onClick={() => setApproveRequest(request)}
                  >
                    <Check className="h-3.5 w-3.5" /> Одобрить
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {pendingInvites.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Приглашения</p>
            {pendingInvites.map((member) => {
              const emailKey = normalizeEmail(member.email);
              return (
                <div
                  key={emailKey}
                  className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center"
                >
                  <MemberAvatar
                    id={emailKey}
                    name={member.name}
                    nickname={member.nickname}
                    photoURL={member.photoURL}
                    className="h-8 w-8"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{member.email}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {ROLE_LABELS[member.role] ?? member.role} · {timeAgo(member.invitedAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 sm:shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="min-h-11 gap-1.5"
                      onClick={() => handleResend(emailKey)}
                    >
                      <Mail className="h-3.5 w-3.5" /> Отправить снова
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
      {approveRequest && (
        <ApproveJoinDialog
          workspaceId={activeWorkspaceId}
          workspace={activeWorkspace}
          request={approveRequest}
          members={Array.isArray(members) ? members : []}
          approverUid={profile?.uid ?? ""}
          onClose={() => setApproveRequest(null)}
          onApproved={afterApprove}
        />
      )}
    </Card>
  );
}
