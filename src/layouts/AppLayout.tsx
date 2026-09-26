// PATH: src/layouts/AppLayout.tsx  (REPLACES EXISTING)
import { memo, useCallback, useState, useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { Building2, Lock, Plus } from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { PageShell } from "@/components/layout/PageShell";
import { Topbar } from "@/components/layout/Topbar";
import { BottomNav, useKeyboardOpen } from "@/components/layout/BottomNav";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
import { MoreSheet } from "@/components/layout/MoreSheet";
import { CreateWorkspaceDialog } from "@/components/layout/CreateWorkspaceDialog";
import { CreatePageDialog } from "@/components/pagesnav/CreatePageDialog";
import { NicknamePrompt } from "@/components/common/NicknamePrompt";
import { GlobalMessageToaster } from "@/components/common/GlobalMessageToaster";
import { AppBootScreen } from "@/components/common/AppBootScreen";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { ShortcutsHelpDialog } from "@/components/common/ShortcutsHelpDialog";
import { GlobalUndoHotkeys } from "@/components/common/GlobalUndoHotkeys";
import { GoChordHotkeys } from "@/components/common/GoChordHotkeys";
import { AppDialogHost } from "@/components/common/AppDialogHost";
import { DbQuotaBanner } from "@/components/common/DbQuotaBanner";
import { SupabaseSqlBanner } from "@/components/common/SupabaseSqlBanner";
import { NotifyHelpHost } from "@/components/common/NotifyHelpDialog";
import { OrderPopupHost } from "@/components/orders/OrderPopup";
import { TelegramUploadPill } from "@/components/telegram/TelegramUploadPill";
import { TelegramBackground } from "@/components/telegram/TelegramBackground";
import { AccentColorSync } from "@/components/common/AccentColorSync";
import { RemovedFromWorkspace } from "@/components/common/RemovedFromWorkspace";
import { Button } from "@/components/ui/button";
import { TableChromeExit } from "@/components/table/TableChromeExit";
import { useActiveWorkspaceDataBootstrap } from "@/hooks/useWorkspace";
import { NavModelProvider } from "@/hooks/useNavModel";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { useAppBootstrap } from "@/hooks/useAppBootstrap";
import { usePresenceHeartbeat } from "@/hooks/usePresenceHeartbeat";
import { useOpenApprovedDesk } from "@/hooks/useOpenApprovedDesk";
import { useMonthTabAutopilot } from "@/hooks/useMonthTabAutopilot";
import { useWeekTemplateAutopilot } from "@/hooks/useWeekTemplateAutopilot";
import { useSbImportAutopilot } from "@/hooks/useSbImportAutopilot";
import { useOrderAutoPickup } from "@/hooks/useOrderAutoPickup";
import { useOsExchangeHandoff } from "@/hooks/useOsExchangeHandoff";
import { useOsOrderClaims } from "@/hooks/useOsOrderClaims";
import { useOsDispatchLogWatch } from "@/hooks/useOsDispatchLogWatch";
import { useNotificationAlerts } from "@/hooks/useNotificationAlerts";
import { useOrderSoundBridge } from "@/hooks/useOrderSoundBridge";
import { useAppUpdateCheck } from "@/hooks/useAppUpdateCheck";
import { useDeskObserverLoad } from "@/hooks/useDeskObserverLoad";
import { useOpenOrdersWatch } from "@/hooks/useOpenOrdersWatch";
import { useRowsBackendBridge } from "@/hooks/useRowsBackendBridge";
import { useRowAclSync } from "@/hooks/useRowAclSync";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useTableDiagWatch } from "@/hooks/useTableDiagWatch";
import { useIsMobile, useIsTablet } from "@/hooks/useMediaQuery";
import { useUiStore } from "@/store/uiStore";
import { isWorkspaceAdmin } from "@/utils/adminAccess";
import { FALLBACK_JOIN_WORKSPACE_ID, getJoinIntent } from "@/utils/joinIntent";


function NoWorkspaceJoinRedirect() {
  const id = getJoinIntent() || FALLBACK_JOIN_WORKSPACE_ID;
  return <Navigate to={`/join/${id}`} replace />;
}

export function AppLayout() {
  // Hooks always run before any early return, so the subscriptions keep making
  // progress while a boot screen is on-screen.
  useActiveWorkspaceDataBootstrap();
  // Где живут строки таблиц (Firestore / Supabase) — ПЕРВЫМ: следующие хуки
  // (заезд заказа, месячные вкладки) пишут строки.
  useRowsBackendBridge();
  // Копия прав в Supabase — пока строки живут там (Owner/Тимлид; ответственный — свой стол).
  useRowAclSync();
  usePresenceHeartbeat();
  useOpenApprovedDesk();
  useMonthTabAutopilot();
  useWeekTemplateAutopilot();
  useSbImportAutopilot();
  useOrderAutoPickup();
  // «Общий» заказ со стола ОС, выданный на бирже, — заводит технарю ОС.
  useOsExchangeHandoff();
  // Заказы, записанные технарями с ником этого ОС, — сами к нему на стол.
  useOsOrderClaims();
  // «Выдачи ОС» — журнал для Тимлида и Owner (счётчик в меню и тост).
  useOsDispatchLogWatch();
  // Звук и всплывашка браузера на новое уведомление. Здесь, а не в
  // колокольчике: в полноэкранной таблице колокольчика на экране нет.
  useNotificationAlerts();
  // Звук заказа, выбранный Owner, — до того, как придёт первый заказ.
  useOrderSoundBridge();
  useAppUpdateCheck();
  // Тихое право «видит все столы» — разовое чтение своего документа.
  useDeskObserverLoad();
  // Один слушатель открытых заказов — зелёный пункт «Заказы» в меню.
  useOpenOrdersWatch();
  const { phase } = useAppBootstrap();
  // Узкий селектор, а не useWorkspace() целиком: здесь нужен только факт
  // «активный workspace есть», а не каждый снимок столов и участников.
  const hasActiveWorkspace = useWorkspaceStore((s) => s.workspaces.some((w) => w.id === s.activeWorkspaceId));
  const { profile } = useAuth();
  const permissions = usePermissions();
  const [createOpen, setCreateOpen] = useState(false);
  // Лист «Ещё» и его диалоги — здесь, а не в нижней панели: панель прячется
  // под клавиатурой, и диалог с набранным именем стола пропадал вместе с ней.
  const [moreOpen, setMoreOpen] = useState(false);
  const [createPageOpen, setCreatePageOpen] = useState(false);

  const canCreateWorkspace = isWorkspaceAdmin(profile?.email);
  // Диагностика `?diag=table`: экран загрузки и «вас убрали» подменяют всё
  // приложение — мигание стола могло бы оказаться ими.
  useTableDiagWatch("layout", {
    phase,
    hasActiveWorkspace,
    isResolved: permissions.isResolved,
    hasMembership: permissions.hasMembership,
    role: permissions.role,
  });

  // Any not-yet-resolved phase renders the shared boot screen. Crucially this
  // includes "workspace-data": members (=> role) and pages (=> access) must
  // both be in before ANY child page is allowed to evaluate permissions.
  if (phase !== "ready" && phase !== "no-workspace") {
    return <AppBootScreen phase={phase} />;
  }

  // Reached only when the workspace list has definitively resolved to empty —
  // never as a flash while it was still loading.
  if (phase === "no-workspace" || !hasActiveWorkspace) {
    return (
      <div className="cyber-grid flex h-[100dvh] flex-col items-center justify-center gap-5 bg-background px-4 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-border bg-card text-primary">
          {canCreateWorkspace ? <Building2 className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
        </div>
        {canCreateWorkspace ? (
          <>
            <div>
              <p className="eyebrow mb-2 text-primary">Workspace</p>
              <h1 className="display text-2xl">Начните с создания workspace</h1>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Workspace — это отдельное рабочее пространство со своими страницами, участниками и
                данными, например «Animation Studio» или «Finance».
              </p>
            </div>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> Создать workspace
            </Button>
            <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
          </>
        ) : (
          <NoWorkspaceJoinRedirect />
        )}
      </div>
    );
  }

  // Участников загрузили, а этого аккаунта среди них нет: его удалили из
  // workspace (id остался в профиле), либо заявку ещё не приняли. Без этой
  // ветки человек попадал в пустую оболочку без единой кнопки.
  if (permissions.isResolved && !permissions.hasMembership) {
    return <RemovedFromWorkspace />;
  }

  // Модель навигации считается здесь ОДИН раз (NavModelProvider) и
  // раздаётся меню, палитре, шапке и нижней панели контекстом.
  return (
    <NavModelProvider>
      <AppChrome
        moreOpen={moreOpen}
        setMoreOpen={setMoreOpen}
        createPageOpen={createPageOpen}
        setCreatePageOpen={setCreatePageOpen}
        createWorkspaceOpen={createOpen}
        setCreateWorkspaceOpen={setCreateOpen}
        canCreateWorkspace={canCreateWorkspace}
      />
    </NavModelProvider>
  );
}

/**
 * Сам каркас: меню, шапка, <main> с экраном, нижняя панель, лист «Ещё».
 * Отдельным `memo`-компонентом, потому что AppLayout перерисовывается на
 * каждый снимок столов и участников (его фоновые хуки и usePermissions
 * читают workspace целиком), а каркасу от этих снимков ничего не нужно —
 * меню берёт своё из навигационного контекста, экран — из своих хуков.
 * Состояние листа и диалогов остаётся в AppLayout (см. выше), сюда приходят
 * только флаги и стабильные сеттеры.
 */
const AppChrome = memo(function AppChrome({
  moreOpen,
  setMoreOpen,
  createPageOpen,
  setCreatePageOpen,
  createWorkspaceOpen,
  setCreateWorkspaceOpen,
  canCreateWorkspace,
}: {
  moreOpen: boolean;
  setMoreOpen: (open: boolean) => void;
  createPageOpen: boolean;
  setCreatePageOpen: (open: boolean) => void;
  createWorkspaceOpen: boolean;
  setCreateWorkspaceOpen: (open: boolean) => void;
  canCreateWorkspace: boolean;
}) {
  const location = useLocation();
  const isCompactNav = useIsTablet();
  const isPhone = useIsMobile();
  const keyboardOpen = useKeyboardOpen();
  const tableFullscreen = useUiStore((s) => s.tableFullscreen);
  const tableImmersive = useUiStore((s) => s.tableImmersive);
  const setTableFullscreen = useUiStore((s) => s.setTableFullscreen);
  const setTableImmersive = useUiStore((s) => s.setTableImmersive);
  // Only actually hides chrome on a table page — the setting can stay on
  // (persisted) without leaving every OTHER page in the app chrome-less too.
  const isOnTablePage = location.pathname.startsWith("/page/");
  const isFullscreen = tableFullscreen && isOnTablePage;
  const chromeHidden = isOnTablePage && (tableFullscreen || tableImmersive);
  // Нижняя панель — только телефон, и не поверх полноэкранного стола и не под
  // экранной клавиатурой (там она лишь отнимала бы у поля ввода 56px). Под
  // клавиатурой панель прячется классом, а не размонтируется.
  const mountBottomNav = isPhone && !chromeHidden;
  const showBottomNav = mountBottomNav && !keyboardOpen;
  // Стабильные колбэки: BottomNav под memo, и новая стрелка на каждый рендер
  // перерисовывала бы его зря.
  const openMore = useCallback(() => setMoreOpen(true), [setMoreOpen]);
  const openCreatePage = useCallback(() => setCreatePageOpen(true), [setCreatePageOpen]);
  const openCreateWorkspace = useCallback(() => setCreateWorkspaceOpen(true), [setCreateWorkspaceOpen]);

  useEffect(() => {
    if (!chromeHidden) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === "Escape") {
        setTableFullscreen(false);
        setTableImmersive(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [chromeHidden, setTableFullscreen, setTableImmersive]);

  return (
    // Каркас без инсета и рамки: рейка — перегородка экрана, стол начинается
    // встык с ней, на общем фоне. Полноэкранная таблица прячет и рейку.
    // `100dvh`, не `100vh`: на телефоне адресная строка иначе съедала низ
    // экрана вместе с нижней панелью. Класс `has-bottom-nav` читают итоги
    // стола и панель массовых действий (CSS у стола), пока панель на экране.
    <div className={`page-surface flex h-[100dvh] overflow-hidden bg-background ${showBottomNav ? "has-bottom-nav" : ""}`}>
      <NicknamePrompt />
      <GlobalMessageToaster />
      <GlobalSearch hideTrigger />
      <ShortcutsHelpDialog />
      <GlobalUndoHotkeys />
      <GoChordHotkeys />
      <AppDialogHost />
      <DbQuotaBanner />
      <NotifyHelpHost />
      <OrderPopupHost />
      <TelegramUploadPill />
      <TelegramBackground />
      <AccentColorSync />
      {!isCompactNav && !isFullscreen && <Sidebar />}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {!isFullscreen && <Topbar />}
        {!isFullscreen && <SupabaseSqlBanner />}
        {isFullscreen && <TableChromeExit label="Свернуть" />}
        {/* overflow-x задан явно: один `overflow-y-auto` даёт и горизонтальный
            скролл, и широкие страницы ездили бы вместе с рейкой; вбок
            прокручиваются только их собственные контейнеры. */}
        <main className={`flex min-h-0 flex-1 flex-col ${isOnTablePage ? "overflow-hidden" : "overflow-x-hidden overflow-y-auto"} scrollbar-thin`}>
          <PageShell>
            <ErrorBoundary compact key={location.pathname}>
              <Outlet />
            </ErrorBoundary>
          </PageShell>
        </main>
        {/* В потоке колонки, после <main>: fixed-панель легла бы поверх итогов
            стола и панели массовых действий. */}
        {mountBottomNav && (
          <BottomNav hidden={keyboardOpen} moreOpen={moreOpen} onMore={openMore} />
        )}
      </div>
      {isPhone && (
        <MoreSheet
          open={moreOpen}
          onOpenChange={setMoreOpen}
          onCreatePage={openCreatePage}
          onCreateWorkspace={openCreateWorkspace}
        />
      )}
      {/* Не только на телефоне: поворот в альбомную ориентацию переходит
          порог isPhone, и открытый диалог не должен от этого закрываться. */}
      <CreatePageDialog open={createPageOpen} onOpenChange={setCreatePageOpen} />
      {canCreateWorkspace && <CreateWorkspaceDialog open={createWorkspaceOpen} onOpenChange={setCreateWorkspaceOpen} />}
    </div>
  );
});
