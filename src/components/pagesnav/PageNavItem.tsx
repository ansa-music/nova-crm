import { useState } from "react";
import { NavLink } from "react-router";
import { Copy, EyeOff, MoreHorizontal, Pencil, Pin, Settings2, Trash2 } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { toast } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { deletePage, duplicatePage, renamePage } from "@/services/pageService";
import { snapshotPage, restorePageSnapshot } from "@/services/pageSnapshotService";
import { pushUndoCommand, undo } from "@/utils/undoStore";
import { PAGE_ICON_MAP } from "@/utils/pageIcons";
import { cn } from "@/utils/cn";
import type { PageIconName, WorkspacePage } from "@/types";

interface PageNavItemProps {
  page: WorkspacePage;
  canManage: boolean;
  canDelete: boolean;
  nextOrder: number;
  onEdit: (page: WorkspacePage) => void;
  collapsed?: boolean;
  /** Is this page currently on MY OWN "hidden from my sidebar" list? Purely personal — never affects real access. */
  isHidden?: boolean;
  onToggleHidden?: (pageId: string, hide: boolean) => void;
  isPinned?: boolean;
  onTogglePin?: (pageId: string) => void;
}

export function PageNavItem({
  page,
  canManage,
  canDelete,
  nextOrder,
  onEdit,
  collapsed,
  isHidden,
  onToggleHidden,
  isPinned,
  onTogglePin,
}: PageNavItemProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftName, setDraftName] = useState(page.name);
  const Icon = PAGE_ICON_MAP[(page.icon as PageIconName) ?? "LayoutGrid"] ?? PAGE_ICON_MAP.LayoutGrid;

  if (collapsed) {
    const link = (
      <NavLink
        to={`/page/${page.id}`}
        className={({ isActive }) =>
          cn(
            "relative flex h-9 w-9 items-center justify-center rounded-md transition-colors duration-200",
            isActive ? "nav-link-active text-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent/80"
          )
        }
      >
        <Icon className="h-4 w-4" style={{ color: `hsl(${page.color})` }} />
        {isPinned && <span className="absolute right-0.5 top-0.5 h-1 w-1 rounded-full bg-primary" />}
      </NavLink>
    );
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div>
            <Tooltip>
              <TooltipTrigger asChild>{link}</TooltipTrigger>
              <TooltipContent side="right">{page.name}</TooltipContent>
            </Tooltip>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => onTogglePin?.(page.id)}>
            <Pin className="h-4 w-4" /> {isPinned ? "Открепить" : "Закрепить у себя"}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onToggleHidden?.(page.id, !isHidden)}>
            <EyeOff className="h-4 w-4" /> {isHidden ? "Показать у себя" : "Скрыть у себя"}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  async function commitRename() {
    setIsRenaming(false);
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== page.name) {
      await renamePage(page.workspaceId, page.id, trimmed);
    } else {
      setDraftName(page.name);
    }
  }

  async function handleDuplicate() {
    await duplicatePage(page.workspaceId, page, nextOrder);
    toast.success("Страница продублирована");
  }

  async function handleDelete() {
    if (!window.confirm(`Удалить страницу «${page.name}»? Это действие необратимо.`)) return;
    // Snapshot everything BEFORE deleting — deletePage is a hard delete
    // (page doc + rows + subpages + their rows, all gone), so without this
    // there'd be nothing left to restore from on Ctrl+Z.
    const snapshot = await snapshotPage(page.workspaceId, page.id);
    await deletePage(page.workspaceId, page.id);
    toast("Страница удалена", { action: { label: "Отменить", onClick: () => undo() } });
    pushUndoCommand({
      undo: () => restorePageSnapshot(page.workspaceId, page.id, snapshot),
      redo: () => deletePage(page.workspaceId, page.id),
    });
  }

  const content = isRenaming ? (
    <input
      autoFocus
      value={draftName}
      onChange={(e) => setDraftName(e.target.value)}
      onBlur={commitRename}
      onKeyDown={(e) => {
        if (e.code === "Enter") e.currentTarget.blur();
        if (e.code === "Escape") {
          setDraftName(page.name);
          setIsRenaming(false);
        }
      }}
      className="w-full rounded border border-primary bg-background px-1.5 py-0.5 text-sm outline-none"
    />
  ) : (
    <NavLink
      to={`/page/${page.id}`}
      className={({ isActive }) =>
        cn(
          "nav-link flex-1 truncate",
          isActive && "nav-link-active"
        )
      }
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded" style={{ color: `hsl(${page.color})` }}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="flex-1 truncate">{page.name}</span>
      {isPinned && <Pin className="h-3 w-3 shrink-0 fill-current text-primary" />}
    </NavLink>
  );

  if (!canManage) {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="group/item relative flex items-center">
            {content}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onTogglePin?.(page.id);
              }}
              className="absolute right-1 hidden h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-foreground group-hover/item:flex"
              title={isPinned ? "Открепить" : "Закрепить у себя"}
            >
              <Pin className={cn("h-3.5 w-3.5", isPinned && "fill-current text-primary")} />
            </button>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => onTogglePin?.(page.id)}>
            <Pin className="h-4 w-4" /> {isPinned ? "Открепить" : "Закрепить у себя"}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onToggleHidden?.(page.id, !isHidden)}>
            <EyeOff className="h-4 w-4" /> {isHidden ? "Показать у себя" : "Скрыть у себя"}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="group/item relative flex items-center">
          {content}
          {!isRenaming && (
            <div className="absolute right-1 hidden items-center group-hover/item:flex">
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onTogglePin?.(page.id);
                }}
                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                title={isPinned ? "Открепить" : "Закрепить у себя"}
              >
                <Pin className={cn("h-3.5 w-3.5", isPinned && "fill-current text-primary")} />
              </button>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  onEdit(page);
                }}
                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent"
                title="Настроить страницу"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => setIsRenaming(true)}>
          <Pencil className="h-4 w-4" /> Переименовать
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onEdit(page)}>
          <Settings2 className="h-4 w-4" /> Настройки страницы
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onTogglePin?.(page.id)}>
          <Pin className="h-4 w-4" /> {isPinned ? "Открепить" : "Закрепить у себя"}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onToggleHidden?.(page.id, !isHidden)}>
          <EyeOff className="h-4 w-4" /> {isHidden ? "Показать у себя" : "Скрыть у себя"}
        </ContextMenuItem>
        <ContextMenuItem onClick={handleDuplicate}>
          <Copy className="h-4 w-4" /> Дублировать
        </ContextMenuItem>
        {canDelete && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={handleDelete} className="text-destructive focus:text-destructive">
              <Trash2 className="h-4 w-4" /> Удалить
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
