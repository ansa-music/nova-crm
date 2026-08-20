import type { ColumnType, PageColumn, StatusOption, Workspace } from "@/types";

/**
 * Columns rendered as a colored badge + dropdown of fixed options, as
 * opposed to freeform text/number/date entry.
 */
export function isOptionColumn(type: ColumnType): boolean {
  return type === "status" || type === "responsible";
}

/** Seed values shown the first time a workspace has no status list of its own yet. */
export const DEFAULT_STATUS_OPTIONS: StatusOption[] = [
  { value: "new", label: "Новый", color: "217 91% 60%" },
  { value: "in_progress", label: "В работе", color: "38 92% 50%" },
  { value: "waiting", label: "Ожидание", color: "38 92% 50%" },
  { value: "done", label: "Готово", color: "142 71% 45%" },
  { value: "cancelled", label: "Отмена", color: "240 4% 60%" },
];

/**
 * Resolves the actual list of selectable options for a column.
 *
 * Both "status" and "responsible" columns work the same way now: neither
 * keeps its own per-column list. Instead every column of that type,
 * anywhere on the whole site, shares ONE list stored on the workspace
 * (`workspace.statusOptions` / `workspace.responsibleOptions`), managed
 * exclusively by the Owner from Настройки → Workspace. Adding/renaming/
 * recoloring/removing a value there updates it everywhere at once.
 */
export function getColumnOptions(column: PageColumn, workspace: Workspace | null | undefined): StatusOption[] {
  if (column.type === "responsible") return workspace?.responsibleOptions ?? [];
  if (column.type === "status") return workspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS;
  return column.statusOptions ?? [];
}
