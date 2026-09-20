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
 * Resolves selectable options for a column.
 *
 * Status, like Responsible and custom fields, is fully workspace-wide —
 * every "Статус" column on every desk shows the exact same Owner-managed
 * list, with no per-column override. A column's own `statusOptions` field
 * is deliberately never read here (see the note on that field in
 * src/types/page.ts) — it used to be preferred when non-empty, which let a
 * desk's status list quietly diverge from the shared one the moment anyone
 * created a new "Статус" column (each one seeded its own default list).
 * The responsible person for a desk can still add/rename/reorder desk
 * columns freely, just never the shared statuses themselves — that stays
 * Owner-only, enforced both here (nothing else to read) and in
 * firestore.rules (columnStatusOptionsPreserved).
 */
export function ensureDoneStatus(options: StatusOption[]): StatusOption[] {
  if (options.some((o) => isDoneStatusLabel(o.label) || o.value === "done")) return options;
  const done = DEFAULT_STATUS_OPTIONS.find((o) => o.value === "done");
  return done ? [...options, done] : options;
}

/**
 * Неактуальный вариант (ушедший ОС, отменённый статус) из СПИСКА не
 * пропадает никогда: по нему резолвятся подпись и цвет уже сохранённых
 * значений — и в этом месяце, и в прошлогодних вкладках. Прячем его только
 * там, где человек ВЫБИРАЕТ вариант, и только до нажатия «Неактуальные».
 * Поэтому `getColumnOptions` продолжает отдавать всё, а делит список эта
 * пара функций — вызывать её надо в выпадашках, а не в резолве.
 */
export function isOptionInactive(option: StatusOption): boolean {
  return option.inactive === true;
}

/**
 * Делит варианты на «предлагаем сразу» и «спрятаны под кнопкой».
 * `keepValues` — значения, которые обязаны остаться на виду, даже будучи
 * неактуальными: то, что уже стоит в этой ячейке. Иначе человек открывал бы
 * выпадашку и не видел в ней того, что сейчас выбрано.
 */
export function splitOptionsByActivity(
  options: StatusOption[],
  keepValues: Array<string | null | undefined> = []
): { active: StatusOption[]; inactive: StatusOption[] } {
  const keep = new Set(keepValues.filter((v): v is string => Boolean(v)));
  const active: StatusOption[] = [];
  const inactive: StatusOption[] = [];
  for (const option of options) {
    if (isOptionInactive(option) && !keep.has(option.value)) inactive.push(option);
    else active.push(option);
  }
  return { active, inactive };
}

export function getColumnOptions(column: PageColumn, workspace: Workspace | null | undefined): StatusOption[] {
  if (column.type === "responsible") return workspace?.responsibleOptions ?? [];
  if (column.type === "status") return ensureDoneStatus(workspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS);
  if (column.type === "custom") {
    return workspace?.customFields?.find((f) => f.id === column.customFieldId)?.options ?? [];
  }
  return column.statusOptions ?? [];
}

/**
 * A plain substring match on "готов"/"done"/"успеш"/"закрыт" also matches
 * negated statuses like "Не готово" or "Ещё не готово" (both contain
 * "готов"), which would wrongly count them as done everywhere this is used
 * (confetti, notDone filter/counter, leaderboard, markRowDone picking the
 * wrong option). Bail out first if a standalone "не" token appears
 * anywhere in the label — negation in Russian status names is written as
 * a separate word ("не готово"), so this doesn't affect real done labels
 * like "Готово"/"Закрыто"/"Отменено" (none contain a standalone "не").
 */
export function isDoneStatusLabel(label: string): boolean {
  const l = label.toLowerCase();
  if (/(^|[\s-])не([\s-]|$)/.test(l)) return false;
  return l.includes("готов") || l.includes("done") || l.includes("успеш") || l.includes("закрыт");
}

/** «Заморозка» — a paused order. Not done, but doesn't make a Технар busy on «Технари». */
export const FREEZE_STATUS_OPTION: StatusOption = { value: "freeze", label: "Заморозка", color: "189 94% 43%" };

export function isFreezeStatusLabel(label: string): boolean {
  return label.toLowerCase().includes("замороз");
}

/** Toolbar chip: hide rows whose status is «Готово». */
/**
 * Вариант «В работе» — им помечается заказ, который приехал к технарю с
 * «Заказов». Ищем по названию, а не по значению: списки статусов Owner
 * ведёт сам, и в чужом workspace «in_progress» может называться иначе.
 * «Не в работе» отсекаем — отрицание в русских статусах пишется отдельным
 * словом, как и в isDoneStatusLabel.
 */
export function findInProgressStatusOption(options: StatusOption[]): StatusOption | undefined {
  return (
    options.find((o) => {
      const l = o.label.toLowerCase();
      if (/(^|\s)не(\s|$)/.test(l)) return false;
      return l.includes("в работе") || l.includes("работа") || l.includes("progress");
    }) ?? options.find((o) => o.value === "in_progress")
  );
}

export const NOT_DONE_STATUS_FILTER = "__not_done__";

export function findDoneStatusOption(options: StatusOption[]): StatusOption | undefined {
  return options.find((o) => isDoneStatusLabel(o.label) || o.value === "done")
    ?? DEFAULT_STATUS_OPTIONS.find((o) => o.value === "done");
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
