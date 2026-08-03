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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/sonner";
import { IconPicker } from "@/components/common/IconPicker";
import { ColorPicker } from "@/components/common/ColorPicker";
import { displayNameOf } from "@/utils/displayName";
import {
  renamePage,
  setPageResponsible,
  updatePageAppearance,
  updatePageEditableUsers,
  updatePagePermissions,
} from "@/services/pageService";
import { useWorkspace } from "@/hooks/useWorkspace";
import { usePermissions } from "@/hooks/usePermissions";
import type { PageIconName, WorkspacePage } from "@/types";

interface EditPageDialogProps {
  page: WorkspacePage | null;
  onOpenChange: (open: boolean) => void;
}

export function EditPageDialog({ page, onOpenChange }: EditPageDialogProps) {
  const { members } = useWorkspace();
  const permissions = usePermissions();
  const [name, setName] = useState(page?.name ?? "");
  const [icon, setIcon] = useState<PageIconName>(page?.icon ?? "LayoutGrid");
  const [color, setColor] = useState(page?.color ?? "243 75% 59%");
  const [allowedUsers, setAllowedUsers] = useState<string[]>(page?.allowedUsers ?? []);
  const [editableUsers, setEditableUsers] = useState<string[]>(page?.editableUsers ?? []);
  const [responsibleUserId, setResponsibleUserId] = useState<string>(page?.responsibleUserId ?? "");
  const [search, setSearch] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const otherMembers = useMemo(
    () => members.filter((m) => m.status === "active" && m.role !== "owner"),
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
        if (name.trim() && name !== page.name) await renamePage(page.workspaceId, page.id, name.trim());
        if (icon !== page.icon || color !== page.color) {
          await updatePageAppearance(page.workspaceId, page.id, { icon, color });
        }
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
          <DialogDescription>Внешний вид и права доступа для «{page.name}».</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="general">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="general">Общее</TabsTrigger>
            <TabsTrigger value="access">Доступ</TabsTrigger>
          </TabsList>
          <TabsContent value="general" className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-page-name">Название</Label>
              <Input
                id="edit-page-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!canEdit}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Цвет</Label>
              <ColorPicker value={color} onChange={canEdit ? setColor : () => {}} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Иконка</Label>
              <IconPicker value={icon} onChange={canEdit ? setIcon : () => {}} color={color} />
            </div>

            {canAssignResponsible && (
              <div className="flex flex-col gap-1.5 border-t border-border pt-4">
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
                    {otherMembers.map((m) => (
                      <SelectItem key={m.uid} value={m.uid}>
                        {displayNameOf(m)} ({m.email})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </TabsContent>

          <TabsContent value="access" className="flex flex-col gap-3">
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
                  Только Manager
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
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarImage src={m.photoURL ?? undefined} />
                      <AvatarFallback>{displayNameOf(m)[0]?.toUpperCase()}</AvatarFallback>
                    </Avatar>
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
