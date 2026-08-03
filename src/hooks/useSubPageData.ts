import { useEffect, useState } from "react";
import { subscribeToSubPages, subscribeToSubPageRows } from "@/services/subPageService";
import type { PageRow, SubPage } from "@/types";

export function useSubPages(workspaceId: string | null, pageId: string | null) {
  const [subPages, setSubPages] = useState<SubPage[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId || !pageId) {
      setSubPages([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const unsubscribe = subscribeToSubPages(workspaceId, pageId, (data) => {
      setSubPages(data);
      setIsLoading(false);
    });
    return unsubscribe;
  }, [workspaceId, pageId]);

  return { subPages, isLoading };
}

export function useSubPageRows(workspaceId: string | null, pageId: string | null, subPageId: string | null) {
  const [rows, setRows] = useState<PageRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId || !pageId || !subPageId) {
      setRows([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const unsubscribe = subscribeToSubPageRows(workspaceId, pageId, subPageId, (data) => {
      setRows(data);
      setIsLoading(false);
    });
    return unsubscribe;
  }, [workspaceId, pageId, subPageId]);

  return { rows, isLoading };
}
