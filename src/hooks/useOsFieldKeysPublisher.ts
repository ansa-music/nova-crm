import { useEffect } from "react";
import { updatePageOsFieldKeys } from "@/services/pageService";
import { computeOsFieldKeys, sameOsFieldKeys } from "@/utils/osFieldKeys";
import type { SubPage, WorkspacePage } from "@/types";

/**
 * Держит `page.osFieldKeys` — карту «роль → ключ столбца» месячной вкладки —
 * в актуальном состоянии.
 *
 * Пишет её сессия ВЛАДЕЛЬЦА стола, когда он открыт на своей месячной
 * вкладке: только у него есть право писать документ стола, и только он видит
 * столбцы этой вкладки (подвкладки чужого стола ОС не прочитает). Запись
 * идёт ТОЛЬКО при настоящей смене состава столбцов — добавили «Апсейл»,
 * переименовали «Цену», сменился месяц. Иначе повторили бы историю deskLoad,
 * где публикация на каждый снимок съедала тысячи записей в день.
 */
export function useOsFieldKeysPublisher({
  page,
  subPage,
  canEdit,
}: {
  page: WorkspacePage | null;
  subPage: SubPage | null;
  canEdit: boolean;
}) {
  const pageId = page?.id;
  const workspaceId = page?.workspaceId;
  const subPageId = subPage?.id;
  const columns = subPage?.columns;
  const current = page?.osFieldKeys;
  const isMonthTab = Boolean(page && subPage && page.autoMonthSubPageId === subPage.id);
  // Стол ОС ведёт сам ОС, зеркалить туда нечего.
  const needed = Boolean(canEdit && isMonthTab && !page?.osDesk);

  useEffect(() => {
    if (!needed || !workspaceId || !pageId || !subPageId || !columns) return;
    const next = computeOsFieldKeys(subPageId, columns, Date.now());
    if (sameOsFieldKeys(current, next)) return;
    void updatePageOsFieldKeys(workspaceId, pageId, next).catch((error) =>
      console.warn("[os-field-keys] карта столбцов не записана:", error)
    );
  }, [needed, workspaceId, pageId, subPageId, columns, current]);
}
