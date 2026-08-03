import { useEffect, useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy, Link2, Mail, ShieldCheck, Trash2, X } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/components/ui/sonner";
import { InviteMemberForm } from "@/components/members/InviteMemberForm";
import { RoleSelect } from "@/components/members/RoleSelect";
import { changeMemberRole, removeMember, resendInvite } from "@/services/memberService";
import { toggleUserPageAccess } from "@/services/pageService";
import { approveJoinRequest, rejectJoinRequest, subscribeToJoinRequests } from "@/services/joinRequestService";
import { PAGE_ICON_MAP } from "@/utils/pageIcons";
import { timeAgo } from "@/utils/date";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { usePermissions } from "@/hooks/usePermissions";
import type { JoinRequest, PageIconName } from "@/types";

export default function UsersPage() {
  const { profile } = useAuth();
  const { activeWorkspaceId, members, pages } = useWorkspace();
  const permissions = usePermissions();
  const [expandedUid, setExpandedUid] = useState<string | null>(null);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    if (!activeWorkspaceId || !permissions.canManageWorkspace) return;
    return subscribeToJoinRequests(activeWorkspaceId, setJoinRequests);
  }, [activeWorkspaceId, permissions.canManageWorkspace]);

  if (!permissions.canManageWorkspace) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <ShieldCheck className="h-8 w-8 text-muted-foreground" />
        <p className="text-lg font-semibold">Доступ ограничен</p>
        <p className="text-sm text-muted-foreground">Управление пользователями доступно только Owner.</p>
      </div>
    );
  }

  if (!activeWorkspaceId) return null;

  const joinLink = `${window.location.origin}/join/${activeWorkspaceId}`;

  async function handleCopyLink() {
    await navigator.clipboard.writeText(joinLink);
    setLinkCopied(true);
    toast.success("Ссылка скопирована");
    setTimeout(() => setLinkCopied(false), 2000);
  }

  async function handleApproveRequest(request: JoinRequest) {
    try {
      await approveJoinRequest(activeWorkspaceId!, request, "viewer", profile?.uid ?? "");
      toast.success(`${request.name} добавлен(а) в workspace как Viewer`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось одобрить заявку");
    }
  }

  async function handleRejectRequest(uid: string) {
    await rejectJoinRequest(activeWorkspaceId!, uid);
    toast.success("Заявка отклонена");
  }

  async function handleRoleChange(uid: string, role: Parameters<typeof changeMemberRole>[2]) {
    await changeMemberRole(activeWorkspaceId!, uid, role);
    toast.success("Роль обновлена");
  }

  async function handleRemove(uid: string, name: string) {
    if (!window.confirm(`Убрать ${name} из workspace? Он потеряет доступ ко всем страницам.`)) return;
    await removeMember(activeWorkspaceId!, uid);
    toast.success("Пользователь удалён");
  }

  async function handleResend(email: string) {
    await resendInvite(activeWorkspaceId!, email);
    toast.success("Приглашение обновлено");
  }

  async function handleTogglePageAccess(uid: string, page: (typeof pages)[number], checked: boolean) {
    await toggleUserPageAccess(activeWorkspaceId!, page, uid, checked);
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Workspace → Пользователи</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Приглашайте сотрудников и выберите, какие страницы каждому из них видно. Owner
          видит все страницы всегда — остальным доступ нужно выдать явно.
        </p>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Ссылка для вступления</CardTitle>
          <CardDescription>
            Новые люди по этой ссылке не создают свой workspace — они отправляют вам заявку, и вы сами решаете, впустить их или нет.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-md border border-border bg-muted px-3 py-2 text-xs">{joinLink}</code>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleCopyLink}>
              {linkCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              Копировать
            </Button>
          </div>
        </CardContent>
      </Card>

      {joinRequests.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Link2 className="h-4 w-4" /> Заявки на вступление ({joinRequests.length})
            </CardTitle>
            <CardDescription>При одобрении человек добавляется с ролью Viewer — роль и доступ к страницам настройте после.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {joinRequests.map((request) => (
              <div key={request.uid} className="flex items-center gap-3 rounded-lg border border-border p-3">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={request.photoURL ?? undefined} />
                  <AvatarFallback>{request.name[0]?.toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{request.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{request.email}</p>
                </div>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => handleRejectRequest(request.uid)}>
                  <X className="h-3.5 w-3.5" /> Отклонить
                </Button>
                <Button size="sm" className="gap-1.5" onClick={() => handleApproveRequest(request)}>
                  <Check className="h-3.5 w-3.5" /> Одобрить
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Пригласить сотрудника</CardTitle>
          <CardDescription>Приглашение появится сразу после того, как человек войдёт с этим email.</CardDescription>
        </CardHeader>
        <CardContent>
          <InviteMemberForm workspaceId={activeWorkspaceId} />
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        {members.map((member) => {
          const isOwner = member.role === "owner";
          const isExpanded = expandedUid === member.uid;
          return (
            <Card key={member.uid || member.email}>
              <div className="flex items-center gap-3 p-4">
                <Avatar className="h-9 w-9">
                  <AvatarImage src={member.photoURL ?? undefined} />
                  <AvatarFallback>{member.name[0]?.toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {member.name}
                    {member.uid === profile?.uid && <span className="ml-1.5 text-xs text-muted-foreground">(вы)</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                </div>
                {member.status === "invited" && <Badge variant="warning">Приглашён</Badge>}
                <span className="hidden text-xs text-muted-foreground sm:block">
                  {member.status === "active" ? timeAgo(member.joinedAt ?? member.invitedAt) : timeAgo(member.invitedAt)}
                </span>
                {isOwner ? (
                  <Badge variant="outline">Owner</Badge>
                ) : (
                  <RoleSelect value={member.role} onChange={(role) => handleRoleChange(member.uid, role)} />
                )}
                {member.status === "invited" && (
                  <Button variant="ghost" size="icon" title="Отправить снова" onClick={() => handleResend(member.email)}>
                    <Mail className="h-4 w-4" />
                  </Button>
                )}
                {!isOwner && (
                  <Button variant="ghost" size="icon" title="Удалить" onClick={() => handleRemove(member.uid, member.name)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
                {!isOwner && member.status === "active" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Страницы, доступные этому пользователю"
                    onClick={() => setExpandedUid(isExpanded ? null : member.uid)}
                  >
                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </Button>
                )}
              </div>

              {!isOwner && member.status === "active" && isExpanded && (
                <CardContent className="border-t border-border pt-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Доступные страницы
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {pages.map((page) => {
                      const Icon = PAGE_ICON_MAP[(page.icon as PageIconName) ?? "LayoutGrid"] ?? PAGE_ICON_MAP.LayoutGrid;
                      const checked = page.allowedUsers.includes(member.uid);
                      return (
                        <label
                          key={page.id}
                          className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent/40"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(value) => handleTogglePageAccess(member.uid, page, Boolean(value))}
                          />
                          <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: `hsl(${page.color})` }} />
                          <span className="truncate">{page.name}</span>
                        </label>
                      );
                    })}
                    {pages.length === 0 && (
                      <p className="text-xs text-muted-foreground">В workspace пока нет страниц.</p>
                    )}
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
