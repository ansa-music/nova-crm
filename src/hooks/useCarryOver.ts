import { useCallback, useMemo, useState } from "react";
import { toast } from "@/components/ui/sonner";
import { findMonthTab, isMonthlyDesk } from "@/services/monthTabService";
import { carryOverRows, type CarryCandidates } from "@/services/rows/carryOver";
import { useSbBackend } from "@/services/sb/sbCollections";
import { DEFAULT_STATUS_OPTIONS } from "@/utils/columnOptions";
import { firestoreErrorText } from "@/utils/dbError";
import { formatCount } from "@/utils/format";
import { periodOfTabId, periodShortLabel, previousPeriodKey, type PeriodSettings } from "@/utils/periods";
import { effectiveTechLoadKinds } from "@/utils/techLoad";
import type { PageRow, SubPage, Workspace, WorkspaceMember, WorkspacePage } from "@/types";

/** Подпись вкладки периода для плашек и тостов («16–30 сен»; у ручной вкладки — её имя). */
export function tabPeriodLabel(tab: SubPage, periods: PeriodSettings): string {
  const key = periodOfTabId(tab.id) ?? tab.monthKey;
  return key ? periodShortLabel(key, periods) : tab.name;
}

/**
 * Перенос незавершённых заказов из прошлого периода на столе технаря
 * (плашка над таблицей + окно выбора). Условия: стол технаря, открыта
 * вкладка ТЕКУЩЕГО периода (та, что завёл автопилот), вкладка прошлого
 * периода есть и не в архиве, человек вправе править строки.
 */
export function useCarryOver(input: {
  page: WorkspacePage | null;
  subPages: SubPage[];
  activeSubPageId: string | null;
  monthKey: string;
  periods: PeriodSettings;
  members: WorkspaceMember[];
  workspace: Workspace | null;
  uid: string;
  canEdit: boolean;
  /** Строки открытой (целевой) вкладки — порядок и дубли в Firestore-ветке. */
  toTabRows: PageRow[];
}) {
  const { page, subPages, activeSubPageId, monthKey, periods, members, workspace, uid, canEdit, toTabRows } = input;
  const toTab = useMemo(
    () =>
      page && activeSubPageId && page.autoMonthKey === monthKey && page.autoMonthSubPageId === activeSubPageId
        ? (subPages.find((s) => s.id === activeSubPageId) ?? null)
        : null,
    [page, activeSubPageId, monthKey, subPages]
  );
  const fromTab = useMemo(
    () => (toTab ? findMonthTab(subPages, previousPeriodKey(monthKey, periods)) : null),
    [toTab, subPages, monthKey, periods]
  );
  const eligible = Boolean(
    page &&
      !page.osDesk &&
      !page.isDashboard &&
      canEdit &&
      toTab &&
      fromTab &&
      !fromTab.isArchived &&
      fromTab.id !== toTab.id &&
      isMonthlyDesk(page, members)
  );
  const statusOptions = workspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS;
  const kinds = useMemo(() => effectiveTechLoadKinds(workspace), [workspace]);
  const deskLoadBackend = useSbBackend(workspace, "deskLoads");
  const fromLabel = fromTab ? tabPeriodLabel(fromTab, periods) : "";
  const toLabel = toTab ? tabPeriodLabel(toTab, periods) : "";

  const [dialogOpen, setDialogOpen] = useState(false);
  const [candidates, setCandidates] = useState<CarryCandidates | null>(null);
  const [busy, setBusy] = useState(false);
  // Растёт после переноса: плашка перечитывает кандидатов мимо памяти.
  const [refreshKey, setRefreshKey] = useState(0);

  const open = useCallback((next: CarryCandidates) => {
    setCandidates(next);
    setDialogOpen(true);
  }, []);

  const confirm = useCallback(
    async (rows: PageRow[]) => {
      if (!page || !fromTab || !toTab || !candidates) return;
      setBusy(true);
      try {
        const result = await carryOverRows({
          workspaceId: page.workspaceId,
          page,
          fromTab,
          toTab,
          rows,
          allFromRows: candidates.all,
          oldPeriodKey: periodOfTabId(fromTab.id) ?? fromTab.monthKey ?? previousPeriodKey(monthKey, periods),
          responsibleOptions: workspace?.responsibleOptions ?? [],
          uid,
          deskLoadBackend,
          toTabRows,
        });
        if (result.moved.length === 0) {
          toast.info(
            result.skipped.length > 0 ? "Эти заказы уже есть в этом периоде" : "Переносить нечего",
            { description: `«${toLabel}»` }
          );
        } else {
          toast.success(`Перенесено ${formatCount(result.moved.length, ["заказ", "заказа", "заказов"])} в «${toLabel}»`, {
            description: result.skipped.length > 0 ? `Уже были там: ${result.skipped.length}` : undefined,
          });
        }
        setDialogOpen(false);
        setCandidates(null);
        setRefreshKey((k) => k + 1);
      } catch (error) {
        toast.error(firestoreErrorText(error, "Не удалось перенести заказы"));
      } finally {
        setBusy(false);
      }
    },
    [page, fromTab, toTab, candidates, monthKey, periods, workspace?.responsibleOptions, uid, deskLoadBackend, toTabRows, toLabel]
  );

  return {
    eligible,
    fromTab,
    toTab,
    fromLabel,
    toLabel,
    statusOptions,
    kinds,
    dialogOpen,
    setDialogOpen,
    candidates,
    open,
    confirm,
    busy,
    refreshKey,
  };
}
