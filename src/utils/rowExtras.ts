import { formatOrderDate } from "@/utils/date";
import type { PageRow } from "@/types";

export type RowExtras = NonNullable<PageRow["extras"]>;

/** The client card («Визитка клиента») has at least one thing written in it. */
export function hasRowExtras(extras?: PageRow["extras"] | null): boolean {
  if (!extras) return false;
  return (
    extras.persons != null ||
    extras.minutes != null ||
    Boolean(extras.note?.trim()) ||
    Boolean(extras.link?.trim()) ||
    extras.deadline != null
  );
}

/** «3 перс · 2 мин», or «пожелания» when only a note is written. */
export function rowExtrasSummary(extras?: PageRow["extras"] | null): string | null {
  if (!hasRowExtras(extras)) return null;
  const parts: string[] = [];
  // Срок первым: на него смотрят чаще, чем на количество персонажей.
  if (extras!.deadline != null) parts.push(`до ${formatOrderDate(extras!.deadline)}`);
  if (extras!.persons != null) parts.push(`${extras!.persons} перс`);
  if (extras!.minutes != null) parts.push(`${extras!.minutes} мин`);
  if (parts.length === 0) return extras!.link?.trim() ? "ссылка" : "пожелания";
  return parts.join(" · ");
}

/** Drops empty fields; null when nothing is left (so the field gets removed). */
export function normalizeRowExtras(extras: RowExtras): RowExtras | null {
  const next: RowExtras = {};
  if (extras.persons != null) next.persons = extras.persons;
  if (extras.minutes != null) next.minutes = extras.minutes;
  const note = extras.note?.trim();
  if (note) next.note = note;
  const link = extras.link?.trim();
  if (link) next.link = link;
  if (extras.deadline != null && Number.isFinite(extras.deadline)) next.deadline = extras.deadline;
  return hasRowExtras(next) ? next : null;
}
