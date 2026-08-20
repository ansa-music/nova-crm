import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Trash2, Users } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Link } from "react-router";
import { toast } from "@/components/ui/sonner";
import { StatusBadge } from "@/components/table/StatusBadge";
import { ManageOptionsDialog } from "@/components/table/ManageOptionsDialog";
import { profileSchema, type ProfileFormValues } from "@/utils/validation";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { updateUserPassword, updateUserProfile } from "@/firebase/auth";
import { updateUserDoc } from "@/services/authService";
import { deleteWorkspace, updateResponsibleOptions, updateStatusOptions, updateWorkspace } from "@/services/workspaceService";
import { getAuthErrorMessage } from "@/utils/firebaseErrors";
import { DEFAULT_STATUS_OPTIONS } from "@/utils/columnOptions";
import type { StatusOption } from "@/types";

export default function SettingsPage() {
  const { profile } = useAuth();
  const permissions = usePermissions();
  const { activeWorkspace, setActiveWorkspaceId, workspaces } = useWorkspace();
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [workspaceName, setWorkspaceName] = useState(activeWorkspace?.name ?? "");
  const [isSavingWorkspace, setIsSavingWorkspace] = useState(false);

  const profileForm = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: profile?.name ?? "" },
  });

  async function onSaveProfile(values: ProfileFormValues) {
    setIsSavingProfile(true);
    try {
      await updateUserProfile(values.name);
      if (profile) await updateUserDoc(profile.uid, { name: values.name });
      toast.success("Профиль обновлён");
    } catch (error) {
      toast.error(getAuthErrorMessage(error));
    } finally {
      setIsSavingProfile(false);
    }
  }

  async function handlePasswordSave() {
    if (newPassword.length < 6) {
      toast.error("Пароль должен быть не короче 6 символов");
      return;
    }
    setIsSavingPassword(true);
    try {
      await updateUserPassword(newPassword);
      toast.success("Пароль обновлён");
      setNewPassword("");
    } catch (error) {
      toast.error(getAuthErrorMessage(error));
    } finally {
      setIsSavingPassword(false);
    }
  }

  async function handleSaveWorkspaceName() {
    if (!activeWorkspace) return;
    setIsSavingWorkspace(true);
    try {
      await updateWorkspace(activeWorkspace.id, { name: workspaceName });
      toast.success("Workspace обновлён");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить");
    } finally {
      setIsSavingWorkspace(false);
    }
  }

  async function handleDeleteWorkspace() {
    if (!activeWorkspace) return;
    if (!window.confirm(`Удалить workspace «${activeWorkspace.name}»? Это действие необратимо.`)) return;
    await deleteWorkspace(activeWorkspace.id);
    const next = workspaces.find((w) => w.id !== activeWorkspace.id);
    setActiveWorkspaceId(next?.id ?? null);
    toast.success("Workspace удалён");
  }

  // ---- Общие списки "Ответственных" и "Статусов" — используются всеми
  // столбцами соответствующего типа на любой странице/подстранице сайта.
  const responsibleOptions = activeWorkspace?.responsibleOptions ?? [];
  const statusOptions = activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS;
  const [manageOptionsKind, setManageOptionsKind] = useState<"responsible" | "status" | null>(null);

  async function handleSaveSharedOptions(next: StatusOption[]) {
    if (!activeWorkspace) return;
    if (manageOptionsKind === "responsible") {
      await updateResponsibleOptions(activeWorkspace.id, next);
    } else if (manageOptionsKind === "status") {
      await updateStatusOptions(activeWorkspace.id, next);
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-3xl font-light tracking-tight">Настройки</h1>

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Профиль</TabsTrigger>
          <TabsTrigger value="workspace">Workspace</TabsTrigger>
          <TabsTrigger value="members">Роли и доступ</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Личные данные</CardTitle>
              <CardDescription>Ваше имя видно всем участникам workspace.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="flex items-center gap-4">
                <Avatar className="h-16 w-16">
                  <AvatarImage src={profile?.photoURL ?? undefined} />
                  <AvatarFallback className="text-lg">{profile?.name?.[0]?.toUpperCase()}</AvatarFallback>
                </Avatar>
              </div>

              <form onSubmit={profileForm.handleSubmit(onSaveProfile)} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="name">Имя</Label>
                  <Input id="name" {...profileForm.register("name")} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Email</Label>
                  <Input value={profile?.email ?? ""} disabled />
                </div>
                <Button type="submit" className="w-fit" disabled={isSavingProfile}>
                  {isSavingProfile && <Loader2 className="h-4 w-4 animate-spin" />}
                  Сохранить
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Пароль</CardTitle>
              <CardDescription>
                Обновите пароль для входа по email. Если вы вошли через Google, эта опция недоступна.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex items-end gap-2">
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor="password">Новый пароль</Label>
                <Input
                  id="password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              <Button onClick={handlePasswordSave} disabled={isSavingPassword}>
                {isSavingPassword && <Loader2 className="h-4 w-4 animate-spin" />}
                Обновить
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="workspace" className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Общие настройки</CardTitle>
              <CardDescription>Название текущего workspace «{activeWorkspace?.name}».</CardDescription>
            </CardHeader>
            <CardContent className="flex items-end gap-2">
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor="ws-name">Название</Label>
                <Input
                  id="ws-name"
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  disabled={!permissions.canManageWorkspace}
                />
              </div>
              {permissions.canManageWorkspace && (
                <Button onClick={handleSaveWorkspaceName} disabled={isSavingWorkspace}>
                  {isSavingWorkspace && <Loader2 className="h-4 w-4 animate-spin" />}
                  Сохранить
                </Button>
              )}
            </CardContent>
          </Card>

          {permissions.canManageWorkspace && (
            <Card>
              <CardHeader>
                <CardTitle>Общие списки вариантов</CardTitle>
                <CardDescription>
                  «Статус» и «Ответственный» — единые списки на весь сайт: значение, добавленное здесь,
                  сразу доступно в любом таком столбце на любой странице. Управляет только Овнер.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div>
                    <p className="text-sm font-medium">Статус</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {statusOptions.length === 0 ? (
                        <span className="text-xs text-muted-foreground">Нет вариантов</span>
                      ) : (
                        statusOptions.map((opt) => (
                          <StatusBadge key={opt.value} value={opt.value} options={statusOptions} />
                        ))
                      )}
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setManageOptionsKind("status")}>
                    Изменить
                  </Button>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div>
                    <p className="text-sm font-medium">Ответственный</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {responsibleOptions.length === 0 ? (
                        <span className="text-xs text-muted-foreground">Нет вариантов</span>
                      ) : (
                        responsibleOptions.map((opt) => (
                          <StatusBadge key={opt.value} value={opt.value} options={responsibleOptions} />
                        ))
                      )}
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setManageOptionsKind("responsible")}>
                    Изменить
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <ManageOptionsDialog
            open={manageOptionsKind !== null}
            onOpenChange={(o) => !o && setManageOptionsKind(null)}
            title={manageOptionsKind === "status" ? "Варианты статуса" : "Варианты «Ответственный»"}
            description="Изменения увидят все, кто пользуется сайтом."
            options={manageOptionsKind === "status" ? statusOptions : responsibleOptions}
            onSave={handleSaveSharedOptions}
          />

          {permissions.canManageWorkspace && (
            <Card className="border-destructive/40">
              <CardHeader>
                <CardTitle className="text-destructive">Опасная зона</CardTitle>
                <CardDescription>Удаление workspace необратимо и удалит все страницы и данные.</CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="destructive" className="gap-1.5" onClick={handleDeleteWorkspace}>
                  <Trash2 className="h-4 w-4" /> Удалить workspace
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="members">
          <Card>
            <CardHeader>
              <CardTitle>Участники и роли</CardTitle>
              <CardDescription>
                Приглашения, роли и доступ к отдельным страницам теперь управляются на
                отдельной странице «Пользователи».
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="gap-1.5">
                <Link to="/users">
                  <Users className="h-4 w-4" /> Перейти к пользователям
                </Link>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
