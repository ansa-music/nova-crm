import { useState } from "react";
import { NavLink } from "react-router";
import { Copy, MoreHorizontal, Pencil, Settings2, Trash2 } from "lucide-react";
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
}

export function PageNavItem({ page, canManage, canDelete, nextOrder, onEdit, collapsed }: PageNavItemProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftName, setDraftName] = useState(page.name);
  const Icon = PAGE_ICON_MAP[(page.icon as PageIconName) ?? "LayoutGrid"] ?? PAGE_ICON_MAP.LayoutGrid;

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <NavLink
            to={`/page/${page.id}`}
            className={({ isActive }) =>
              cn(
                "flex items-center justify-center rounded-lg p-2 transition-colors",
                isActive ? "bg-sidebar-accent text-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent/60"
              )
            }
          >
            <Icon className="h-4 w-4" style={{ color: `hsl(${page.color})` }} />
          </NavLink>
        </TooltipTrigger>
        <TooltipContent side="right">{page.name}</TooltipContent>
      </Tooltip>
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
    await deletePage(page.workspaceId, page.id);
    toast.success("Страница удалена");
  }

  const content = isRenaming ? (
    <input
      autoFocus
      value={draftName}
      onChange={(e) => setDraftName(e.target.value)}
      onBlur={commitRename}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
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
          "group flex flex-1 items-center gap-2 truncate rounded-lg px-2 py-1.5 text-sm transition-colors",
          isActive
            ? "bg-sidebar-accent font-medium text-primary"
            : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
        )
      }
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded" style={{ color: `hsl(${page.color})` }}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="flex-1 truncate">{page.name}</span>
    </NavLink>
  );

  if (!canManage) {
    return <div className="flex items-center">{content}</div>;
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="group/item relative flex items-center">
          {content}
          {!isRenaming && (
            <button
              onClick={(e) => {
                e.preventDefault();
                onEdit(page);
              }}
              className="absolute right-1 hidden h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent group-hover/item:flex"
              title="Настроить страницу"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
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
