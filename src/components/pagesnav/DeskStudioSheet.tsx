import { useEffect, useState } from "react";
import { Loader2, Palette } from "lucide-react";
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
import {
  renamePage,
  setPageAccentColor,
  setPageMonthlyGoal,
  updatePageAppearance,
} from "@/services/pageService";
import { useDeskLayout } from "@/hooks/useDeskLayout";
import { usePermissions } from "@/hooks/usePermissions";
import type { PageIconName, WorkspacePage } from "@/types";

interface DeskStudioSheetProps {
  page: WorkspacePage | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  uid?: string;
}

export function DeskStudioSheet({ page, open, onOpenChange, uid }: DeskStudioSheetProps) {
  const permissions = usePermissions();
  const { layout, setLayout } = useDeskLayout(uid ?? permissions.uid);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<PageIconName>("LayoutGrid");
  const [color, setColor] = useState("243 75% 59%");
  const [accentColor, setAccentColor] = useState<string | undefined>(undefined);
  const [goalInput, setGoalInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!page || !open) return;
    setName(page.name);
    setIcon(page.icon ?? "LayoutGrid");
    setColor(page.color ?? "243 75% 59%");
    setAccentColor(page.accentColor);
    setGoalInput(page.monthlyGoal ? String(page.monthlyGoal) : "");
  }, [page, open]);

  if (!page) return null;

  const canEdit = permissions.canManagePage(page);
  const previewStyle = {
    backgroundColor: accentColor ? `hsl(${accentColor})` : "hsl(var(--primary))",
  };

  async function saveAppearance() {
    if (!page || !canEdit) return;
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

  async function saveGoalNow() {
    if (!page || !canEdit) return;
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex h-full w-full flex-col overflow-y-auto p-0 sm:max-w-md"
      >
        <SheetHeader className="border-b border-border px-5 py-4 pr-12">
          <SheetTitle>Твой стол</SheetTitle>
          <p className="text-sm text-muted-foreground">
            Как называется, какой цвет дела и что висит на домашнем экране.
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

          <section className="flex flex-col gap-3 border-t border-border pt-6">
            <div>
              <p className="text-sm font-medium">Что висит на столе</p>
              <p className="text-xs text-muted-foreground">
                Только твой домашний экран. Список «Столы» у овнера не трогаем.
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
  );
}
