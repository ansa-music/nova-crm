import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertTriangle,
  Archive,
  Building2,
  Check,
  Columns3,
  Download,
  EyeOff,
  Filter,
  History,
  Keyboard,
  Layers,
  Loader2,
  MousePointerSquareDashed,
  Palette,
  Pencil,
  Plus,
  Redo2,
  ShieldCheck,
  Sparkles,
  Tags,
  Trash2,
  User,
  UserCog,
  Users,
} from "lucide-react";
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
import { syncNicknameToMemberships, updateUserDoc } from "@/services/authService";
import {
  deleteWorkspace,
  updateResponsibleOptions,
  updateStatusOptions,
  updateWorkspace,
  updateAccentColor,
  addCustomField,
  renameCustomField,
  updateCustomFieldOptions,
  deleteCustomField,
} from "@/services/workspaceService";
import { downloadWorkspaceBackup } from "@/services/backupService";
import { getAuthErrorMessage } from "@/utils/firebaseErrors";
import { DEFAULT_STATUS_OPTIONS } from "@/utils/columnOptions";
import { ACCENT_PRESETS } from "@/components/common/AccentColorSync";
import { cn } from "@/utils/cn";
import type { StatusOption } from "@/types";

const FEATURE_ITEMS = [
  {
    icon: Columns3,
    title: "Добавление и удаление столбцов",
    description: "Кнопка «Столбец» над таблицей или ПКМ по заголовку → «Изменить тип» / «Удалить столбец».",
  },
  {
    icon: Palette,
    title: "Свои варианты Статуса и Ответственного",
    description:
      "ПКМ по заголовку столбца → «Изменить варианты» — добавляйте, переименовывайте, перекрашивайте. Список общий на весь сайт.",
  },
  {
    icon: Redo2,
    title: "Отмена действий",
    description: "Ctrl+Z — отменить последнее действие в таблице, Ctrl+Y — вернуть обратно.",
  },
  {
    icon: History,
    title: "История изменений",
    description: "Кнопка «История» на странице — кто, что и когда менял, с возможностью восстановить.",
  },
  {
    icon: Filter,
    title: "Фильтры и группировка",
    description: "Клик по значку фильтра в заголовке столбца, или выпадающий список «Группировка» над таблицей.",
  },
  {
    icon: MousePointerSquareDashed,
    title: "Копирование и вставка как в Excel",
    description: "Выделите диапазон ячеек — Ctrl+C/Ctrl+V работает между строками и столбцами сразу.",
  },
  {
    icon: Download,
    title: "Экспорт в CSV",
    description: "Кнопка «CSV» над таблицей — выгружает текущий вид таблицы файлом.",
  },
  {
    icon: ShieldCheck,
    title: "Ответственный за страницу",
    description: "В настройках страницы можно назначить Ответственного — он получает права администратора именно этой страницы.",
  },
  {
    icon: EyeOff,
    title: "Скрыть страницу у себя",
    description: "ПКМ по странице в сайдбаре → «Скрыть у себя» — уберёт её из вашего списка, не влияя на других.",
  },
  {
    icon: Archive,
    title: "Архив вкладок",
    description: "У подстраниц есть архив — кнопка «Архив» рядом с вкладками, ничего не удаляется безвозвратно.",
  },
  {
    icon: Layers,
    title: "Личное пространство",
    description: "У Ответственного за страницу есть приватный раздел с отчётами, финансами и заметками — их не видит никто другой.",
  },
  {
    icon: UserCog,
    title: "Режим привилегий",
    description: "Owner и Admin могут временно посмотреть на сайт глазами другой роли — переключатель рядом с аватаром.",
  },
  {
    icon: Keyboard,
    title: "Горячие клавиши",
    description: "Нажмите «?» в любой момент (не во время ввода текста) — откроется полный список сочетаний клавиш.",
  },
] as const;

const SETTINGS_NAV = [
  { value: "features", label: "Возможности", icon: Sparkles },
  { value: "profile", label: "Профиль", icon: User },
  { value: "workspace", label: "Workspace", icon: Building2 },
  { value: "lists", label: "Варианты", icon: Tags, owner: true },
  { value: "fields", label: "Поля", icon: Layers, owner: true },
  { value: "appearance", label: "Оформление", icon: Palette, owner: true },
  { value: "backup", label: "Бэкап", icon: Download, owner: true },
  { value: "danger", label: "Опасная зона", icon: AlertTriangle, owner: true },
  { value: "members", label: "Роли и доступ", icon: Users },
] as const;

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
    defaultValues: { name: profile?.name ?? "", nickname: profile?.nickname ?? "" },
  });

  async function onSaveProfile(values: ProfileFormValues) {
    setIsSavingProfile(true);
    try {
      await updateUserProfile(values.name);
      if (profile) {
        const nickname = (values.nickname ?? "").trim();
        await updateUserDoc(profile.uid, { name: values.name, nickname });
        if (profile.workspaceIds?.length) {
          await syncNicknameToMemberships(profile.uid, profile.workspaceIds, nickname);
        }
      }
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
    try {
      await deleteWorkspace(activeWorkspace.id);
      const next = workspaces.find((w) => w.id !== activeWorkspace.id);
      setActiveWorkspaceId(next?.id ?? null);
      toast.success("Workspace удалён");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось удалить workspace");
    }
  }

  const [isBackingUp, setIsBackingUp] = useState(false);

  async function handleDownloadBackup() {
    if (!activeWorkspace) return;
    setIsBackingUp(true);
    try {
      await downloadWorkspaceBackup(activeWorkspace.id, activeWorkspace.name);
      toast.success("Бэкап скачан");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось собрать бэкап");
    } finally {
      setIsBackingUp(false);
    }
  }

  // ---- Общие списки "Ответственных", "Статусов" и Owner-кастомных полей —
  // используются всеми столбцами соответствующего типа на любой
  // странице/подстранице сайта.
  const responsibleOptions = activeWorkspace?.responsibleOptions ?? [];
  const statusOptions = activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS;
  const customFields = activeWorkspace?.customFields ?? [];
  // "responsible" | "status" | "custom:<fieldId>" | null
  const [manageOptionsKind, setManageOptionsKind] = useState<string | null>(null);
  const [isCreatingField, setIsCreatingField] = useState(false);
  const [newFieldName, setNewFieldName] = useState("");

  function activeCustomField() {
    if (!manageOptionsKind?.startsWith("custom:")) return null;
    const id = manageOptionsKind.slice(7);
    return customFields.find((f) => f.id === id) ?? null;
  }

  useEffect(() => {
    if (!permissions.canManageWorkspace) setManageOptionsKind(null);
  }, [permissions.canManageWorkspace]);

  async function handleSaveSharedOptions(next: StatusOption[]) {
    if (!activeWorkspace) return;
    if (!permissions.canManageWorkspace) throw new Error("Варианты меняет только Owner");
    if (manageOptionsKind === "responsible") {
      await updateResponsibleOptions(activeWorkspace.id, next);
    } else if (manageOptionsKind === "status") {
      await updateStatusOptions(activeWorkspace.id, next);
    } else {
      const field = activeCustomField();
      if (field) await updateCustomFieldOptions(activeWorkspace.id, customFields, field.id, next);
    }
  }

  async function handleCreateCustomField() {
    if (!activeWorkspace || !newFieldName.trim()) return;
    try {
      await addCustomField(activeWorkspace.id, customFields, newFieldName.trim());
      toast.success(`Поле «${newFieldName.trim()}» создано`);
      setNewFieldName("");
      setIsCreatingField(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось создать поле");
    }
  }

  async function handleRenameCustomField(fieldId: string, currentName: string) {
    const name = window.prompt("Новое название поля:", currentName)?.trim();
    if (!name || !activeWorkspace) return;
    await renameCustomField(activeWorkspace.id, customFields, fieldId, name);
  }

  async function handleDeleteCustomField(fieldId: string, name: string) {
    if (!activeWorkspace) return;
    if (!window.confirm(`Удалить поле «${name}»? Столбцы, которые его используют, останутся без вариантов.`)) return;
    await deleteCustomField(activeWorkspace.id, customFields, fieldId);
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="mb-6 text-3xl font-light tracking-tight">Настройки</h1>

      <Tabs
        defaultValue="features"
        orientation="vertical"
        className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6"
      >
        <TabsList className="flex h-auto w-full shrink-0 flex-row gap-1 overflow-x-auto rounded-md bg-transparent p-0 lg:w-52 lg:flex-col lg:overflow-visible">
          {SETTINGS_NAV.filter((item) => !("owner" in item) || permissions.canManageWorkspace).map((item) => (
            <TabsTrigger
              key={item.value}
              value={item.value}
              className="w-full justify-start gap-2 rounded-md px-3 py-2 data-[state=active]:bg-primary/10 data-[state=active]:text-primary"
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="min-w-0 flex-1">

        <TabsContent value="features" className="mt-0 flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Что умеет Nova CRM</CardTitle>
              <CardDescription>
                Короткая шпаргалка по всему, что уже есть на сайте — многое не сразу заметно с
                первого взгляда.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {FEATURE_ITEMS.map((item) => (
                <div key={item.title} className="flex gap-3 rounded-lg border border-border p-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <item.icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="profile" className="mt-0 flex flex-col gap-4">
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

              <form onSubmit={profileForm.handleSubmit(onSaveProfile)} className="mt-0 flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="name">Имя</Label>
                  <Input id="name" {...profileForm.register("name")} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="nickname">Ник</Label>
                  <Input id="nickname" {...profileForm.register("nickname")} placeholder="как в чате" />
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

        <TabsContent value="workspace" className="mt-0 flex flex-col gap-4">
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
        </TabsContent>

        {permissions.canManageWorkspace && (
        <TabsContent value="lists" className="mt-0 flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Общие списки вариантов</CardTitle>
                <CardDescription>
                  «Статус» и «Ответственный» — единые списки на весь сайт: значение, добавленное здесь,
                  сразу доступно в любом таком столбце на любой странице. Управляет только Овнер.
                </CardDescription>
              </CardHeader>
              <CardContent className="mt-0 flex flex-col gap-4">
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
        </TabsContent>
        )}

        {permissions.canManageWorkspace && (
        <TabsContent value="fields" className="mt-0 flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Кастомные поля</CardTitle>
                <CardDescription>
                  Свои типы столбцов вроде «Приоритет» или «Источник» — тот же принцип, что «Статус» и
                  «Ответственный»: один общий список вариантов на весь сайт, но название и набор
                  значений придумываете вы сами.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {customFields.length === 0 && (
                  <p className="text-sm text-muted-foreground">Пока нет ни одного кастомного поля.</p>
                )}
                {customFields.map((field) => (
                  <div key={field.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                    <div>
                      <p className="text-sm font-medium">{field.name}</p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {field.options.length === 0 ? (
                          <span className="text-xs text-muted-foreground">Нет вариантов</span>
                        ) : (
                          field.options.map((opt) => (
                            <StatusBadge key={opt.value} value={opt.value} options={field.options} />
                          ))
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <Button variant="outline" size="sm" onClick={() => setManageOptionsKind(`custom:${field.id}`)}>
                        Варианты
                      </Button>
                      <Button variant="ghost" size="icon" aria-label="Переименовать поле" onClick={() => handleRenameCustomField(field.id, field.name)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Удалить поле"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleDeleteCustomField(field.id, field.name)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}

                {isCreatingField ? (
                  <div className="flex items-end gap-2">
                    <div className="flex flex-1 flex-col gap-1.5">
                      <Label>Название поля</Label>
                      <Input
                        autoFocus
                        value={newFieldName}
                        onChange={(e) => setNewFieldName(e.target.value)}
                        placeholder="Например, Приоритет"
                        onKeyDown={(e) => e.key === "Enter" && handleCreateCustomField()}
                      />
                    </div>
                    <Button onClick={handleCreateCustomField}>Создать</Button>
                    <Button variant="outline" onClick={() => setIsCreatingField(false)}>
                      Отмена
                    </Button>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" className="w-fit gap-1.5" onClick={() => setIsCreatingField(true)}>
                    <Plus className="h-3.5 w-3.5" /> Новое поле
                  </Button>
                )}
              </CardContent>
            </Card>
        </TabsContent>
        )}

          <ManageOptionsDialog
            open={manageOptionsKind !== null && permissions.canManageWorkspace}
            onOpenChange={(o) => !o && setManageOptionsKind(null)}
            canEdit={permissions.canManageWorkspace}
            title={
              manageOptionsKind === "status"
                ? "Варианты статуса"
                : manageOptionsKind === "responsible"
                  ? "Варианты «Ответственный»"
                  : `Варианты «${activeCustomField()?.name ?? ""}»`
            }
            description="Изменения увидят все, кто пользуется сайтом."
            options={
              manageOptionsKind === "status"
                ? statusOptions
                : manageOptionsKind === "responsible"
                  ? responsibleOptions
                  : activeCustomField()?.options ?? []
            }
            onSave={handleSaveSharedOptions}
          />

        {permissions.canManageWorkspace && (
        <TabsContent value="appearance" className="mt-0 flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Оформление</CardTitle>
                <CardDescription>Цвет метки стола — маленький маркер, не перекрашивает кнопки и таблицу.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                {ACCENT_PRESETS.map((preset) => {
                  const isActive = (activeWorkspace?.accentColor ?? ACCENT_PRESETS[0].value) === preset.value;
                  return (
                    <button
                      key={preset.value}
                      type="button"
                      title={preset.label}
                      onClick={() => activeWorkspace && updateAccentColor(activeWorkspace.id, preset.value)}
                      className={cn(
                        "flex h-10 w-10 items-center justify-center rounded-full ring-offset-2 ring-offset-background transition-all hover:scale-105",
                        isActive && "ring-2 ring-foreground"
                      )}
                      style={{ backgroundColor: `hsl(${preset.value})` }}
                    >
                      {isActive && <Check className="h-4 w-4 text-white drop-shadow" />}
                    </button>
                  );
                })}
              </CardContent>
            </Card>
        </TabsContent>
        )}

        {permissions.canManageWorkspace && (
        <TabsContent value="backup" className="mt-0 flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Резервная копия</CardTitle>
                <CardDescription>
                  Скачивает JSON со всеми страницами, подстраницами, строками и участниками —
                  на случай, если что-то случайно перезаписалось или удалилось.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" className="gap-1.5" onClick={handleDownloadBackup} disabled={isBackingUp}>
                  {isBackingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  Скачать бэкап workspace
                </Button>
              </CardContent>
            </Card>
        </TabsContent>
        )}

        {permissions.canManageWorkspace && (
        <TabsContent value="danger" className="mt-0 flex flex-col gap-4">
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
        </TabsContent>
        )}

        <TabsContent value="members" className="mt-0">
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
        </div>
      </Tabs>
    </div>
  );
}
