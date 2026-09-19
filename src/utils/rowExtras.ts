import type { PageRow } from "@/types";

export type RowExtras = NonNullable<PageRow["extras"]>;

/** The client card («Визитка клиента») has at least one thing written in it. */
export function hasRowExtras(extras?: PageRow["extras"] | null): boolean {
  if (!extras) return false;
  return extras.persons != null || extras.minutes != null || Boolean(extras.note?.trim()) || Boolean(extras.link?.trim());
}

/** «3 перс · 2 мин», or «пожелания» when only a note is written. */
export function rowExtrasSummary(extras?: PageRow["extras"] | null): string | null {
  if (!hasRowExtras(extras)) return null;
  const parts: string[] = [];
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
  return hasRowExtras(next) ? next : null;
}
