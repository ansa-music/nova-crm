import { createOneShotLoadCache, useCachedBatchLoads, type BatchLoadSpec } from "@/hooks/useCachedBatchLoads";
import { fetchRows } from "@/services/pageService";
import type { PageRow } from "@/types";

const NO_ROWS: PageRow[] = [];

const spec: BatchLoadSpec<string, PageRow[]> = {
  keyOf: (pageId) => pageId,
  cacheKeyOf: (pageId) => pageId,
  load: fetchRows,
  empty: NO_ROWS,
  cache: createOneShotLoadCache<PageRow[]>(),
  batch: 3,
};

/**
 * Dashboard aggregate rows of desks without a default tab, keyed by pageId.
 * One-shot reads, cached for 15 minutes (see useCachedBatchLoads).
 */
export function useMultiPageRows(workspaceId: string | null, pageIds: string[], bypass?: (pageId: string) => boolean) {
  return useCachedBatchLoads(workspaceId, pageIds, spec, bypass);
}
