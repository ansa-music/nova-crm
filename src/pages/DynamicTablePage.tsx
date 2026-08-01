import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { History, Lock, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/table/DataTable";
import { EditPageDialog } from "@/components/pagesnav/EditPageDialog";
import { HistoryPanel } from "@/components/history/HistoryPanel";
import { PAGE_ICON_MAP } from "@/utils/pageIcons";
import { useWorkspace } from "@/hooks/useWorkspace";
import { usePageRows } from "@/hooks/usePageRows";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/hooks/useAuth";
import { ensurePriceColumn } from "@/services/pageService";
import type { PageIconName } from "@/types";

export default function DynamicTablePage() {
  const { pageId } = useParams<{ pageId: string }>();
  const { activeWorkspaceId, pages, isLoadingWorkspaceData } = useWorkspace();
  const permissions = usePermissions();
  const { profile } = useAuth();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const page = pages.find((p) => p.id === pageId);
  const hasAccess = Boolean(page && permissions.canAccessPage(page));
  const { rows, isLoading: rowsLoading } = usePageRows(activeWorkspaceId, hasAccess && page ? page.id : null);

  // Retrofit: pages created before "Цена" became a standard column don't
  // have one. If an Owner/Admin opens such a page, silently add it once
  // (no-ops server-side if a currency column already exists).
  const priceMigrationRan = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!page || !hasAccess || !permissions.canEditPageStructure) return;
    if (priceMigrationRan.current.has(page.id)) return;
    if (page.columns.some((c) => c.type === "currency")) return;
    priceMigrationRan.current.add(page.id);
    ensurePriceColumn(page.workspaceId, page.id, page.columns).catch((err) =>
      console.error("Не удалось добавить колонку «Цена»:", err)
    );
  }, [page, hasAccess, permissions.canEditPageStructure]);

  if (isLoadingWorkspaceData) {
    return (
      <div className="p-6">
        <Skeleton className="mb-4 h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!page) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <p className="text-lg font-semibold">Страница не найдена</p>
        <p className="text-sm text-muted-foreground">Возможно, она была удалена или у вас нет к ней доступа.</p>
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <Lock className="h-8 w-8 text-muted-foreground" />
        <p className="text-lg font-semibold">Access denied</p>
        <p className="text-sm text-muted-foreground">
          У вас нет доступа к этой странице. Обратитесь к Owner workspace, чтобы получить доступ.
        </p>
      </div>
    );
  }

  const Icon = PAGE_ICON_MAP[(page.icon as PageIconName) ?? "LayoutGrid"] ?? PAGE_ICON_MAP.LayoutGrid;
  const canEditData = permissions.canEditPageData(page);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-6 py-4">
        <span
          className="flex h-8 w-8 items-center justify-center rounded-lg"
          style={{ backgroundColor: `hsl(${page.color} / 0.15)`, color: `hsl(${page.color})` }}
        >
          <Icon className="h-4 w-4" />
        </span>
        <h1 className="text-lg font-semibold">{page.name}</h1>
        {!canEditData && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Только просмотр</span>
        )}
        <div className="flex-1" />
        {permissions.canViewHistory && (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setHistoryOpen(true)}>
            <History className="h-3.5 w-3.5" /> История
          </Button>
        )}
        {permissions.canEditPageStructure && (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setSettingsOpen(true)}>
            <Settings2 className="h-3.5 w-3.5" /> Настройки
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-hidden">
        {rowsLoading ? (
          <div className="p-6">
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <DataTable
            workspaceId={page.workspaceId}
            page={page}
            rows={rows}
            canEdit={canEditData}
            canEditStructure={permissions.canEditPageStructure}
            userId={profile?.uid ?? ""}
            userName={profile?.name ?? "Пользователь"}
          />
        )}
      </div>

      {settingsOpen && <EditPageDialog page={page} onOpenChange={() => setSettingsOpen(false)} />}
      {permissions.canViewHistory && (
        <HistoryPanel open={historyOpen} onOpenChange={setHistoryOpen} workspaceId={page.workspaceId} pageId={page.id} />
      )}
    </div>
  );
}
