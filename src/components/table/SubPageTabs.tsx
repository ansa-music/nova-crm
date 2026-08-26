import { useState } from "react";
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
import { Archive, ArchiveRestore, ArrowRightCircle, Copy, GripVertical, Plus, Star, Trash2 } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
  renameSubPage,
  reorderSubPages,
} from "@/services/subPageService";
import { setDefaultSubPage } from "@/services/pageService";
import { snapshotSubPage, restoreSubPageSnapshot } from "@/services/pageSnapshotService";
import { pushUndoCommand, undo } from "@/utils/undoStore";
import type { PageIconName, SubPage, WorkspacePage } from "@/types";

interface SubPageTabsProps {
  workspaceId: string;
  page: WorkspacePage;
  subPages: SubPage[];
  activeSubPageId: string | null;
  onSelect: (subPageId: string | null) => void;
  canManage: boolean;
  userId: string;
  showDispatchTab?: boolean;
  dispatchActive?: boolean;
  onSelectDispatch?: () => void;
}

export function SubPageTabs({
  workspaceId,
  page,
  subPages,
  activeSubPageId,
  onSelect,
  canManage,
  userId,
  showDispatchTab,
  dispatchActive,
  onSelectDispatch,
}: SubPageTabsProps) {
  const [showArchived, setShowArchived] = useState(false);
  const [duplicateTarget, setDuplicateTarget] = useState<SubPage | null>(null);
  const [duplicateMode, setDuplicateMode] = useState<"data" | "structure">("data");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const visible = subPages.filter((s) => Boolean(s.isArchived) === showArchived).sort((a, b) => a.order - b.order);
  const archivedCount = subPages.filter((s) => s.isArchived).length;

  async function handleAddTab() {
    const name = window.prompt("Название вкладки", `Вкладка ${subPages.length + 1}`);
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

  async function handleRename(sub: SubPage) {
    const name = window.prompt("Новое название", sub.name);
    if (!name || !name.trim() || name.trim() === sub.name) return;
    await renameSubPage(workspaceId, page.id, sub.id, name.trim());
  }

  async function handleArchiveToggle(sub: SubPage) {
    await archiveSubPage(workspaceId, page.id, sub.id, !sub.isArchived);
    if (activeSubPageId === sub.id) onSelect(null);
    toast.success(sub.isArchived ? "Вкладка восстановлена" : "Вкладка архивирована");
  }

  async function handleDelete(sub: SubPage) {
    if (!window.confirm(`Удалить вкладку «${sub.name}» вместе со всеми данными? Это необратимо.`)) return;
    const snapshot = await snapshotSubPage(workspaceId, page.id, sub.id);
    await deleteSubPage(workspaceId, page.id, sub.id);
    if (activeSubPageId === sub.id) onSelect(null);
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

  async function handleSetDefault(subPageId: string | null) {
    await setDefaultSubPage(workspaceId, page.id, subPageId);
    toast.success(subPageId ? "Эта вкладка теперь открывается по умолчанию" : "«Основная» теперь открывается по умолчанию");
  }

  const mainTab = (
    <button
      onClick={() => onSelect(null)}
      className={cn(
        "shrink-0 flex items-center gap-1 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
        activeSubPageId === null && !dispatchActive
          ? "border-primary/50 bg-primary/10 text-primary"
          : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
      )}
    >
      {isDefaultMain && <Star className="h-3 w-3 fill-current" />}
      Основная
    </button>
  );

  return (
    <div className="flex items-center gap-1.5 border-b border-border bg-muted/10 px-3 py-2">
      {canManage ? (
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
      )}


      {showDispatchTab ? (
        <button
          type="button"
          onClick={() => onSelectDispatch?.()}
          className={cn(
            "shrink-0 flex items-center gap-1 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
            dispatchActive
              ? "border-primary/50 bg-primary/10 text-primary"
              : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
          )}
        >
          Выдача
        </button>
      ) : null}

            <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext items={visible.map((s) => s.id)} strategy={horizontalListSortingStrategy}>
          <div className="flex flex-1 items-center gap-1 overflow-x-auto scrollbar-thin">
            {visible.map((sub) => (
              <SortableTab
                key={sub.id}
                sub={sub}
                active={activeSubPageId === sub.id}
                canManage={canManage}
                isDefault={page.defaultSubPageId === sub.id}
                onSelect={() => onSelect(sub.id)}
                onRename={() => handleRename(sub)}
                onDuplicate={() => {
                  setDuplicateTarget(sub);
                  setDuplicateMode("data");
                }}
                onNextMonth={() => handleNextMonth(sub)}
                onArchiveToggle={() => handleArchiveToggle(sub)}
                onDelete={() => handleDelete(sub)}
                onSetDefault={() => handleSetDefault(sub.id)}
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
    </div>
  );
}

interface SortableTabProps {
  sub: SubPage;
  active: boolean;
  canManage: boolean;
  isDefault: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onNextMonth: () => void;
  onArchiveToggle: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
}

function SortableTab({
  sub,
  active,
  canManage,
  isDefault,
  onSelect,
  onRename,
  onDuplicate,
  onNextMonth,
  onArchiveToggle,
  onDelete,
  onSetDefault,
}: SortableTabProps) {
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

  if (!canManage) return tab;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{tab}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onRename}>Переименовать</ContextMenuItem>
        <ContextMenuItem onClick={onSetDefault} disabled={isDefault}>
          <Star className="h-3.5 w-3.5" /> Сделать открываемой по умолчанию
        </ContextMenuItem>
        <ContextMenuItem onClick={onDuplicate}>
          <Copy className="h-3.5 w-3.5" /> Дублировать
        </ContextMenuItem>
        <ContextMenuItem onClick={onNextMonth}>
          <ArrowRightCircle className="h-3.5 w-3.5" /> Создать следующий месяц
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onArchiveToggle}>
          {sub.isArchived ? (
            <>
              <ArchiveRestore className="h-3.5 w-3.5" /> Восстановить из архива
            </>
          ) : (
            <>
              <Archive className="h-3.5 w-3.5" /> Архивировать
            </>
          )}
        </ContextMenuItem>
        <ContextMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
          <Trash2 className="h-3.5 w-3.5" /> Удалить
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
