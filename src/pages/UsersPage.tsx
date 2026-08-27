import { useEffect, useMemo, useState } from "react";
import { useUiStore } from "@/store/uiStore";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { Check, ChevronDown, ChevronRight, Clock3, Copy, Link2, Mail, Search, ShieldCheck, Trash2, X } from "lucide-react";
import { displayNameOf } from "@/utils/displayName";
import { getPresenceStatus, PRESENCE_DOT_COLOR, PRESENCE_LABEL } from "@/utils/presence";
import { cn } from "@/utils/cn";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/components/ui/sonner";
import { InviteMemberForm } from "@/components/members/InviteMemberForm";
import { RoleSelect } from "@/components/members/RoleSelect";
import { cancelInvite, changeMemberRole, quietActiveMembers, removeMember, resendInvite, visibleMemberRoster } from "@/services/memberService";
import { toggleUserPageAccess } from "@/services/pageService";
import { approveJoinRequest, rejectJoinRequest, fetchJoinRequests, subscribeJoinRequests, DEFAULT_JOIN_ROLE } from "@/services/joinRequestService";
import { PAGE_ICON_MAP } from "@/utils/pageIcons";
import { timeAgo } from "@/utils/date";
import { useAuth } from "@/hooks/useAuth";
import { refreshWorkspaceMembers, useWorkspace } from "@/hooks/useWorkspace";
import { usePermissions } from "@/hooks/usePermissions";
import type { JoinRequest, PageIconName, Role } from "@/types";


const ROLE_CHIPS: { id: Role | "invited"; label: string }[] = [
  { id: "owner", label: "Owner" },
  { id: "manager", label: "Технар" },
  { id: "admin", label: "admin" },
  { id: "viewer", label: "Viewer" },
  { id: "invited", label: "invited" },
];

export default function UsersPage() {
  const { profile } = useAuth();
  const { activeWorkspaceId, members, pages } = useWorkspace();
  const permissions = usePermissions();
  const [expandedUid, setExpandedUid] = useState<string | null>(null);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [linkCopied, setLinkCopied] = useState(false);
  const [query, setQuery] = useState("");
  const [roleChip, setRoleChip] = useState<Role | "invited" | null>(null);

  const roster = useMemo(
    () =>
      visibleMemberRoster(
        Array.isArray(members) ? members : [],
        joinRequests.map((r) => r.email)
      ),
    [members, joinRequests]
  );
  const filteredRoster = useMemo(() => {
    const q = query.trim().toLowerCase();
    return roster.filter((member) => {
      if (roleChip === "invited" && member.status !== "invited") return false;
      if (roleChip && roleChip !== "invited" && member.role !== roleChip) return false;
      if (!q) return true;
      const hay = [member.name, member.nickname, member.email, displayNameOf(member)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [roster, query, roleChip]);
  const quiet = useMemo(
    () => quietActiveMembers(Array.isArray(members) ? members : [], profile?.uid),
    [members, profile?.uid]
  );

  useEffect(() => {
    useUiStore.getState().setSelectedPersonKey(null);
  }, []);

  useEffect(() => {
    if (!activeWorkspaceId || !permissions.canManageUsers) {
      setJoinRequests([]);
      return;
    }
    return subscribeJoinRequests(activeWorkspaceId, setJoinRequests);
  }, [activeWorkspaceId, permissions.canManageUsers]);

  useEffect(() => {
    if (!activeWorkspaceId || !permissions.canManageUsers) return;
    void refreshWorkspaceMembers(activeWorkspaceId);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshWorkspaceMembers(activeWorkspaceId!);
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [activeWorkspaceId, permissions.canManageUsers]);

  if (!permissions.isResolved) return null;

  if (!permissions.canManageUsers) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <ShieldCheck className="h-8 w-8 text-muted-foreground" />
        <p className="text-lg font-semibold">Доступ ограничен</p>
        <p className="text-sm text-muted-foreground">Управление пользователями доступно только Owner.</p>
      </div>
    );
  }

  if (!activeWorkspaceId) return null;

  const deskPages = Array.isArray(pages) ? pages : [];
  const responsibleUids = new Set(deskPages.map((page) => page.responsibleUserId).filter((id): id is string => Boolean(id)));

  const joinLink = `${window.location.origin}/join/${activeWorkspaceId}`;

  async function handleCopyLink() {
    await navigator.clipboard.writeText(joinLink);
    setLinkCopied(true);
    toast.success("Ссылка скопирована");
    setTimeout(() => setLinkCopied(false), 2000);
  }

  async function handleApproveRequest(request: JoinRequest) {
    try {
      await approveJoinRequest(activeWorkspaceId!, request, DEFAULT_JOIN_ROLE, profile?.uid ?? "");
      await refreshWorkspaceMembers(activeWorkspaceId!);
      toast.success(`${request.name} добавлен(а) в workspace как Технар`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось одобрить заявку");
    } finally {
      try {
        setJoinRequests(await fetchJoinRequests(activeWorkspaceId!));
      } catch {
        setJoinRequests((prev) => prev.filter((r) => r.uid !== request.uid));
      }
    }
  }

  async function handleRejectRequest(uid: string) {
    try {
      await rejectJoinRequest(activeWorkspaceId!, uid);
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

  async function handleRoleChange(uid: string, role: Parameters<typeof changeMemberRole>[2]) {
    const id = uid.trim();
    if (!id) {
      toast.error("Нельзя сменить роль: у записи нет id");
      return;
    }
    try {
      await changeMemberRole(activeWorkspaceId!, id, role);
      await refreshWorkspaceMembers(activeWorkspaceId!);
      toast.success("Роль обновлена");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сменить роль");
    }
  }

  async function handleCancelInvite(email: string) {
    const normalized = email.trim().toLowerCase();
    if (!normalized) {
      toast.error("Нет email для отмены приглашения");
      return;
    }
    if (!window.confirm(`Отменить приглашение для ${normalized}?`)) return;
    try {
      await cancelInvite(activeWorkspaceId!, normalized);
      await refreshWorkspaceMembers(activeWorkspaceId!);
      toast.success("Приглашение отменено");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось отменить приглашение");
    }
  }

  async function handleRemove(uid: string, name: string) {
    const id = uid.trim();
    if (!id) {
      toast.error("Нельзя удалить: у записи нет id");
      return;
    }
    if (!window.confirm(`Убрать ${name} из workspace? Он потеряет доступ ко всем страницам.`)) return;
    try {
      await removeMember(activeWorkspaceId!, id);
      await refreshWorkspaceMembers(activeWorkspaceId!);
      toast.success("Пользователь удалён");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось удалить пользователя");
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

  async function handleTogglePageAccess(uid: string, pageId: string, checked: boolean) {
    const latest = useWorkspaceStore.getState().pages.find((p) => p.id === pageId);
    if (!latest) return;
    const already = Boolean(latest.allowedUsers?.includes(uid));
    if (already === checked) return;
    if (!checked && latest.responsibleUserId === uid) {
      toast.error("Нельзя снять доступ у ответственного за этот стол");
      return;
    }
    await toggleUserPageAccess(activeWorkspaceId!, latest, uid, checked);
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-light tracking-tight">Workspace → Пользователи</h1>
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
            <CardDescription>При одобрении человек становится Технар и может создать один свой стол. Роль можно сменить после (Owner / Технар / Viewer).</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {joinRequests.map((request) => (
              <div key={request.uid} className="flex items-center gap-3 rounded-lg border border-border p-3">
                <MemberAvatar id={request.uid} name={request.name} photoURL={request.photoURL} className="h-8 w-8" />
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

      {quiet.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock3 className="h-4 w-4" /> Давно не заходили ({quiet.length})
            </CardTitle>
            <CardDescription>Семь дней без активности. Не точка «не в сети» — она гаснет за десять минут.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {quiet.map((member) => (
              <div key={member.uid || member.email} className="flex items-center gap-3 rounded-lg border border-border p-3">
                <MemberAvatar
                  id={member.uid || member.email || "member"}
                  name={member.name}
                  nickname={member.nickname}
                  photoURL={member.photoURL}
                  className="h-8 w-8"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{displayNameOf(member)}</p>
                  <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {timeAgo(member.lastActiveAt || member.joinedAt || member.invitedAt)}
                </span>
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

      <div className="mb-3 flex flex-col gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Имя, ник или email"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ROLE_CHIPS.map((chip) => {
            const on = roleChip === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => setRoleChip(on ? null : chip.id)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  on
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-border bg-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {filteredRoster.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">Никого не нашли</p>
        )}
        {filteredRoster.map((member) => {
          const isOwner = member.role === "owner";
          const isExpanded = expandedUid === member.uid;
          const noDesk =
            member.role === "manager" &&
            member.status === "active" &&
            Boolean(member.uid) &&
            !responsibleUids.has(member.uid);
          return (
            <Card key={member.uid || member.email}>
              <div className="flex items-center gap-3 p-4">
                <div className="relative shrink-0">
                  <MemberAvatar
                    id={member.uid || member.email || "member"}
                    name={member.name}
                    nickname={member.nickname}
                    photoURL={member.photoURL}
                    className="h-9 w-9"
                  />
                  {member.status === "active" && (
                    <span
                      className={cn(
                        "absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-card",
                        PRESENCE_DOT_COLOR[getPresenceStatus(member.lastActiveAt)]
                      )}
                      title={PRESENCE_LABEL[getPresenceStatus(member.lastActiveAt)]}
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {displayNameOf(member)}
                    {member.uid === profile?.uid && <span className="ml-1.5 text-xs text-muted-foreground">(вы)</span>}
                    {noDesk && <span className="ml-1.5 text-xs text-muted-foreground">стола нет</span>}
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
                  <RoleSelect value={member.role} onChange={(role) => handleRoleChange(member.status === "invited" ? member.email : member.uid, role)} />
                )}
                {member.status === "invited" && (
                  <Button variant="ghost" size="icon" title="Отправить снова" onClick={() => handleResend(member.email)}>
                    <Mail className="h-4 w-4" />
                  </Button>
                )}
                {member.status === "invited" ? (
                  <Button variant="ghost" size="icon" title="Отменить приглашение" onClick={() => handleCancelInvite(member.email)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                ) : (
                  !isOwner && (
                    <Button variant="ghost" size="icon" title="Удалить" onClick={() => handleRemove(member.uid, displayNameOf(member))}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )
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
                    {deskPages.map((page) => {
                      const Icon = PAGE_ICON_MAP[(page.icon as PageIconName) ?? "LayoutGrid"] ?? PAGE_ICON_MAP.LayoutGrid ?? PAGE_ICON_MAP.Users;
                      const checked = Boolean(page.allowedUsers?.includes(member.uid) || page.responsibleUserId === member.uid);
                      return (
                        <label
                          key={page.id}
                          className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent/40"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(value) => handleTogglePageAccess(member.uid, page.id, Boolean(value))}
                          />
                          <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: `hsl(${page.color})` }} />
                          <span className="truncate">{page.name}</span>
                        </label>
                      );
                    })}
                    {deskPages.length === 0 && (
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
