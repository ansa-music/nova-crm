import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { BarChart3, Eye, EyeOff, History, Lock, MessageSquare, Settings2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/table/DataTable";
import { SubPageTabs } from "@/components/table/SubPageTabs";
import { SubPageStats } from "@/components/table/SubPageStats";
import { EditPageDialog } from "@/components/pagesnav/EditPageDialog";
import { HistoryPanel } from "@/components/history/HistoryPanel";
import { PageChatPanel } from "@/components/chat/PageChatPanel";
import { PersonalSpacePanel } from "@/components/personal/PersonalSpacePanel";
import { toast } from "@/components/ui/sonner";
import { PAGE_ICON_MAP } from "@/utils/pageIcons";
import { useWorkspace } from "@/hooks/useWorkspace";
import { usePageRows } from "@/hooks/usePageRows";
import { useSubPages, useSubPageRows } from "@/hooks/useSubPageData";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/hooks/useAuth";
import { ensurePriceColumn, togglePageVisibility } from "@/services/pageService";
import { displayNameOf } from "@/utils/displayName";
import type { PageIconName } from "@/types";

export default function DynamicTablePage() {
  const { pageId } = useParams<{ pageId: string }>();
  const { activeWorkspaceId, pages, members } = useWorkspace();
  const permissions = usePermissions();
  const { profile } = useAuth();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [personalSpaceOpen, setPersonalSpaceOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [activeSubPageId, setActiveSubPageId] = useState<string | null>(null);

  const page = pages.find((p) => p.id === pageId);
  const hasAccess = permissions.isResolved && Boolean(page && permissions.canAccessPage(page));
  const { rows: pageRows, isLoading: pageRowsLoading } = usePageRows(activeWorkspaceId, hasAccess && page ? page.id : null);
  const { subPages } = useSubPages(activeWorkspaceId, hasAccess && page ? page.id : null);
  const activeSubPage = subPages.find((s) => s.id === activeSubPageId) ?? null;
  const { rows: subPageRows, isLoading: subPageRowsLoading } = useSubPageRows(
    activeWorkspaceId,
    hasAccess && page ? page.id : null,
    activeSubPageId
  );

  // Reset the active tab whenever navigating to a different page entirely
  // — and apply that page's own "opens by default" tab (defaultSubPageId)
  // exactly once per visit, as soon as real page data has loaded. Guarded
  // by the ref (not just [pageId]) because `page` is a fresh object on
  // every Firestore snapshot, so this effect re-runs on unrelated field
  // changes too — without the guard it would keep yanking someone back to
  // the default tab every time the page doc updates for any reason.
  const appliedDefaultForPageRef = useRef<string | null>(null);
  useEffect(() => {
    if (!page) return;
    if (appliedDefaultForPageRef.current === pageId) return;
    appliedDefaultForPageRef.current = pageId ?? null;
    setActiveSubPageId(page.defaultSubPageId ?? null);
  }, [pageId, page]);

  const rows = activeSubPageId ? subPageRows : pageRows;
  const rowsLoading = activeSubPageId ? subPageRowsLoading : pageRowsLoading;

  // Retrofit: pages created before "Цена" became a standard column don't
  // have one. If an Owner/Admin opens such a page, silently add it once
  // (no-ops server-side if a currency column already exists).
  const priceMigrationRan = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!page || !hasAccess || !permissions.canManagePage(page)) return;
    if (priceMigrationRan.current.has(page.id)) return;
    if (page.columns.some((c) => c.type === "currency")) return;
    priceMigrationRan.current.add(page.id);
    ensurePriceColumn(page.workspaceId, page.id, page.columns).catch((err) =>
      console.error("Не удалось добавить колонку «Цена»:", err)
    );
  }, [page, hasAccess, permissions.canManagePage]);

  // 1. Still resolving user -> role -> workspace -> pages. Never render a
  //    verdict here: this is precisely the window where the old code could
  //    flash "Страница не найдена" / "Access denied" and needed an F5.
  if (!permissions.isResolved) {
    return (
      <div className="p-6">
        <Skeleton className="mb-4 h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // 2. Resolved, but this account has no member record in the workspace.
  if (!permissions.hasMembership) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <Lock className="h-8 w-8 text-muted-foreground" />
        <p className="text-lg font-semibold">Вы не участник этого workspace</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Попросите владельца добавить вас — после этого страница откроется без перезагрузки.
        </p>
      </div>
    );
  }

  // 3. Resolved and a member, but the page genuinely isn't in our visible
  //    set. For a non-owner the pages query is filtered by allowedUsers, so
  //    "not in the list" and "no access" are the same fact.
  if (!page) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <Lock className="h-8 w-8 text-muted-foreground" />
        <p className="text-lg font-semibold">Страница недоступна</p>
        <p className="text-sm text-muted-foreground">
          Она удалена, либо у вас нет к ней доступа. Обратитесь к Owner workspace или к
          ответственному за страницу.
        </p>
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <Lock className="h-8 w-8 text-muted-foreground" />
        <p className="text-lg font-semibold">Нет доступа</p>
        <p className="text-sm text-muted-foreground">
          У вас нет доступа к этой странице. Обратитесь к Owner workspace, чтобы получить доступ.
        </p>
      </div>
    );
  }

  const Icon = PAGE_ICON_MAP[(page.icon as PageIconName) ?? "LayoutGrid"] ?? PAGE_ICON_MAP.LayoutGrid;
  const canEditData = permissions.canEditPageData(page);
  const isResponsible = permissions.isResponsibleForPage(page);
  // Personal Space is visible only to whoever is actually responsible for
  // THIS page (or explicitly whitelisted) — being a Manager elsewhere in the
  // workspace does not grant it. Owner keeps oversight, matching how every
  // other "responsible person" page-scoped feature in this app works.
  const canUsePersonalSpace =
    permissions.role === "owner" ||
    isResponsible ||
    Boolean(page.personalZoneAllowedUsers?.includes(permissions.uid));

  async function handleToggleVisibility() {
    if (!page) return;
    const willShow = Boolean(page.hiddenByResponsible);
    try {
      const allActiveMemberUids = members.filter((m) => m.status === "active").map((m) => m.uid);
      await togglePageVisibility(page.workspaceId, page.id, willShow, allActiveMemberUids, page.responsibleUserId);
      toast.success(
        willShow
          ? "Страница видна всем — доступ на просмотр (без редактирования)"
          : "Доступ убран у всех, кроме вас и Owner"
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось изменить видимость");
    }
  }

  return (
    <div
      className="flex h-full flex-col"
      style={page.accentColor ? ({ "--primary": page.accentColor, "--ring": page.accentColor } as React.CSSProperties) : undefined}
    >
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
        {isResponsible && (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleToggleVisibility}>
            {page.hiddenByResponsible ? (
              <>
                <EyeOff className="h-3.5 w-3.5 text-destructive" /> Скрыто от других
              </>
            ) : (
              <>
                <Eye className="h-3.5 w-3.5" /> Видно другим
              </>
            )}
          </Button>
        )}
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setChatOpen(true)}>
          <MessageSquare className="h-3.5 w-3.5" /> Чат страницы
        </Button>
        <Button
          variant={statsOpen ? "default" : "outline"}
          size="sm"
          className="gap-1.5"
          onClick={() => setStatsOpen((v) => !v)}
        >
          <BarChart3 className="h-3.5 w-3.5" /> {statsOpen ? "Скрыть статистику" : "Показать статистику"}
        </Button>
        {canUsePersonalSpace && (
          <Button
            variant={personalSpaceOpen ? "default" : "outline"}
            size="sm"
            className="gap-1.5"
            onClick={() => setPersonalSpaceOpen((v) => !v)}
          >
            <User className="h-3.5 w-3.5" /> Личное пространство
          </Button>
        )}
        {permissions.canViewHistory && (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setHistoryOpen(true)}>
            <History className="h-3.5 w-3.5" /> История
          </Button>
        )}
        {(permissions.canManagePage(page) || permissions.canAssignResponsible) && (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setSettingsOpen(true)}>
            <Settings2 className="h-3.5 w-3.5" /> Настройки
          </Button>
        )}
      </div>

      {personalSpaceOpen ? (
        <div className="flex-1 overflow-hidden">
          <PersonalSpacePanel
            workspaceId={page.workspaceId}
            pageId={page.id}
            uid={permissions.uid}
            onClose={() => setPersonalSpaceOpen(false)}
          />
        </div>
      ) : (
        <>
          <SubPageTabs
            workspaceId={page.workspaceId}
            page={page}
            subPages={subPages}
            activeSubPageId={activeSubPageId}
            onSelect={setActiveSubPageId}
            canManage={canEditData || permissions.canManagePage(page)}
            userId={profile?.uid ?? ""}
          />

          {statsOpen && <SubPageStats columns={activeSubPage ? activeSubPage.columns : page.columns} rows={rows} />}

          <div className="flex-1 overflow-hidden">
            {rowsLoading ? (
              <div className="p-6">
                <Skeleton className="h-64 w-full" />
              </div>
            ) : (
              <DataTable
                workspaceId={page.workspaceId}
                page={activeSubPage ? { ...page, columns: activeSubPage.columns } : page}
                subPageId={activeSubPage?.id}
                rows={rows}
                canEdit={canEditData}
                canEditStructure={permissions.canManagePage(page)}
                userId={profile?.uid ?? ""}
                userName={displayNameOf(profile)}
              />
            )}
          </div>
        </>
      )}

      {settingsOpen && <EditPageDialog page={page} onOpenChange={() => setSettingsOpen(false)} />}
      {permissions.canViewHistory && (
        <HistoryPanel open={historyOpen} onOpenChange={setHistoryOpen} workspaceId={page.workspaceId} pageId={page.id} columns={page.columns} />
      )}
      <PageChatPanel open={chatOpen} onOpenChange={setChatOpen} workspaceId={page.workspaceId} pageId={page.id} pageName={page.name} />
    </div>
  );
}
