import { Fragment, useState, type ReactNode } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Archive,
  ArchiveRestore,
  ArrowRightCircle,
  Copy,
  ExternalLink,
  GripVertical,
  Pencil,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { PAGE_ICON_MAP } from "@/utils/pageIcons";
import { cn } from "@/utils/cn";
import {
  archiveSubPage,
  createNextMonthSubPage,
  createSubPage,
  deleteSubPage,
  duplicateSubPage,
  monthShortNameForKey,
  renameSubPage,
  reorderSubPages,
} from "@/services/subPageService";
import { ensureMonthTabForKey, findMonthTab, nextMonthKey, previousMonthKey } from "@/services/monthTabService";
import { setDefaultSubPage } from "@/services/pageService";
import { snapshotSubPage, restoreSubPageSnapshot } from "@/services/pageSnapshotService";
import { pushUndoCommand, undo } from "@/utils/undoStore";
import type { SubPage, WorkspacePage } from "@/types";
import { confirmDialog, promptDialog } from "@/utils/appDialog";

interface SubPageTabsProps {
  workspaceId: string;
  page: WorkspacePage;
  subPages: SubPage[];
  activeSubPageId: string | null;
  onSelect: (subPageId: string | null) => void;
  /** May manage the tabs themselves (create/rename/archive/reorder) — every one of those writes only the subpage doc, which any page editor may do. */
  canManage: boolean;
  /**
   * May mark a tab as the one the desk opens on. Deliberately separate from
   * canManage: this single action writes `defaultSubPageId` on the PAGE doc,
   * which firestore.rules only lets the Owner or the desk's responsible
   * person update — an editor's write is rejected outright.
   */
  canSetDefault: boolean;
  userId: string;
  /** Текущий месяц по Алматы ("YYYY-MM") — центр сегмента месяцев. */
  monthKey: string;
  /**
   * Стол ведёт месячный автопилот (isMonthlyDesk). Немесячный стол без
   * единой месячной вкладки показывает старый ряд вкладок, а не пустой
   * сегмент из трёх выключенных кнопок.
   */
  isMonthly: boolean;
}

/**
 * Один сегмент «прошлый | текущий | следующий»: либо вкладка месяца, либо
 * «Основная» стола ОС (её главную вкладку назвали месяцем — см.
 * page.mainTabMonthKey), либо пусто.
 */
interface MonthSegment {
  key: string;
  label: string;
  tab: SubPage | null;
  isMain: boolean;
  slot: "prev" | "current" | "next";
}

/** Пункт меню вкладки — один список действий и для правого клика, и для «···». */
interface TabAction {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  separatorBefore?: boolean;
}

export function SubPageTabs({
  workspaceId,
  page,
  subPages,
  activeSubPageId,
  onSelect,
  canManage,
  canSetDefault,
  userId,
  monthKey,
  isMonthly,
}: SubPageTabsProps) {
  const [showArchived, setShowArchived] = useState(false);
  const [duplicateTarget, setDuplicateTarget] = useState<SubPage | null>(null);
  const [duplicateMode, setDuplicateMode] = useState<"data" | "structure">("data");
  const [creatingMonth, setCreatingMonth] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const visible = subPages.filter((s) => !s.isArchived).sort((a, b) => a.order - b.order);
  const archived = subPages.filter((s) => s.isArchived).sort((a, b) => a.order - b.order);
  const archivedCount = archived.length;

  async function handleAddTab() {
    const name = await promptDialog({ title: "Новая вкладка", label: "Название", defaultValue: `Вкладка ${subPages.length + 1}`, maxLength: 60, confirmLabel: "Создать" });
    if (!name || !name.trim()) return;
    try {
      const created = await createSubPage({
        workspaceId,
        pageId: page.id,
        name: name.trim(),
        color: page.color,
        icon: page.icon,
        columns: page.columns,
        order: subPages.length,
        createdBy: userId,
      });
      onSelect(created.id);
      toast.success(`Вкладка «${created.name}» создана`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось создать вкладку");
    }
  }

  async function handleNextMonth(current: SubPage) {
    try {
      const created = await createNextMonthSubPage(workspaceId, page.id, current, subPages.length, userId);
      onSelect(created.id);
      toast.success(`Создана вкладка «${created.name}»`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось создать следующий месяц");
    }
  }

  /** Сегмент «следующий» без вкладки: заводим её и сразу открываем. */
  async function handleCreateMonth(key: string) {
    if (creatingMonth) return;
    setCreatingMonth(key);
    try {
      const { tab, restored } = await ensureMonthTabForKey(page, key, userId);
      onSelect(tab.id);
      toast.success(restored ? `Вкладка «${tab.name}» восстановлена из архива` : `Вкладка «${tab.name}» создана`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось создать вкладку месяца");
    } finally {
      setCreatingMonth(null);
    }
  }

  async function handleRename(sub: SubPage) {
    const name = await promptDialog({ title: "Переименовать вкладку", label: "Название", defaultValue: sub.name, maxLength: 60 });
    if (!name || !name.trim() || name.trim() === sub.name) return;
    await renameSubPage(workspaceId, page.id, sub.id, name.trim());
  }

  async function handleArchiveToggle(sub: SubPage) {
    await archiveSubPage(workspaceId, page.id, sub.id, !sub.isArchived);
    if (activeSubPageId === sub.id) selectAwayFrom(sub.id);
    toast.success(sub.isArchived ? "Вкладка восстановлена" : "Вкладка архивирована");
  }

  async function handleDelete(sub: SubPage) {
    if (!(await confirmDialog({ title: `Удалить вкладку «${sub.name}»?`, description: "Вкладка удаляется вместе со всеми строками. Сразу после удаления действие можно отменить через Ctrl+Z.", destructive: true }))) return;
    const snapshot = await snapshotSubPage(workspaceId, page.id, sub.id);
    await deleteSubPage(workspaceId, page.id, sub.id);
    if (activeSubPageId === sub.id) selectAwayFrom(sub.id);
    toast("Вкладка удалена", { action: { label: "Отменить", onClick: () => undo() } });
    pushUndoCommand({
      undo: () => restoreSubPageSnapshot(workspaceId, page.id, sub.id, snapshot),
      redo: () => deleteSubPage(workspaceId, page.id, sub.id),
    });
  }

  async function confirmDuplicate() {
    if (!duplicateTarget) return;
    try {
      const copy = await duplicateSubPage(
        workspaceId,
        page.id,
        duplicateTarget,
        subPages.length,
        userId,
        duplicateMode === "data"
      );
      onSelect(copy.id);
      toast.success(`Вкладка «${copy.name}» создана`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось дублировать вкладку");
    } finally {
      setDuplicateTarget(null);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = visible.findIndex((s) => s.id === active.id);
    const newIndex = visible.findIndex((s) => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(visible, oldIndex, newIndex);
    reorderSubPages(workspaceId, page.id, reordered.map((s) => s.id));
  }

  const isDefaultMain = !page.defaultSubPageId;
  // hideMainTab is written on the page doc the moment a desk is created, and
  // the month tab lands a write later — so a desk whose seeding never
  // finished (or whose last tab was deleted) has hideMainTab with nothing to
  // show instead, and the tab bar renders empty with no way back to
  // «Основная». Hiding the main tab only makes sense when another tab exists.
  const hideMain = Boolean(page.hideMainTab) && visible.length > 0;
  const mainLabel = page.mainTabName?.trim() || "Основная";

  function selectAwayFrom(subId: string) {
    const next = visible.find((s) => s.id !== subId);
    if (next) {
      onSelect(next.id);
      return;
    }
    onSelect(hideMain ? subId : null);
  }

  async function handleSetDefault(subPageId: string | null) {
    try {
      await setDefaultSubPage(workspaceId, page.id, subPageId);
      toast.success(subPageId ? "Эта вкладка теперь открывается по умолчанию" : "«Основная» теперь открывается по умолчанию");
    } catch (error) {
      // Was unhandled: a rejected write left the star where it was with no
      // toast at all, so the action just looked like it did nothing.
      toast.error(error instanceof Error ? error.message : "Не удалось изменить вкладку по умолчанию");
    }
  }

  /** Действия над вкладкой — одни и те же в правом клике и в «···». */
  function tabActions(sub: SubPage, withOpen: boolean): TabAction[] {
    const actions: TabAction[] = [];
    if (withOpen) {
      actions.push({ label: "Открыть", icon: <ExternalLink className="h-3.5 w-3.5" />, onClick: () => onSelect(sub.id) });
    }
    if (!canManage) return actions;
    actions.push({ label: "Переименовать", icon: <Pencil className="h-3.5 w-3.5" />, onClick: () => void handleRename(sub), separatorBefore: withOpen });
    if (canSetDefault) {
      actions.push({
        label: "Сделать открываемой по умолчанию",
        icon: <Star className="h-3.5 w-3.5" />,
        onClick: () => void handleSetDefault(sub.id),
        disabled: page.defaultSubPageId === sub.id,
      });
    }
    actions.push({
      label: "Дублировать",
      icon: <Copy className="h-3.5 w-3.5" />,
      onClick: () => {
        setDuplicateTarget(sub);
        setDuplicateMode("data");
      },
    });
    actions.push({ label: "Создать следующий месяц", icon: <ArrowRightCircle className="h-3.5 w-3.5" />, onClick: () => void handleNextMonth(sub) });
    actions.push({
      label: sub.isArchived ? "Восстановить из архива" : "Архивировать",
      icon: sub.isArchived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />,
      onClick: () => void handleArchiveToggle(sub),
      separatorBefore: true,
    });
    actions.push({ label: "Удалить", icon: <Trash2 className="h-3.5 w-3.5" />, onClick: () => void handleDelete(sub), destructive: true });
    return actions;
  }

  function mainActions(withOpen: boolean): TabAction[] {
    const actions: TabAction[] = [];
    if (withOpen) actions.push({ label: "Открыть", icon: <ExternalLink className="h-3.5 w-3.5" />, onClick: () => onSelect(null) });
    if (canSetDefault) {
      actions.push({
        label: "Сделать открываемой по умолчанию",
        icon: <Star className="h-3.5 w-3.5" />,
        onClick: () => void handleSetDefault(null),
        disabled: isDefaultMain,
        separatorBefore: withOpen,
      });
    }
    return actions;
  }

  // Сегмент «прошлый | текущий | следующий»: ключи от текущего месяца по
  // Алматы, вкладки — по id month-YYYY-MM, sub.monthKey или имени. У стола
  // ОС главная вкладка сама названа месяцем — тогда сегмент ведёт на неё.
  const segmentKeys: Array<[string, MonthSegment["slot"]]> = [
    [previousMonthKey(monthKey), "prev"],
    [monthKey, "current"],
    [nextMonthKey(monthKey), "next"],
  ];
  const segments: MonthSegment[] = segmentKeys.map(([key, slot]) => {
    const isMain = !hideMain && page.mainTabMonthKey === key;
    // findMonthTab по id отдаёт и архивную вкладку — в сегменте она была бы
    // живой кнопкой на скрытую вкладку. Архивные живут в списке «Архив»;
    // сегмент считает месяц пустым, и «следующий» её восстановит.
    const found = isMain ? null : findMonthTab(subPages, key);
    return { key, slot, label: monthShortNameForKey(key), isMain, tab: found && !found.isArchived ? found : null };
  });
  const segmentTabIds = new Set(segments.flatMap((s) => (s.tab ? [s.tab.id] : [])));
  const mainInSegment = segments.some((s) => s.isMain);
  const anySegmentFound = segments.some((s) => s.tab || s.isMain);
  // Немесячный стол без единой месячной вкладки — старый ряд вкладок с
  // перетаскиванием: три выключенных месяца там ничего бы не значили.
  const legacyRow = !isMonthly && !anySegmentFound;
  const restTabs = visible.filter((s) => !segmentTabIds.has(s.id));

  const duplicateDialog = (
    <Dialog open={Boolean(duplicateTarget)} onOpenChange={(o) => !o && setDuplicateTarget(null)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Дублировать «{duplicateTarget?.name}»</DialogTitle>
          <DialogDescription>Выберите, что скопировать в новую вкладку.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <button
            onClick={() => setDuplicateMode("data")}
            className={cn(
              "flex items-center gap-2 rounded-lg border p-3 text-left text-sm transition-colors",
              duplicateMode === "data" ? "border-primary bg-primary/5" : "border-border"
            )}
          >
            <span
              className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2",
                duplicateMode === "data" ? "border-primary" : "border-muted-foreground"
              )}
            >
              {duplicateMode === "data" && <span className="h-2 w-2 rounded-full bg-primary" />}
            </span>
            Копировать данные (со всеми строками)
          </button>
          <button
            onClick={() => setDuplicateMode("structure")}
            className={cn(
              "flex items-center gap-2 rounded-lg border p-3 text-left text-sm transition-colors",
              duplicateMode === "structure" ? "border-primary bg-primary/5" : "border-border"
            )}
          >
            <span
              className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2",
                duplicateMode === "structure" ? "border-primary" : "border-muted-foreground"
              )}
            >
              {duplicateMode === "structure" && <span className="h-2 w-2 rounded-full bg-primary" />}
            </span>
            Только структуру (пустая таблица)
          </button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDuplicateTarget(null)}>
            Отмена
          </Button>
          <Button onClick={confirmDuplicate}>Дублировать</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (legacyRow) {
    const legacyVisible = showArchived ? archived : visible;
    const mainTab = (
      <button
        onClick={() => onSelect(null)}
        className={cn(
          "shrink-0 flex items-center gap-1 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
          activeSubPageId === null
            ? "border-primary/50 bg-primary/10 text-primary"
            : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
        )}
      >
        {isDefaultMain && <Star className="h-3 w-3 fill-current" />}
        {mainLabel}
      </button>
    );

    return (
      <div className="flex min-w-0 items-center gap-1.5">
        {!hideMain && (canSetDefault ? (
          <ContextMenu>
            <ContextMenuTrigger asChild>{mainTab}</ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onClick={() => handleSetDefault(null)} disabled={isDefaultMain}>
                <Star className="h-3.5 w-3.5" /> Сделать открываемой по умолчанию
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ) : (
          mainTab
        ))}

        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext items={legacyVisible.map((s) => s.id)} strategy={horizontalListSortingStrategy}>
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-thin">
              {legacyVisible.map((sub) => (
                <SortableTab
                  key={sub.id}
                  sub={sub}
                  active={activeSubPageId === sub.id}
                  canManage={canManage}
                  isDefault={page.defaultSubPageId === sub.id}
                  onSelect={() => onSelect(sub.id)}
                  actions={tabActions(sub, false)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {canManage && !showArchived && (
          <button
            onClick={handleAddTab}
            className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1.5 text-sm text-muted-foreground hover:bg-card/60 hover:text-foreground"
            title="Добавить вкладку"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}

        {archivedCount > 0 && (
          <button
            onClick={() => setShowArchived((v) => !v)}
            className={cn(
              "ml-auto shrink-0 flex items-center gap-1 rounded-full px-2.5 py-1 font-mono text-xs",
              showArchived ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Archive className="h-3 w-3" /> Архив ({archivedCount})
          </button>
        )}

        {duplicateDialog}
      </div>
    );
  }

  const segmentButtonClass = (active: boolean) =>
    cn(
      "h-9 shrink-0 rounded-md px-3 text-[12.5px] font-medium transition-colors sm:h-7 sm:px-2.5",
      active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
      "disabled:cursor-default disabled:text-muted-foreground/50 disabled:hover:text-muted-foreground/50"
    );

  function renderSegment(seg: MonthSegment) {
    if (seg.isMain) {
      const active = activeSubPageId === null;
      const button = (
        <button key={seg.key} type="button" onClick={() => onSelect(null)} className={segmentButtonClass(active)} title={mainLabel}>
          {seg.label}
        </button>
      );
      const actions = mainActions(false);
      if (!actions.length) return button;
      return (
        <ContextMenu key={seg.key}>
          <ContextMenuTrigger asChild>{button}</ContextMenuTrigger>
          <ContextMenuContent>{renderContextItems(actions)}</ContextMenuContent>
        </ContextMenu>
      );
    }
    if (seg.tab) {
      const sub = seg.tab;
      const active = activeSubPageId === sub.id;
      const button = (
        <button key={seg.key} type="button" onClick={() => onSelect(sub.id)} className={segmentButtonClass(active)} title={sub.name}>
          {seg.label}
        </button>
      );
      const actions = tabActions(sub, false);
      if (!actions.length) return button;
      return (
        <ContextMenu key={seg.key}>
          <ContextMenuTrigger asChild>{button}</ContextMenuTrigger>
          <ContextMenuContent>{renderContextItems(actions)}</ContextMenuContent>
        </ContextMenu>
      );
    }
    // Следующий месяц заводится прямо отсюда; прошлого и текущего без
    // вкладки не бывает у живого стола — там просто нечего открывать.
    const canCreate = seg.slot === "next" && canManage;
    return (
      <button
        key={seg.key}
        type="button"
        disabled={!canCreate || creatingMonth !== null}
        onClick={canCreate ? () => void handleCreateMonth(seg.key) : undefined}
        className={segmentButtonClass(false)}
        title={canCreate ? `Создать вкладку «${monthShortNameForKey(seg.key)}»` : "Вкладки нет"}
      >
        {creatingMonth === seg.key ? "…" : seg.label}
      </button>
    );
  }

  return (
    <div className="flex min-w-0 items-center">
      <div className="inline-flex items-center rounded-lg border border-border p-0.5">
        {segments.map(renderSegment)}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="h-9 shrink-0 rounded-md px-2.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground sm:h-7 sm:px-2"
              aria-label="Все вкладки"
              title="Все вкладки"
            >
              ···
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[12rem]">
            {restTabs.map((sub) => (
              <TabMenuEntry
                key={sub.id}
                label={sub.name}
                icon={<Star className={cn("h-3 w-3 shrink-0", page.defaultSubPageId === sub.id ? "fill-current" : "invisible")} />}
                active={activeSubPageId === sub.id}
                onOpen={() => onSelect(sub.id)}
                actions={tabActions(sub, true)}
              />
            ))}
            {!hideMain && !mainInSegment && (
              <TabMenuEntry
                label={mainLabel}
                icon={<Star className={cn("h-3 w-3 shrink-0", isDefaultMain ? "fill-current" : "invisible")} />}
                active={activeSubPageId === null}
                onOpen={() => onSelect(null)}
                actions={mainActions(true)}
              />
            )}
            {archivedCount > 0 && (
              <>
                {(restTabs.length > 0 || (!hideMain && !mainInSegment)) && <DropdownMenuSeparator />}
                <DropdownMenuLabel className="flex items-center gap-1.5">
                  <Archive className="h-3 w-3" /> Архив ({archivedCount})
                </DropdownMenuLabel>
                {archived.map((sub) => (
                  <TabMenuEntry
                    key={sub.id}
                    label={sub.name}
                    active={activeSubPageId === sub.id}
                    onOpen={() => onSelect(sub.id)}
                    actions={
                      canManage
                        ? [
                            { label: "Открыть", icon: <ExternalLink className="h-3.5 w-3.5" />, onClick: () => onSelect(sub.id) },
                            { label: "Восстановить из архива", icon: <ArchiveRestore className="h-3.5 w-3.5" />, onClick: () => void handleArchiveToggle(sub) },
                            { label: "Удалить", icon: <Trash2 className="h-3.5 w-3.5" />, onClick: () => void handleDelete(sub), destructive: true, separatorBefore: true },
                          ]
                        : []
                    }
                  />
                ))}
              </>
            )}
            {canManage && (
              <>
                {(restTabs.length > 0 || archivedCount > 0 || (!hideMain && !mainInSegment)) && <DropdownMenuSeparator />}
                <DropdownMenuItem onClick={() => void handleAddTab()}>
                  <Plus className="h-3.5 w-3.5" /> Новая вкладка
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {duplicateDialog}
    </div>
  );
}

function renderContextItems(actions: TabAction[]) {
  return actions.map((a, i) => (
    <Fragment key={`${a.label}-${i}`}>
      {a.separatorBefore && i > 0 && <ContextMenuSeparator />}
      <ContextMenuItem onClick={a.onClick} disabled={a.disabled} className={cn(a.destructive && "text-destructive focus:text-destructive")}>
        {a.icon} {a.label}
      </ContextMenuItem>
    </Fragment>
  ));
}

/**
 * Вкладка в меню «···»: с действиями — подменю (открыть, переименовать…),
 * без них (нет прав) — обычный пункт, который просто открывает вкладку.
 */
function TabMenuEntry({
  label,
  icon,
  active,
  onOpen,
  actions,
}: {
  label: string;
  icon?: ReactNode;
  active: boolean;
  onOpen: () => void;
  actions: TabAction[];
}) {
  const title = (
    <>
      {icon}
      <span className={cn("max-w-[200px] truncate", active && "font-semibold text-foreground")}>{label}</span>
    </>
  );
  if (actions.length <= 1) {
    return (
      <DropdownMenuItem onClick={onOpen} className="gap-1.5">
        {title}
      </DropdownMenuItem>
    );
  }
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="gap-1.5">{title}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {actions.map((a, i) => (
          <Fragment key={`${a.label}-${i}`}>
            {a.separatorBefore && i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem onClick={a.onClick} disabled={a.disabled} className={cn(a.destructive && "text-destructive focus:text-destructive")}>
              {a.icon} {a.label}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

interface SortableTabProps {
  sub: SubPage;
  active: boolean;
  canManage: boolean;
  isDefault: boolean;
  onSelect: () => void;
  /** Пункты правого клика — из tabActions родителя, чтобы логика была одна. */
  actions: TabAction[];
}

function SortableTab({ sub, active, canManage, isDefault, onSelect, actions }: SortableTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: sub.id });
  const Icon = PAGE_ICON_MAP[sub.icon] ?? PAGE_ICON_MAP.LayoutGrid;

  const tab = (
    <button
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}
      onClick={onSelect}
      className={cn(
        "group flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
        active
          ? "border-primary/50 bg-primary/10 text-primary"
          : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
      )}
    >
      {canManage && (
        <span {...attributes} {...listeners} className="cursor-grab opacity-0 group-hover:opacity-60 active:cursor-grabbing">
          <GripVertical className="h-3 w-3" />
        </span>
      )}
      {isDefault && <Star className="h-3 w-3 shrink-0 fill-current" />}
      <span style={{ color: `hsl(${sub.color})` }}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="max-w-[140px] truncate">{sub.name}</span>
    </button>
  );

  if (!canManage || !actions.length) return tab;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{tab}</ContextMenuTrigger>
      <ContextMenuContent>{renderContextItems(actions)}</ContextMenuContent>
    </ContextMenu>
  );
}
