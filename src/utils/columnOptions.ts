import type { ColumnType, CustomFieldDef, PageColumn, StatusOption, Workspace } from "@/types";

/**
 * Columns rendered as a colored badge + dropdown of fixed options, as
 * opposed to freeform text/number/date entry.
 */
export function isOptionColumn(type: ColumnType): boolean {
  return type === "status" || type === "responsible" || type === "custom";
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
  if (column.type === "custom") {
    return workspace?.customFields?.find((f) => f.id === column.customFieldId)?.options ?? [];
  }
  return column.statusOptions ?? [];
}

export const BASE_COLUMN_TYPE_LABELS: Record<Exclude<ColumnType, "custom">, string> = {
  text: "Текст",
  number: "Число",
  currency: "Валюта",
  status: "Статус",
  responsible: "Ответственный",
  date: "Дата",
  email: "Email",
  phone: "Телефон",
  url: "Ссылка",
};

export interface ColumnTypeChoice {
  /** Encoded value for a <Select> — a plain ColumnType for built-ins, "custom:<fieldId>" for a custom field. */
  value: string;
  label: string;
  type: ColumnType;
  customFieldId?: string;
}

/**
 * Builds the full list shown in "Тип столбца" — the built-in types plus
 * one entry per Owner-defined custom field (see CustomFieldDef), so a
 * custom field behaves exactly like a first-class column type once
 * created. Used by both AddColumnDialog and ColumnHeaderCell so the two
 * stay in sync automatically.
 */
export function buildColumnTypeChoices(customFields: CustomFieldDef[] = []): ColumnTypeChoice[] {
  const base = (Object.keys(BASE_COLUMN_TYPE_LABELS) as Exclude<ColumnType, "custom">[]).map((type) => ({
    value: type as string,
    label: BASE_COLUMN_TYPE_LABELS[type],
    type,
  }));
  const custom = customFields.map((f) => ({
    value: `custom:${f.id}`,
    label: f.name,
    type: "custom" as const,
    customFieldId: f.id,
  }));
  return [...base, ...custom];
}

export function encodeColumnTypeValue(type: ColumnType, customFieldId?: string): string {
  return type === "custom" && customFieldId ? `custom:${customFieldId}` : type;
}

export function decodeColumnTypeValue(value: string): { type: ColumnType; customFieldId?: string } {
  if (value.startsWith("custom:")) return { type: "custom", customFieldId: value.slice(7) };
  return { type: value as ColumnType };
}
