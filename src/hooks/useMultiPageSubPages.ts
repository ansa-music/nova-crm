import { useEffect, useState } from "react";
import { subscribeToSubPages } from "@/services/subPageService";
import type { SubPage } from "@/types";

export function useMultiPageSubPages(workspaceId: string | null, pageIds: string[]) {
  const [subPagesByPage, setSubPagesByPage] = useState<Record<string, SubPage[]>>({});
  const key = pageIds.join(",");

  useEffect(() => {
    if (!workspaceId || pageIds.length === 0) {
      setSubPagesByPage({});
      return;
    }
    const unsubscribes = pageIds.map((pageId) =>
      subscribeToSubPages(workspaceId, pageId, (subPages) => {
        setSubPagesByPage((prev) => ({ ...prev, [pageId]: subPages }));
      })
    );
    return () => unsubscribes.forEach((unsub) => unsub());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, key]);

  return subPagesByPage;
}
