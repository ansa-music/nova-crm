import { getDoc } from "firebase/firestore";
import { paths } from "@/firebase/firestore";
import { createOneShotLoadCache, useCachedBatchLoads, type BatchLoadSpec } from "@/hooks/useCachedBatchLoads";
import type { SubPagePair } from "@/hooks/useMultiSubPageRows";
import type { SubPage } from "@/types";

/**
 * Одна вкладка по умолчанию, а не все вкладки стола. «Дашборду» от
 * вкладок нужны только колонки вкладки по умолчанию (progressForPage), а
 * fetchSubPages читал все месячные вкладки стола — год работы это 12+
 * чтений на стол на каждый заход вместо одного.
 */
async function fetchDefaultSubPage(workspaceId: string, pair: SubPagePair): Promise<SubPage[]> {
  const snap = await getDoc(paths.subPage(workspaceId, pair.pageId, pair.subPageId));
  // Вкладки нет (удалили) — как раньше, когда её не находили в списке:
  // progressForPage возьмёт колонки самого стола.
  return snap.exists() ? [{ id: snap.id, ...snap.data() } as unknown as SubPage] : [];
}

const NO_SUBPAGES: SubPage[] = [];

const spec: BatchLoadSpec<SubPagePair, SubPage[]> = {
  keyOf: (p) => p.pageId,
  cacheKeyOf: (p) => `${p.pageId}:${p.subPageId}`,
  load: fetchDefaultSubPage,
  empty: NO_SUBPAGES,
  cache: createOneShotLoadCache<SubPage[]>(),
  batch: 4,
};

/**
 * Keyed by pageId; each value holds just that desk's default tab (or
 * nothing if it's gone). Cached for 15 minutes (see useCachedBatchLoads).
 */
export function useMultiPageSubPages(workspaceId: string | null, pairs: SubPagePair[]) {
  return useCachedBatchLoads(workspaceId, pairs, spec);
}
