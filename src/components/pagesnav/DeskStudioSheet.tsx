import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Palette, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";
import { IconPicker } from "@/components/common/IconPicker";
import { ColorPicker } from "@/components/common/ColorPicker";
import { ACCENT_PRESETS } from "@/components/common/AccentColorSync";
import { cn } from "@/utils/cn";
import { AddColumnDialog } from "@/components/table/AddColumnDialog";
import { ManageOptionsDialog } from "@/components/table/ManageOptionsDialog";
import { TableSchemaEditor } from "@/components/table/TableSchemaEditor";
import { useWorkspace } from "@/hooks/useWorkspace";
import { DEFAULT_STATUS_OPTIONS, getColumnOptions } from "@/utils/columnOptions";
import {
  addColumn,
  deleteColumn,
  renameColumn,
  renamePage,
  setPageAccentColor,
  setPageMonthlyGoal,
  updateColumnStatusOptions,
  updatePageAppearance,
  updatePageColumns,
} from "@/services/pageService";
import { removeDeskCover, uploadDeskCover } from "@/services/deskCoverService";
import { DeskCoverStrip } from "@/components/dashboard/DeskCoverStrip";
import { useDeskLayout } from "@/hooks/useDeskLayout";
import { usePermissions } from "@/hooks/usePermissions";
import type { PageIconName, StatusOption, WorkspacePage } from "@/types";

interface DeskStudioSheetProps {
  page: WorkspacePage | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  uid?: string;
}

export function DeskStudioSheet({ page, open, onOpenChange, uid }: DeskStudioSheetProps) {
  const permissions = usePermissions();
  const { activeWorkspace } = useWorkspace();
  const { layout, setLayout } = useDeskLayout(uid ?? permissions.uid);
  const [addColumnOpen, setAddColumnOpen] = useState(false);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<PageIconName>("LayoutGrid");
  const [color, setColor] = useState("189 100% 72%");
  const [accentColor, setAccentColor] = useState<string | undefined>(undefined);
  const [goalInput, setGoalInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverDrag, setCoverDrag] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!page || !open) return;
    setName(page.name);
    setIcon(page.icon ?? "LayoutGrid");
    setColor(page.color ?? "189 100% 72%");
    setAccentColor(page.accentColor);
    setGoalInput(page.monthlyGoal ? String(page.monthlyGoal) : "");
  }, [page, open]);

  useEffect(() => {
    if (!permissions.canManageStatusVariants) setStatusDialogOpen(false);
  }, [permissions.canManageStatusVariants]);

  const canEditPreview = Boolean(page && permissions.canManagePage(page));
  const columns = page?.columns ?? [];
  const statusColumn = columns.find((c) => c.type === "status") ?? null;
  const statusOptions = statusColumn
    ? getColumnOptions(statusColumn, activeWorkspace)
    : (activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS);

  async function handleRenameColumn(colKey: string) {
    if (!page || !canEditPreview) return;
    const current = columns.find((c) => c.key === colKey);
    if (!current) return;
    const newLabel = window.prompt("Новое название столбца", current.label);
    if (!newLabel || !newLabel.trim() || newLabel.trim() === current.label) return;
    try {
      await renameColumn(page.workspaceId, page.id, columns, colKey, newLabel.trim());
      toast.success("Столбец переименован");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось переименовать");
    }
  }

  async function handleToggleHidden(colKey: string) {
    if (!page || !canEditPreview) return;
    const next = columns.map((c) => (c.key === colKey ? { ...c, hidden: !c.hidden } : c));
    try {
      await updatePageColumns(page.workspaceId, page.id, next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось скрыть столбец");
    }
  }

  async function handleMoveColumn(colKey: string, direction: -1 | 1) {
    if (!page || !canEditPreview) return;
    const ordered = [...columns].sort((a, b) => a.order - b.order);
    const index = ordered.findIndex((c) => c.key === colKey);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) return;
    const swapped = [...ordered];
    const tmp = swapped[index];
    swapped[index] = swapped[nextIndex];
    swapped[nextIndex] = tmp;
    try {
      await updatePageColumns(
        page.workspaceId,
        page.id,
        swapped.map((c, i) => ({ ...c, order: i }))
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось переместить столбец");
    }
  }

  async function handleDeleteColumn(colKey: string) {
    if (!page || !canEditPreview) return;
    const current = columns.find((c) => c.key === colKey);
    if (!current) return;
    if (!window.confirm(`Удалить столбец «${current.label}»? Данные в нём будут скрыты.`)) return;
    try {
      await deleteColumn(page.workspaceId, page.id, columns, colKey);
      toast.success("Столбец удалён");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось удалить столбец");
    }
  }

  async function handleSaveStatuses(options: StatusOption[]) {
    if (!page || !permissions.canManageStatusVariants) return;
    const target = columns.find((c) => c.type === "status");
    if (!target) {
      const keys = new Set(columns.map((c) => c.key));
      let key = "status";
      let i = 1;
      while (keys.has(key)) {
        key = `status_${i}`;
        i += 1;
      }
      await addColumn(page.workspaceId, page.id, columns, {
        key,
        label: "Статус",
        type: "status",
        statusOptions: options,
      });
      toast.success("Столбец «Статус» добавлен");
      return;
    }
    await updateColumnStatusOptions(page.workspaceId, page.id, columns, target.key, options);
    toast.success("Статусы обновлены");
  }

  if (!page) return null;

  const canEdit = permissions.canManagePage(page);
  const previewStyle = {
    backgroundColor: accentColor ? `hsl(${accentColor})` : "hsl(var(--primary))",
  };

  async function saveAppearance() {
    if (!page || !canEditPreview) return;
    setIsSaving(true);
    try {
      if (name.trim() && name.trim() !== page.name) {
        await renamePage(page.workspaceId, page.id, name.trim());
      }
      if (icon !== page.icon || color !== page.color) {
        await updatePageAppearance(page.workspaceId, page.id, { icon, color });
      }
      if (accentColor !== page.accentColor) {
        await setPageAccentColor(page.workspaceId, page.id, accentColor ?? null);
      }
      const value = Number(goalInput.replace(",", "."));
      const nextGoal = Number.isFinite(value) && value > 0 ? value : null;
      const prevGoal = page.monthlyGoal ?? null;
      if (nextGoal !== prevGoal) {
        await setPageMonthlyGoal(page.workspaceId, page.id, nextGoal);
      }
      toast.success("Стол обновлён");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить стол");
    } finally {
      setIsSaving(false);
    }
  }

  async function applyCoverFile(file: File | undefined) {
    if (!page || !canEdit || !file || coverBusy) return;
    setCoverBusy(true);
    try {
      await uploadDeskCover(page.workspaceId, page.id, file, page.coverPath);
      toast.success("Обложка стола обновлена");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить обложку");
    } finally {
      setCoverBusy(false);
    }
  }

  async function clearCover() {
    if (!page || !canEdit || coverBusy) return;
    setCoverBusy(true);
    try {
      await removeDeskCover(page.workspaceId, page.id, page.coverPath);
      toast.success("Обложка убрана");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось убрать обложку");
    } finally {
      setCoverBusy(false);
    }
  }

  async function saveGoalNow() {
    if (!page || !canEditPreview) return;
    const value = Number(goalInput.replace(",", "."));
    const nextGoal = Number.isFinite(value) && value > 0 ? value : null;
    try {
      await setPageMonthlyGoal(page.workspaceId, page.id, nextGoal);
      toast.success(nextGoal ? "Цель записана" : "Цель убрана");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить цель");
    }
  }

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex h-full w-full max-w-md flex-col overflow-y-auto p-0"
      >
        <SheetHeader className="border-b border-border px-5 py-4 pr-12">
          <SheetTitle>Твой стол</SheetTitle>
          <p className="text-sm text-muted-foreground">
            Имя, цвет, столбцы и статусы (включая «Готово»).
          </p>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-7 px-5 py-5">
          <section className="flex flex-col gap-3">
            <div>
              <p className="text-sm font-medium">Кто и как называется</p>
              <p className="text-xs text-muted-foreground">Имя листа, иконка и оттенок в меню.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="desk-name">Название</Label>
              <Input
                id="desk-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!canEdit}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Оттенок</Label>
              <ColorPicker value={color} onChange={canEdit ? setColor : () => {}} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Иконка</Label>
              <IconPicker value={icon} onChange={canEdit ? setIcon : () => {}} color={color} />
            </div>
          </section>

          <section className="flex flex-col gap-3 border-t border-border pt-6">
            <div>
              <p className="text-sm font-medium">Цвет дела</p>
              <p className="text-xs text-muted-foreground">Только на этом листе. Крестик — как на сайте.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                title="Как на сайте"
                disabled={!canEdit}
                onClick={() => setAccentColor(undefined)}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/40 text-[10px] text-muted-foreground transition-transform hover:scale-105 disabled:opacity-50",
                  !accentColor && "border-foreground text-foreground"
                )}
              >
                ×
              </button>
              {ACCENT_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  title={preset.label}
                  disabled={!canEdit}
                  onClick={() => setAccentColor(preset.value)}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full ring-offset-2 ring-offset-background transition-transform hover:scale-105 disabled:opacity-50",
                    accentColor === preset.value && "ring-2 ring-foreground"
                  )}
                  style={{ backgroundColor: `hsl(${preset.value})` }}
                />
              ))}
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-border/70 bg-muted/30 p-3">
              <span
                className="flex h-8 w-8 items-center justify-center rounded-full"
                style={{ backgroundColor: `hsl(${color} / 0.18)`, color: `hsl(${color})` }}
              >
                <Palette className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{name.trim() || page.name}</p>
                <p className="text-[11px] text-muted-foreground">как кнопка на столе</p>
              </div>
              <span
                className="shrink-0 rounded-full px-3 py-1 text-[11px] font-medium text-primary-foreground"
                style={previewStyle}
              >
                Дело
              </span>
            </div>
          </section>

          <section className="flex flex-col gap-3 border-t border-border pt-6">
            <div>
              <p className="text-sm font-medium">Обложка стола</p>
              <p className="text-xs text-muted-foreground">
                Фото на домашнем экране. Это оформление стола, не файлы заказа.
              </p>
            </div>
            <div
              className={cn(
                "overflow-hidden rounded-lg border border-primary/35 bg-card/80",
                coverDrag && canEdit && "ring-1 ring-primary"
              )}
              onDragOver={(e) => {
                if (!canEdit) return;
                e.preventDefault();
                setCoverDrag(true);
              }}
              onDragLeave={() => setCoverDrag(false)}
              onDrop={(e) => {
                if (!canEdit) return;
                e.preventDefault();
                setCoverDrag(false);
                void applyCoverFile(e.dataTransfer.files?.[0]);
              }}
            >
              <DeskCoverStrip coverUrl={page.coverUrl} name={name.trim() || page.name} />
              <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                <button
                  type="button"
                  disabled={!canEdit || coverBusy}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-primary/40 px-2.5 text-[12px] text-primary hover:bg-primary/10 disabled:opacity-50"
                  onClick={() => coverInputRef.current?.click()}
                >
                  {coverBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
                  {page.coverUrl ? "Заменить" : "Загрузить"}
                </button>
                {page.coverUrl ? (
                  <button
                    type="button"
                    disabled={!canEdit || coverBusy}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                    onClick={() => void clearCover()}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Убрать
                  </button>
                ) : (
                  <span className="text-[11px] text-muted-foreground">jpeg / png / webp, до 10 МБ. Можно перетащить сюда.</span>
                )}
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    void applyCoverFile(file);
                  }}
                />
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-3 border-t border-border pt-6">
            <div>
              <p className="text-sm font-medium">Цель</p>
              <p className="text-xs text-muted-foreground">На месяц. Enter — сразу записать.</p>
            </div>
            <Input
              type="number"
              inputMode="decimal"
              value={goalInput}
              disabled={!canEdit}
              placeholder="Например, 200000"
              onChange={(e) => setGoalInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.code === "Enter") {
                  e.preventDefault();
                  void saveGoalNow();
                }
              }}
            />
          </section>

          <section className="border-t border-border pt-6">
            <TableSchemaEditor
              columns={columns}
              statusOptions={statusOptions}
              canEdit={canEdit}
              onAddColumn={() => setAddColumnOpen(true)}
              onRenameColumn={(key) => void handleRenameColumn(key)}
              onToggleHidden={(key) => void handleToggleHidden(key)}
              onMoveColumn={(key, dir) => void handleMoveColumn(key, dir)}
              onDeleteColumn={(key) => void handleDeleteColumn(key)}
              onManageStatuses={() => {
                if (!permissions.canManageStatusVariants) return;
                setStatusDialogOpen(true);
              }}
              canManageStatuses={permissions.canManageStatusVariants}
            />
          </section>

          <section className="flex flex-col gap-3 border-t border-border pt-6">
            <div>
              <p className="text-sm font-medium">Что висит на дашборде</p>
              <p className="text-xs text-muted-foreground">
                Только экран «Дашборд». Главная и список «Столы» не трогаем.
              </p>
            </div>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2.5">
              <span className="text-sm">Рейтинг «Как ведут дело»</span>
              <Switch
                checked={layout.showLeaderboard}
                onCheckedChange={(v) => setLayout({ showLeaderboard: v })}
              />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2.5">
              <span className="text-sm">Карточка прогресса</span>
              <Switch
                checked={layout.showProgress}
                onCheckedChange={(v) => setLayout({ showProgress: v })}
              />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2.5">
              <span className="text-sm">Диаграмма стола</span>
              <Switch
                checked={layout.showCharts}
                onCheckedChange={(v) => setLayout({ showCharts: v })}
              />
            </label>
          </section>

        </div>

        <div className="sticky bottom-0 border-t border-border bg-card/95 px-5 py-4 ">
          <Button className="w-full" onClick={() => void saveAppearance()} disabled={isSaving || !canEdit}>
            {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
            Сохранить стол
          </Button>
        </div>
      </SheetContent>
    </Sheet>
        <AddColumnDialog
          open={addColumnOpen}
          onOpenChange={setAddColumnOpen}
          workspaceId={page.workspaceId}
          pageId={page.id}
          existingColumns={columns}
          createColumn={addColumn}
        />
        <ManageOptionsDialog
          open={statusDialogOpen && permissions.canManageStatusVariants}
          onOpenChange={setStatusDialogOpen}
          title="Статусы стола"
          description="Список для столбца «Статус» на этом столе. «Готово» учитывается на дашборде."
          options={statusOptions}
          onSave={handleSaveStatuses}
          canEdit={permissions.canManageStatusVariants}
          ensureDone
        />
    </>
  );
}
