import { createOneShotLoadCache, useCachedBatchLoads, type BatchLoadSpec } from "@/hooks/useCachedBatchLoads";
import { fetchSubPageRows } from "@/services/subPageService";
import { rowsBackendVersionOf } from "@/services/rows/rowsBackend";
import type { PageRow } from "@/types";

export interface SubPagePair {
  pageId: string;
  subPageId: string;
}

/**
 * Ключ строк вкладки — `pageId:subPageId`, а не один subPageId: у месячных
 * вкладок автопилота id одинаковый на всех столах (`month-YYYY-MM`,
 * monthTabId в monthTabService), и по одному subPageId строки всех таких
 * столов слипались в одни — у Owner все столы технарей показывали и
 * публиковали в leaderboard одни и те же суммы.
 */
export function subPageRowsKey(pageId: string, subPageId: string): string {
  return `${pageId}:${subPageId}`;
}

const NO_ROWS: PageRow[] = [];

const spec: BatchLoadSpec<SubPagePair, PageRow[]> = {
  keyOf: (p) => subPageRowsKey(p.pageId, p.subPageId),
  cacheKeyOf: (p) => subPageRowsKey(p.pageId, p.subPageId),
  // Версия хранилища строк — см. useMultiPageRows.
  versionOf: rowsBackendVersionOf,
  load: (workspaceId, p) => fetchSubPageRows(workspaceId, p.pageId, p.subPageId),
  empty: NO_ROWS,
  cache: createOneShotLoadCache<PageRow[]>(),
  batch: 3,
};

/**
 * Keyed by subPageRowsKey(pageId, subPageId). One-shot reads — no live
 * listeners; cached for 15 minutes (see useCachedBatchLoads).
 */
export function useMultiSubPageRows(workspaceId: string | null, pairs: SubPagePair[], bypass?: (pair: SubPagePair) => boolean) {
  return useCachedBatchLoads(workspaceId, pairs, spec, bypass);
}
