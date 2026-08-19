import type { ColumnType, PageColumn, StatusOption, Workspace } from "@/types";

/**
 * Columns rendered as a colored badge + dropdown of fixed options, as
 * opposed to freeform text/number/date entry.
 */
export function isOptionColumn(type: ColumnType): boolean {
  return type === "status" || type === "responsible";
}

/**
 * Resolves the actual list of selectable options for a column.
 *
 * - "status" columns keep their own per-column list (`column.statusOptions`,
 *   set at creation and editable via the column's "Изменить тип" flow).
 * - "responsible" columns have no per-column list of their own — every
 *   "Ответственный" column on the entire site shares the ONE list stored on
 *   the workspace (`workspace.responsibleOptions`), managed exclusively by
 *   the Owner from Настройки → Workspace → «Ответственные». This is what
 *   makes a name the Owner adds there show up immediately in every table.
 */
export function getColumnOptions(column: PageColumn, workspace: Workspace | null | undefined): StatusOption[] {
  if (column.type === "responsible") return workspace?.responsibleOptions ?? [];
  return column.statusOptions ?? [];
}
