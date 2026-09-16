import { useMemo, useState } from "react";
import { Loader2, Pencil, Search, ShieldCheck, Users, UserX } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/sonner";
import { displayNameOf } from "@/utils/displayName";
import {
  setPageResponsible,
  updatePageEditableUsers,
  updatePagePermissions,
} from "@/services/pageService";
import { useWorkspace } from "@/hooks/useWorkspace";
import { usePermissions } from "@/hooks/usePermissions";
import type { WorkspacePage } from "@/types";

interface EditPageDialogProps {
  page: WorkspacePage | null;
  onOpenChange: (open: boolean) => void;
}

export function EditPageDialog({ page, onOpenChange }: EditPageDialogProps) {
  const { members } = useWorkspace();
  const permissions = usePermissions();
  const [allowedUsers, setAllowedUsers] = useState<string[]>(page?.allowedUsers ?? []);
  const [editableUsers, setEditableUsers] = useState<string[]>(page?.editableUsers ?? []);
  const [responsibleUserId, setResponsibleUserId] = useState<string>(page?.responsibleUserId ?? "");
  const [search, setSearch] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const otherMembers = useMemo(
    () => members.filter((m) => m.status === "active" && m.role !== "owner"),
    [members]
  );
  // The responsible-person picker is the one place the Owner SHOULD be
  // selectable — being Owner already grants full access to every page, but
  // an Owner may still want the explicit "Ответственный" badge/role on a
  // page they personally run day-to-day. Every other picker on this screen
  // (allowedUsers/editableUsers) intentionally excludes the Owner since
  // those grants are meaningless for an account that already has full
  // access — so this stays a separate list rather than widening otherMembers.
  const responsibleCandidates = useMemo(
    () => members.filter((m) => m.status === "active"),
    [members]
  );
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

  if (!page) return null;

  // Owner can always fully manage; otherwise only the person assigned as
  // responsible for THIS page — everyone else who can merely open the
  // dialog (e.g. an Admin, only to reassign who's responsible) gets a
  // read-only view of general/access.
  const canEdit = permissions.canManagePage(page);
  const canAssignResponsible = permissions.canAssignResponsible;

  function toggleAccess(uid: string) {
    if (!canEdit) return;
    setAllowedUsers((prev) => {
      const hasAccess = prev.includes(uid);
      if (hasAccess) {
        // Revoking view access must also revoke edit rights — editableUsers
        // is always meant to be a subset of allowedUsers.
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

  function grantAll() {
    // View access only by default — edit rights always stay a separate,
    // explicit grant even when opening the page up to everyone at once.
    setAllowedUsers(otherMembers.map((m) => m.uid));
  }
  function revokeAll() {
    setAllowedUsers([]);
    setEditableUsers([]);
  }
  function onlyRole(role: "manager" | "viewer") {
    setAllowedUsers(otherMembers.filter((m) => m.role === role).map((m) => m.uid));
    setEditableUsers((prev) => prev.filter((uid) => otherMembers.some((m) => m.uid === uid && m.role === role)));
  }

  async function handleSave() {
    if (!page) return;
    setIsSaving(true);
    try {
      if (canEdit) {
        await updatePagePermissions(page.workspaceId, page.id, allowedUsers);
        await updatePageEditableUsers(page.workspaceId, page.id, editableUsers);
      }
      const nextResponsible = responsibleUserId || null;
      if (canAssignResponsible && nextResponsible !== (page.responsibleUserId ?? null)) {
        await setPageResponsible(page.workspaceId, page.id, nextResponsible, allowedUsers);
      }
      toast.success("Страница обновлена");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить изменения");
    } finally {
      setIsSaving(false);
    }
  }

  const owner = members.find((m) => m.role === "owner");

  return (
    <Dialog open={Boolean(page)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Настройки страницы</DialogTitle>
                    <DialogDescription>Кто видит лист «{page.name}» и кто за него отвечает. Имя, цвет и цель — в «Настроить стол».</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue={canAssignResponsible ? "general" : "access"}>
          <TabsList className={canAssignResponsible ? "grid w-full grid-cols-2" : "grid w-full grid-cols-1"}>
            {canAssignResponsible && <TabsTrigger value="general">Общее</TabsTrigger>}
            <TabsTrigger value="access">Доступ</TabsTrigger>
          </TabsList>
          {canAssignResponsible && (
          <TabsContent value="general" className="flex flex-col gap-4">
            {canAssignResponsible && (
              <div className="flex flex-col gap-1.5">
                <Label className="flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5" /> Ответственный за страницу
                </Label>
                <p className="text-xs text-muted-foreground">
                  Ответственный получает права администратора именно этой страницы: может её
                  редактировать, управлять колонками и вкладками, выдавать и убирать доступ другим
                  участникам — без прав на весь workspace.
                </p>
                <Select value={responsibleUserId || "none"} onValueChange={(v) => setResponsibleUserId(v === "none" ? "" : v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Не назначен" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Не назначен</SelectItem>
                    {responsibleCandidates.map((m) => (
                      <SelectItem key={m.uid} value={m.uid}>
                        {displayNameOf(m)} ({m.email})
                        {m.role === "owner" && " · Овнер"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </TabsContent>
          )}

          <TabsContent value="access"
 className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
              {owner ? displayNameOf(owner) : "Owner"} и ответственный всегда могут просматривать и
              редактировать эту страницу. Остальным доступ на просмотр и право редактирования
              выдаются отдельно — просмотр не даёт возможности редактировать сам по себе.
            </p>

            {canEdit && (
              <div className="flex flex-wrap gap-1.5">
                <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={grantAll}>
                  <Users className="h-3 w-3" /> Выдать всем просмотр
                </Button>
                <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={revokeAll}>
                  <UserX className="h-3 w-3" /> Убрать у всех
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onlyRole("manager")}>
                  Только технари
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onlyRole("viewer")}>
                  Только Viewer
                </Button>
              </div>
            )}

            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск по никнейму, имени или email..."
                className="pl-8"
              />
            </div>

            <div className="flex items-center gap-3 px-2.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              <span className="min-w-0 flex-1" />
              <span className="w-14 text-center">Доступ</span>
              <span className="w-14 text-center">Правка</span>
            </div>

            <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
              {filteredMembers.map((m) => {
                const hasAccess = allowedUsers.includes(m.uid);
                const canEditThis = editableUsers.includes(m.uid);
                return (
                  <div
                    key={m.uid}
                    className="flex items-center gap-3 rounded-lg border border-border p-2.5 transition-colors hover:bg-accent/40"
                  >
                    <MemberAvatar
                      id={m.uid}
                      name={m.name}
                      nickname={m.nickname}
                      photoURL={m.photoURL}
                      className="h-8 w-8 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{displayNameOf(m)}</p>
                      <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                    </div>
                    {m.uid === responsibleUserId && (
                      <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        Ответственный
                      </span>
                    )}
                    <div className="flex w-14 shrink-0 justify-center" title="Доступ на просмотр">
                      <Switch checked={hasAccess} onCheckedChange={() => toggleAccess(m.uid)} disabled={!canEdit} />
                    </div>
                    <div className="flex w-14 shrink-0 justify-center" title="Право редактирования">
                      <Switch
                        checked={canEditThis}
                        onCheckedChange={() => toggleEdit(m.uid)}
                        disabled={!canEdit || !hasAccess}
                      />
                    </div>
                  </div>
                );
              })}
              {filteredMembers.length === 0 && (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  {otherMembers.length === 0
                    ? "В workspace пока нет других участников — пригласите их на странице «Пользователи»."
                    : "Никого не найдено."}
                </p>
              )}
            </div>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Pencil className="h-3 w-3" /> «Правка» доступна только тем, кому уже открыт просмотр.
            </p>
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
