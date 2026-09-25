import { useEffect, useMemo, useState } from "react";
import { useUiStore } from "@/store/uiStore";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { firestoreErrorText } from "@/utils/dbError";
import { Check, ChevronDown, ChevronRight, Clock3, Contact, Copy, Link2, Lock, Mail, Plus, Search, Trash2, UserX, X } from "lucide-react";
import { AccessDenied } from "@/components/common/AccessDenied";
import { Link, Navigate } from "react-router";
import { displayNameOf } from "@/utils/displayName";
import { getPresenceStatus, PRESENCE_DOT_COLOR, PRESENCE_LABEL } from "@/utils/presence";
import { PageHeader } from "@/components/common/PageHeader";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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
import { revokeOwnerRole } from "@/services/ownerAccessService";
import {
  cancelInvite,
  changeMemberRole,
  nickOptionsOf,
  quietActiveMembers,
  type NickKind,
  deleteMemberCompletely,
  removeMember,
  resendInvite,
  setMemberExtraRoles,
  visibleMemberRoster,
} from "@/services/memberService";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NickDialog } from "@/components/members/NickDialog";
import { MemberNickChip } from "@/components/members/MemberNickChip";
import { ApproveJoinDialog } from "@/components/members/ApproveJoinDialog";
import { canHoldNick, nickKindsShownFor, nickLockReason } from "@/utils/teamGroup";
import { toggleUserPageAccess } from "@/services/pageService";
import { rejectJoinRequest, fetchJoinRequests, subscribeJoinRequests } from "@/services/joinRequestService";
import { PAGE_ICON_MAP } from "@/utils/pageIcons";
import { timeAgo } from "@/utils/date";
import { useAuth } from "@/hooks/useAuth";
import { refreshWorkspaceMembers, useWorkspace } from "@/hooks/useWorkspace";
import { usePermissions } from "@/hooks/usePermissions";
import { useMembersRefresh } from "@/hooks/useMembersRefresh";
import { usePresenceMap } from "@/hooks/usePresenceMap";
import { EXTRA_ROLES, memberHasRole, ROLE_LABELS, rolesOf, type JoinRequest, type PageIconName, type Role, type WorkspaceMember } from "@/types";
import { confirmDialog } from "@/utils/appDialog";


const ROLE_CHIPS: { id: Role | "invited"; label: string }[] = [
  { id: "owner", label: "Owner" },
  { id: "teamlead", label: "Тимлид" },
  { id: "manager", label: "Технарь" },
  { id: "os", label: "ОС" },
  { id: "admin", label: "admin" },
  { id: "viewer", label: "Viewer" },
  { id: "invited", label: "invited" },
];

export default function UsersPage() {
  const { profile } = useAuth();
  const { activeWorkspaceId, activeWorkspace, members, pages } = useWorkspace();
  const permissions = usePermissions();
  const [expandedUid, setExpandedUid] = useState<string | null>(null);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [linkCopied, setLinkCopied] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [roleChip, setRoleChip] = useState<Role | "invited" | null>(null);
  // Ники: only Тимлид/Owner reach this page (canManageUsers); rules enforce
  // the same on the member doc and the workspace nick lists. Списки ников и
  // разделы Технари/ОС/Другие — на отдельной странице «Команда» (/team).
  const [nickDialog, setNickDialog] = useState<{ member: WorkspaceMember; kind: NickKind } | null>(null);
  const [approveRequest, setApproveRequest] = useState<JoinRequest | null>(null);
  // Старая ссылка на вкладку «Ники» (?tab=nicks) ведёт на «Команду».
  const [legacyNicksLink] = useState(() => new URLSearchParams(window.location.search).get("tab") === "nicks");

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
      if (roleChip && roleChip !== "invited" && !memberHasRole(member, roleChip)) return false;
      if (!q) return true;
      const hay = [member.name, member.nickname, member.email, displayNameOf(member)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [roster, query, roleChip]);
  // «В сети» и «давно не заходили» — max(Firestore, Supabase): пульс живёт в
  // Supabase, а lastActiveAt в member-документах больше не освежается.
  // Смёрженные копии — только для показа, в Firestore они не пишутся.
  // Список «давно не заходили» — повод убрать человека, поэтому строится
  // только по ПОДТВЕРЖДЁННЫМ данным: пока карта Supabase не пришла с сервера
  // (снимок, пустота после выхода, отказ выборки), замёрзший `lastActiveAt`
  // в Firestore выдал бы почти всю команду. Точки «в сети» рисуются и так.
  const presenceAt = usePresenceMap(activeWorkspaceId);
  const quiet = useMemo(
    () =>
      presenceAt.confirmed
        ? quietActiveMembers(
            (Array.isArray(members) ? members : []).map((m) => ({ ...m, lastActiveAt: presenceAt(m) })),
            profile?.uid
          )
        : [],
    [members, profile?.uid, presenceAt]
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

  // Заявку рассмотрел кто-то другой, пока диалог был открыт, — закрываем его:
  // иначе «Впустить» упёрся бы в «уже рассмотрели».
  useEffect(() => {
    if (approveRequest && !joinRequests.some((r) => r.uid === approveRequest.uid)) setApproveRequest(null);
  }, [joinRequests, approveRequest]);

  // Не каждую минуту, а при открытии и возвращении на вкладку (≤ раза в 5 мин).
  useMembersRefresh(activeWorkspaceId, permissions.canManageUsers);

  if (legacyNicksLink) return <Navigate to="/team" replace />;

  if (!permissions.isResolved) return null;

  if (!permissions.canManageUsers) {
    return <AccessDenied reason="Управление пользователями доступно только Owner и Тимлиду." backTo={{ to: "/people", label: "Люди" }} />;
  }

  if (!activeWorkspaceId) return null;

  // Real Owner (never a role preview): may edit their own add-on roles too.
  const viewerIsOwner = permissions.isWorkspaceOwner || permissions.realRole === "owner";
  // Роль Owner выдаёт и забирает только создатель workspace (ownerId):
  // выданный Owner записи других Owner не трогает — так держат и правила.
  const viewerIsCreator = permissions.isWorkspaceOwner;
  const deskPages = Array.isArray(pages) ? pages : [];
  const responsibleUids = new Set(deskPages.map((page) => page.responsibleUserId).filter((id): id is string => Boolean(id)));

  const joinLink = `${window.location.origin}/join/${activeWorkspaceId}`;

  async function handleCopyLink() {
    await navigator.clipboard.writeText(joinLink);
    setLinkCopied(true);
    toast.success("Ссылка скопирована");
    setTimeout(() => setLinkCopied(false), 2000);
  }

  async function afterApprove() {
    await refreshWorkspaceMembers(activeWorkspaceId!);
    try {
      setJoinRequests(await fetchJoinRequests(activeWorkspaceId!));
    } catch {
      // Подписка на заявки и так обновит список.
    }
  }

  async function handleRejectRequest(uid: string) {
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

  async function handleRoleChange(uid: string, role: Parameters<typeof changeMemberRole>[2], currentExtraRoles?: Role[]) {
    const id = uid.trim();
    if (!id) {
      toast.error("Нельзя сменить роль: у записи нет id");
      return;
    }
    try {
      await changeMemberRole(activeWorkspaceId!, id, role, currentExtraRoles);
      await refreshWorkspaceMembers(activeWorkspaceId!);
      toast.success("Роль обновлена");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сменить роль");
    }
  }

  async function handleRevokeOwner(member: WorkspaceMember, role: Role) {
    if (role === "owner" || !profile) return;
    const name = displayNameOf(member);
    const ok = await confirmDialog({
      title: `Забрать права Owner у ${name}?`,
      description: `Роль станет «${ROLE_LABELS[role]}». Уведомление ему не придёт.`,
      confirmLabel: "Забрать",
      destructive: true,
    });
    if (!ok) return;
    try {
      await revokeOwnerRole({
        workspaceId: activeWorkspaceId!,
        uid: member.uid,
        role,
        currentExtraRoles: member.extraRoles,
        workspaceOwnerId: activeWorkspace?.ownerId ?? null,
        actorUid: profile.uid,
      });
      await refreshWorkspaceMembers(activeWorkspaceId!);
      toast.success(`${name} — теперь «${ROLE_LABELS[role]}»`, { description: "Без уведомления" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сменить роль");
    }
  }

  async function handleExtraRoles(member: WorkspaceMember, next: Role[]) {
    try {
      await setMemberExtraRoles(activeWorkspaceId!, member.uid, member.role, next);
      await refreshWorkspaceMembers(activeWorkspaceId!);
      const label = rolesOf({ role: member.role, extraRoles: next })
        .map((r) => ROLE_LABELS[r])
        .join(" + ");
      toast.success(`Роли: ${label}`, { description: displayNameOf(member) });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить роли");
    }
  }

  async function handleCancelInvite(email: string) {
    const normalized = email.trim().toLowerCase();
    if (!normalized) {
      toast.error("Нет email для отмены приглашения");
      return;
    }
    if (!(await confirmDialog({ title: `Отменить приглашение для ${normalized}?`, destructive: true, confirmLabel: "Отменить приглашение", cancelLabel: "Оставить" }))) return;
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
    if (!(await confirmDialog({ title: `Убрать ${name} из workspace?`, description: "Участник потеряет доступ ко всем столам и данным.", destructive: true, confirmLabel: "Убрать" }))) return;
    try {
      await removeMember(activeWorkspaceId!, id);
      await refreshWorkspaceMembers(activeWorkspaceId!);
      toast.success("Пользователь удалён");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось удалить пользователя");
    }
  }

  /**
   * Полное удаление — только Owner. Стол и ник остаются: стол со всеми
   * строками, ник — в списке workspace, чтобы подписи в старых заказах не
   * превратились в «—».
   */
  async function handleDeleteFully(member: WorkspaceMember) {
    const name = displayNameOf(member);
    const email = (member.email ?? "").trim();
    const ok = await confirmDialog({
      title: `Удалить ${name} полностью?`,
      description:
        `Уйдёт доступ и все следы адреса ${email || "—"}: участник, приглашение по почте, заявки на вход и тихие доступы. ` +
        "Стол со всеми заказами и ник в списке останутся — их удаление отдельное. Вернуть человека можно только новой заявкой.",
      destructive: true,
      confirmLabel: "Удалить полностью",
      cancelLabel: "Отмена",
    });
    if (!ok) return;
    try {
      const { removed } = await deleteMemberCompletely({ workspaceId: activeWorkspaceId!, member });
      await refreshWorkspaceMembers(activeWorkspaceId!);
      toast.success(`${name} удалён полностью`, {
        description: removed.joinRequests > 0 ? `Заявок на вход удалено: ${removed.joinRequests}` : "Стол и ник не тронуты",
      });
    } catch (error) {
      toast.error("Не удалось удалить пользователя", { description: firestoreErrorText(error, "База не приняла запись") });
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
    <div className="mx-auto w-full min-w-0 max-w-4xl p-4 sm:p-8">
      <PageHeader
        eyebrow="Workspace"
        title="Пользователи"
        description="Кто в команде и что каждому видно. Owner видит все столы всегда, остальным доступ выдаётся явно; Тимлид таблиц столов не видит."
        actions={
          <>
            <Button asChild variant="outline" className="min-h-11 gap-1.5 sm:min-h-0">
              <Link to="/team">
                <Contact className="h-4 w-4" /> Команда и ники
              </Link>
            </Button>
            <Button className="min-h-11 gap-1.5 sm:min-h-0" onClick={() => setInviteOpen(true)}>
              <Plus className="h-4 w-4" /> Пригласить
            </Button>
          </>
        }
      />

      {/* Ссылка и приглашение — действия «раз в месяц», а список участников
          открывают каждый день. Раньше две карточки занимали весь первый
          экран, и список уезжал под сгиб. */}
      <Sheet open={inviteOpen} onOpenChange={setInviteOpen}>
        <SheetContent side="right" className="flex w-full max-w-md flex-col overflow-y-auto p-0">
          <SheetHeader className="border-b border-primary/25 px-5 py-4 pr-12">
            <SheetTitle>Пригласить в workspace</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-6 px-5 py-5">
            <section className="flex flex-col gap-2">
              <h3 className="section">По email</h3>
              <p className="text-xs text-muted-foreground">
                Приглашение появится сразу после того, как человек войдёт с этим email.
              </p>
              <InviteMemberForm workspaceId={activeWorkspaceId} />
            </section>
            <section className="flex flex-col gap-2">
              <h3 className="section">Ссылка для вступления</h3>
              <p className="text-xs text-muted-foreground">
                По этой ссылке человек приходит без роли: выбирает, кем работает (Технарь или ОС), пишет свой ник, если он
                есть, — и ждёт одобрения. Вы можете впустить как есть или поменять роль и ник.
              </p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted px-3 py-2 text-xs">{joinLink}</code>
                <Button variant="outline" size="sm" className="min-h-11 shrink-0 gap-1.5 sm:min-h-0" onClick={handleCopyLink}>
                  {linkCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  Копировать
                </Button>
              </div>
            </section>
          </div>
        </SheetContent>
      </Sheet>

      {joinRequests.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Link2 className="h-4 w-4" /> Заявки на вступление ({joinRequests.length})
            </CardTitle>
            <CardDescription>
              Новые люди приходят без роли и сами пишут, кем работают и под каким ником. «Одобрить» — проверить роль и ник
              (можно поменять) и впустить.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {joinRequests.map((request) => (
              <div key={request.uid} className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <MemberAvatar id={request.uid} name={request.name} photoURL={request.photoURL} className="h-8 w-8 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{request.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{request.email}</p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {request.requestedRole ? (
                        <span className="text-foreground">{ROLE_LABELS[request.requestedRole]}</span>
                      ) : (
                        "роль не выбрал"
                      )}
                      {request.requestedNick && (
                        <>
                          {" "}· ник <span className="font-medium text-foreground">«{request.requestedNick}»</span>
                        </>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="min-h-11 flex-1 gap-1.5 sm:min-h-0 sm:flex-none" onClick={() => handleRejectRequest(request.uid)}>
                    <X className="h-3.5 w-3.5" /> Отклонить
                  </Button>
                  <Button size="sm" className="min-h-11 flex-1 gap-1.5 sm:min-h-0 sm:flex-none" onClick={() => setApproveRequest(request)}>
                    <Check className="h-3.5 w-3.5" /> Одобрить
                  </Button>
                </div>
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
            memberHasRole(member, "manager") &&
            member.status === "active" &&
            Boolean(member.uid) &&
            !responsibleUids.has(member.uid);
          // A Тимлид never changes their own roles, nick or membership — the
          // Owner or another Тимлид does (firestore.rules enforce the same).
          const selfLocked = member.uid === profile?.uid && !viewerIsOwner;
          const extraRoles = rolesOf(member).slice(1);
          const addableRoles = EXTRA_ROLES.filter((r) => r !== member.role && !extraRoles.includes(r));
          // Запись Owner правит создатель, а выданный Owner — только свою
          // (ник, вторая роль), не чужую.
          const ownerRowOpen = !isOwner || viewerIsCreator || (viewerIsOwner && member.uid === profile?.uid);
          const canEditExtraRoles =
            member.status === "active" && Boolean(member.uid) && !selfLocked && ownerRowOpen;
          // Ники — по разделу «Команды» (Технари / ОС / Другие), плюс ник,
          // оставшийся от прошлой роли: открепить его можно и отсюда.
          const nickKinds = member.status === "active" && member.uid ? nickKindsShownFor(member) : [];
          const nickLocked = selfLocked || !ownerRowOpen;
          return (
            <Card key={member.uid || member.email}>
              <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:gap-3 sm:p-4">
                <div className="flex min-w-0 flex-1 items-center gap-3">
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
                        PRESENCE_DOT_COLOR[getPresenceStatus(presenceAt(member))]
                      )}
                      title={PRESENCE_LABEL[getPresenceStatus(presenceAt(member))]}
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
                  {(extraRoles.length > 0 || (canEditExtraRoles && addableRoles.length > 0)) && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      {extraRoles.map((role) => (
                        <span
                          key={role}
                          className="inline-flex items-center gap-1 rounded-full border border-teal-400/40 bg-teal-400/10 py-0.5 pl-2 pr-1 text-[11px] font-medium text-teal-200"
                        >
                          + {ROLE_LABELS[role]}
                          {canEditExtraRoles ? (
                            <button
                              type="button"
                              title={`Убрать роль «${ROLE_LABELS[role]}»`}
                              onClick={() => void handleExtraRoles(member, extraRoles.filter((r) => r !== role))}
                              className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-teal-400/20"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          ) : (
                            <span className="w-1" />
                          )}
                        </span>
                      ))}
                      {canEditExtraRoles && addableRoles.length > 0 && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                            >
                              <Plus className="h-3 w-3" />
                              роль
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="w-56">
                            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                              Вторая роль — права складываются
                            </DropdownMenuLabel>
                            {addableRoles.map((role) => (
                              <DropdownMenuItem key={role} onSelect={() => void handleExtraRoles(member, [...extraRoles, role])}>
                                {ROLE_LABELS[role]}
                                <span className="ml-auto text-[10px] text-muted-foreground">
                                  {role === "manager" ? "свой стол, таблицы" : "ник, оценки"}
                                </span>
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  )}
                  {member.uid === profile?.uid && selfLocked && (
                    <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Lock className="h-3 w-3 shrink-0" />
                      Свои роли и ник меняет Owner или другой Тимлид
                    </p>
                  )}
                  {nickKinds.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      {nickKinds.map((kind) => (
                        <MemberNickChip
                          key={kind}
                          member={member}
                          kind={kind}
                          options={nickOptionsOf(activeWorkspace, kind)}
                          eligible={canHoldNick(kind, member)}
                          locked={nickLocked}
                          lockReason={isOwner && !ownerRowOpen ? nickLockReason(member, viewerIsOwner) : "Свой ник закрепляет Owner или другой Тимлид"}
                          onClick={() => setNickDialog({ member, kind })}
                        />
                      ))}
                    </div>
                  )}
                </div>
                </div>
                <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
                {member.status === "invited" && <Badge variant="warning">Приглашён</Badge>}
                <span className="hidden text-xs text-muted-foreground sm:block">
                  {member.status === "active" ? timeAgo(member.joinedAt ?? member.invitedAt) : timeAgo(member.invitedAt)}
                </span>
                {isOwner && viewerIsCreator && member.status === "active" && member.uid &&
                member.uid !== activeWorkspace?.ownerId && member.uid !== profile?.uid ? (
                  // Забрать права Owner — тихо, без уведомления человеку.
                  <RoleSelect
                    className="w-full sm:w-32"
                    value="owner"
                    onChange={(role) => void handleRevokeOwner(member, role)}
                  />
                ) : isOwner ? (
                  <Badge variant="outline">Owner</Badge>
                ) : (
                  <RoleSelect
                    className="w-full sm:w-32"
                    value={member.role}
                    disabled={selfLocked}
                    onChange={(role) =>
                      handleRoleChange(member.status === "invited" ? member.email : member.uid, role, member.extraRoles)
                    }
                  />
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
                  !isOwner && !selfLocked && (
                    viewerIsOwner ? (
                      // Owner удаляет ПОЛНОСТЬЮ — вместе с адресом; Тимлиду
                      // остаётся обычное «убрать из workspace». Две кнопки
                      // рядом путали бы: разница между ними не видна.
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Удалить полностью — вместе с адресом (стол и ник останутся)"
                        onClick={() => void handleDeleteFully(member)}
                      >
                        <UserX className="h-4 w-4 text-destructive" />
                      </Button>
                    ) : (
                      <Button variant="ghost" size="icon" title="Убрать из workspace" onClick={() => handleRemove(member.uid, displayNameOf(member))}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )
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
              </div>

              {!isOwner && member.status === "active" && isExpanded && (
                <CardContent className="border-t border-border pt-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Открытые столы
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
                      <p className="text-xs text-muted-foreground">В workspace пока нет столов.</p>
                    )}
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      {nickDialog && (
        <NickDialog
          workspaceId={activeWorkspaceId}
          kind={nickDialog.kind}
          member={nickDialog.member}
          members={Array.isArray(members) ? members : []}
          options={nickOptionsOf(activeWorkspace, nickDialog.kind)}
          onClose={() => setNickDialog(null)}
          onSaved={() => refreshWorkspaceMembers(activeWorkspaceId)}
        />
      )}
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
    </div>
  );
}
