import { useMemo, useState } from "react";
import { Check, Eye, EyeOff, Loader2, Search, ShieldCheck, Users, UserX, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { displayNameOf } from "@/utils/displayName";
import { timeAgo } from "@/utils/date";
import { isDeskBlockedFor } from "@/utils/permissions";
import { setPageResponsible, updatePageAccess } from "@/services/pageService";
import { useWorkspace } from "@/hooks/useWorkspace";
import { usePermissions } from "@/hooks/usePermissions";
import { cn } from "@/utils/cn";
import { memberHasRole, rolesLabel, rolesOf, type ViewRequest, type WorkspaceMember, type WorkspacePage } from "@/types";

interface DeskAccessDialogProps {
  page: WorkspacePage;
  onOpenChange: (open: boolean) => void;
  /** Ответственный может скрывать стол — тот же переключатель, что в меню «⋯». */
  canToggleVisibility: boolean;
  /** Ожидающие запросы на просмотр этого стола, адресованные смотрящему. */
  pendingRequests: ViewRequest[];
  onResolveRequest?: (request: ViewRequest, status: "approved" | "denied") => Promise<void>;
}

/**
 * «Доступ к столу» — единственное место, где видно и правится всё, что
 * решает, кто откроет стол: ответственный, скрыт ли стол, кто ждёт ответа
 * на запрос и у кого просмотр/правка. Раньше это было размазано по трём
 * местам (диалог «Настройки страницы», пункт «скрыть» в меню и заявки в
 * колокольчике), и «скрыть» молча обнулял список, который только что
 * выставили в диалоге. Здесь переключатель видимости меняет список на
 * глазах, а запрос принимается той же рукой, что выдаёт доступ.
 *
 * Модель данных не тронута: `hiddenByResponsible` + `allowedUsers` +
 * `editableUsers`, как и в правилах. Owner видит любой стол всегда, поэтому
 * его в списке нет; Тимлид без роли Технарь столы не открывает, ему просмотр
 * выдать нельзя (правило isDeskBlocked) — переключатели у него выключены.
 */
export function DeskAccessDialog({
  page,
  onOpenChange,
  canToggleVisibility,
  pendingRequests,
  onResolveRequest,
}: DeskAccessDialogProps) {
  const { members } = useWorkspace();
  const permissions = usePermissions();
  const [allowedUsers, setAllowedUsers] = useState<string[]>(page.allowedUsers ?? []);
  const [editableUsers, setEditableUsers] = useState<string[]>(page.editableUsers ?? []);
  const [hidden, setHidden] = useState<boolean>(Boolean(page.hiddenByResponsible));
  const [responsibleUserId, setResponsibleUserId] = useState<string>(page.responsibleUserId ?? "");
  const [search, setSearch] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const activeMembers = useMemo(() => members.filter((m) => m.status === "active" && Boolean(m.uid)), [members]);
  // Owner видит все столы всегда — выдавать ему просмотр бессмысленно.
  const otherMembers = useMemo(() => activeMembers.filter((m) => m.role !== "owner"), [activeMembers]);
  const responsibleCandidates = activeMembers;
  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return otherMembers;
    return otherMembers.filter(
      (m) =>
        displayNameOf(m).toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q)
    );
  }, [otherMembers, search]);

  const canEdit = permissions.canManagePage(page);
  const canAssignResponsible = permissions.canAssignResponsible;
  const memberByUid = (uid: string) => members.find((m) => m.uid === uid) ?? null;

  function isBlocked(member: WorkspaceMember) {
    return isDeskBlockedFor(rolesOf(member));
  }

  function toggleAccess(uid: string) {
    if (!canEdit || uid === responsibleUserId) return;
    setAllowedUsers((prev) => {
      if (prev.includes(uid)) {
        // Правка без просмотра невозможна — editableUsers всегда подмножество.
        setEditableUsers((editPrev) => editPrev.filter((u) => u !== uid));
        return prev.filter((u) => u !== uid);
      }
      return [...prev, uid];
    });
  }

  function toggleEdit(uid: string) {
    if (!canEdit) return;
    setEditableUsers((prev) => (prev.includes(uid) ? prev.filter((u) => u !== uid) : [...prev, uid]));
  }

  /**
   * То же, что «показать/скрыть» в меню стола: открыть — просмотр всем
   * участникам, скрыть — только ответственному (и Owner). Меняется локально,
   * уходит в базу одним «Сохранить» вместе со списком.
   */
  function setOpenForAll(open: boolean) {
    setHidden(!open);
    const keep = responsibleUserId ? [responsibleUserId] : [];
    if (open) {
      setAllowedUsers(Array.from(new Set([...activeMembers.map((m) => m.uid), ...keep])));
    } else {
      setAllowedUsers(keep);
      setEditableUsers((prev) => prev.filter((u) => keep.includes(u)));
    }
  }

  function grantRole(role: "manager" | "os") {
    if (!canEdit) return;
    const uids = otherMembers.filter((m) => memberHasRole(m, role) && !isBlocked(m)).map((m) => m.uid);
    setAllowedUsers((prev) => Array.from(new Set([...prev, ...uids])));
  }

  function revokeAll() {
    if (!canEdit) return;
    const keep = responsibleUserId ? [responsibleUserId] : [];
    setAllowedUsers(keep);
    setEditableUsers((prev) => prev.filter((u) => keep.includes(u)));
  }

  async function handleResolve(request: ViewRequest, status: "approved" | "denied") {
    if (!onResolveRequest) return;
    setResolvingId(request.id);
    try {
      await onResolveRequest(request, status);
      // Сервис уже выдал просмотр в базе — держим список в диалоге в том же
      // состоянии, иначе «Сохранить» затёр бы только что принятого.
      if (status === "approved") {
        setAllowedUsers((prev) => (prev.includes(request.fromUid) ? prev : [...prev, request.fromUid]));
      }
      toast.success(status === "approved" ? "Просмотр открыт" : "Запрос отклонён");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось обработать запрос");
    } finally {
      setResolvingId(null);
    }
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      const nextResponsible = responsibleUserId || null;
      const responsibleChanged = canAssignResponsible && nextResponsible !== (page.responsibleUserId ?? null);
      // Сначала ответственный, потом доступ: setPageResponsible безусловно
      // пишет hiddenByResponsible: false, и в обратном порядке он затирал
      // только что выставленное «скрыт» — стол выглядел открытым, а
      // allowedUsers оставался из одного ответственного, и войти не мог никто.
      if (responsibleChanged) {
        await setPageResponsible(page.workspaceId, page.id, nextResponsible, allowedUsers);
      }
      if (canEdit) {
        const allowed = nextResponsible ? Array.from(new Set([...allowedUsers, nextResponsible])) : allowedUsers;
        await updatePageAccess(page.workspaceId, page.id, {
          allowedUsers: allowed,
          editableUsers: editableUsers.filter((u) => allowed.includes(u)),
          ...(canToggleVisibility ? { hiddenByResponsible: hidden } : {}),
        });
      }
      toast.success("Доступ обновлён");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить доступ");
    } finally {
      setIsSaving(false);
    }
  }

  const viewersCount = otherMembers.filter((m) => allowedUsers.includes(m.uid)).length;
  const editorsCount = otherMembers.filter((m) => editableUsers.includes(m.uid)).length;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-0 p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" /> Доступ к столу
          </DialogTitle>
          <DialogDescription>
            Кто открывает «{page.name}», кто в нём правит и кто за него отвечает. Owner видит все столы всегда.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[70vh] flex-col gap-5 overflow-y-auto px-6 py-5">
          {canAssignResponsible && (
            <section className="flex flex-col gap-1.5">
              <Label className="flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Ответственный
              </Label>
              <Select value={responsibleUserId || "none"} onValueChange={(v) => setResponsibleUserId(v === "none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Не назначен" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Не назначен</SelectItem>
                  {responsibleCandidates.map((m) => (
                    <SelectItem key={m.uid} value={m.uid}>
                      {displayNameOf(m)} · {rolesLabel(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Ответственный ведёт стол как свой: правит таблицу, столбцы и вкладки, выдаёт и забирает доступ.
              </p>
            </section>
          )}

          {canToggleVisibility && (
            <section
              className={cn(
                "flex items-center gap-3 rounded-xl border p-3",
                hidden ? "border-border bg-muted/30" : "border-primary/30 bg-primary/[0.06]"
              )}
            >
              {hidden ? (
                <EyeOff className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <Eye className="h-4 w-4 shrink-0 text-primary" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{hidden ? "Стол скрыт" : "Стол открыт для всех"}</p>
                <p className="text-xs text-muted-foreground">
                  {hidden
                    ? "На «Столах» помечен «Скрыт». Открывают только выбранные ниже и Owner."
                    : "Просмотр у всех участников. Выключите, чтобы оставить только выбранных."}
                </p>
              </div>
              <Switch checked={!hidden} onCheckedChange={setOpenForAll} disabled={!canEdit} aria-label="Стол открыт для всех" />
            </section>
          )}

          {pendingRequests.length > 0 && (
            <section className="flex flex-col gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Просят открыть · {pendingRequests.length}
              </p>
              {pendingRequests.map((request) => {
                const member = memberByUid(request.fromUid);
                const busy = resolvingId === request.id;
                return (
                  <div
                    key={request.id}
                    className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/[0.05] p-2.5"
                  >
                    <MemberAvatar
                      id={request.fromUid}
                      name={member?.name ?? request.fromName}
                      nickname={member?.nickname}
                      photoURL={member?.photoURL}
                      className="h-8 w-8 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{member ? displayNameOf(member) : request.fromName}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {member ? `${rolesLabel(member)} · ` : ""}
                        {timeAgo(request.createdAt)}
                      </p>
                    </div>
                    <Button size="sm" className="h-8 gap-1" disabled={busy} onClick={() => void handleResolve(request, "approved")}>
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Открыть
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0"
                      disabled={busy}
                      aria-label="Отклонить"
                      onClick={() => void handleResolve(request, "denied")}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })}
            </section>
          )}

          <section className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Участники · просмотр {viewersCount} · правка {editorsCount}
              </p>
              {canEdit && (
                <div className="flex flex-wrap gap-1">
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => grantRole("manager")}>
                    + технари
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => grantRole("os")}>
                    + ОС
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-muted-foreground" onClick={revokeAll}>
                    <UserX className="h-3 w-3" /> убрать всех
                  </Button>
                </div>
              )}
            </div>

            {otherMembers.length > 5 && (
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Имя, ник или email"
                  className="h-9 pl-8"
                />
              </div>
            )}

            <div className="flex items-center gap-3 px-2.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              <span className="min-w-0 flex-1" />
              <span className="w-16 text-center">Просмотр</span>
              <span className="w-16 text-center">Правка</span>
            </div>

            <div className="flex flex-col gap-1.5">
              {filteredMembers.map((m) => {
                const isResp = m.uid === responsibleUserId;
                const blocked = isBlocked(m);
                const hasAccess = isResp || allowedUsers.includes(m.uid);
                const canEditThis = isResp || editableUsers.includes(m.uid);
                return (
                  <div
                    key={m.uid}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border p-2.5 transition-colors",
                      hasAccess && !blocked ? "border-border bg-card/60" : "border-border/60 bg-transparent",
                      blocked && "opacity-60"
                    )}
                  >
                    <MemberAvatar id={m.uid} name={m.name} nickname={m.nickname} photoURL={m.photoURL} className="h-8 w-8 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                        <span className="truncate">{displayNameOf(m)}</span>
                        {isResp && (
                          <span className="shrink-0 rounded-full bg-primary/12 px-1.5 text-[10px] font-medium leading-4 text-primary">
                            ответственный
                          </span>
                        )}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {rolesLabel(m)}
                        {blocked ? " · столы не открывает" : ""}
                      </p>
                    </div>
                    <div className="flex w-16 shrink-0 justify-center" title={blocked ? "Тимлид без роли Технарь столы не открывает" : "Просмотр"}>
                      <Switch
                        checked={hasAccess && !blocked}
                        onCheckedChange={() => toggleAccess(m.uid)}
                        disabled={!canEdit || isResp || blocked}
                        aria-label={`Просмотр: ${displayNameOf(m)}`}
                      />
                    </div>
                    <div className="flex w-16 shrink-0 justify-center" title="Правка">
                      <Switch
                        checked={canEditThis && !blocked}
                        onCheckedChange={() => toggleEdit(m.uid)}
                        disabled={!canEdit || isResp || blocked || !hasAccess}
                        aria-label={`Правка: ${displayNameOf(m)}`}
                      />
                    </div>
                  </div>
                );
              })}
              {filteredMembers.length === 0 && (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  {otherMembers.length === 0
                    ? "Других участников пока нет — пригласите их на «Пользователи»."
                    : "Никого не найдено."}
                </p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">Правка выдаётся только тем, у кого уже есть просмотр.</p>
          </section>
        </div>

        <DialogFooter className="gap-2 border-t border-border px-6 py-4 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Отмена
          </Button>
          <Button onClick={handleSave} disabled={isSaving || (!canEdit && !canAssignResponsible)}>
            {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
