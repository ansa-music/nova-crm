import type { SortState } from "@/types";

export interface SavedTableView {
  id: string;
  name: string;
  statusFilter: string | null;
  groupByKey: string | null;
  sortState: SortState;
  filters: Record<string, string[]>;
  createdAt: number;
}

function storageKey(viewKey: string) {
  return `nova-crm:saved-views:${viewKey}`;
}

export function loadSavedTableViews(viewKey: string): SavedTableView[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(viewKey));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedTableView[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeSavedTableViews(viewKey: string, views: SavedTableView[]) {
  window.localStorage.setItem(storageKey(viewKey), JSON.stringify(views));
}

export function captureTableView(
  name: string,
  snapshot: Omit<SavedTableView, "id" | "name" | "createdAt">
): SavedTableView {
  return {
    id: `view_${Date.now().toString(36)}`,
    name: name.trim() || "Вид",
    createdAt: Date.now(),
    ...snapshot,
  };
}
