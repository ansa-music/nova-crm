import { formatOrderDate } from "@/utils/date";
import type { PageRow } from "@/types";

export type RowExtras = NonNullable<PageRow["extras"]>;

/** Текстовые поля визитки — чистятся одинаково (trim, пусто = нет). */
const TEXT_KEYS = ["note", "link", "voiceLang", "style", "tier"] as const;

/** The client card («Визитка клиента») has at least one thing written in it. */
export function hasRowExtras(extras?: PageRow["extras"] | null): boolean {
  if (!extras) return false;
  return (
    extras.persons != null ||
    extras.minutes != null ||
    extras.deadline != null ||
    extras.voice != null ||
    TEXT_KEYS.some((key) => Boolean(extras[key]?.trim()))
  );
}

/** «до 15 окт · 3 перс · 2 мин · Premium», or «пожелания» when only a note is written. */
export function rowExtrasSummary(extras?: PageRow["extras"] | null): string | null {
  if (!hasRowExtras(extras)) return null;
  const parts: string[] = [];
  // Срок первым: на него смотрят чаще, чем на количество персонажей.
  if (extras!.deadline != null) parts.push(`до ${formatOrderDate(extras!.deadline)}`);
  if (extras!.persons != null) parts.push(`${extras!.persons} перс`);
  if (extras!.minutes != null) parts.push(`${extras!.minutes} мин`);
  if (extras!.tier?.trim()) parts.push(extras!.tier.trim());
  if (parts.length > 0) return parts.join(" · ");
  if (extras!.style?.trim()) return extras!.style.trim();
  if (extras!.voice != null) return extras!.voice ? `озвучка${extras!.voiceLang?.trim() ? ` ${extras!.voiceLang.trim()}` : ""}` : "без озвучки";
  return extras!.link?.trim() ? "ссылка" : "пожелания";
}

/** Drops empty fields; null when nothing is left (so the field gets removed). */
export function normalizeRowExtras(extras: RowExtras): RowExtras | null {
  const next: RowExtras = {};
  if (extras.persons != null) next.persons = extras.persons;
  if (extras.minutes != null) next.minutes = extras.minutes;
  for (const key of TEXT_KEYS) {
    const value = extras[key]?.trim();
    if (value) next[key] = value;
  }
  if (extras.deadline != null && Number.isFinite(extras.deadline)) next.deadline = extras.deadline;
  if (extras.voice === true || extras.voice === false) next.voice = extras.voice;
  return hasRowExtras(next) ? next : null;
}

/** Визитка, где КАЖДОЕ поле присутствует (значение или null). */
export type RowExtrasFull = { [K in keyof RowExtras]-?: NonNullable<RowExtras[K]> | null };

/** Все поля визитки с явными null — для записи целиком (merge иначе оставит стёртое поле). */
export function rowExtrasWithNulls(extras: RowExtras | null): RowExtrasFull {
  return {
    persons: extras?.persons ?? null,
    minutes: extras?.minutes ?? null,
    note: extras?.note ?? null,
    link: extras?.link ?? null,
    deadline: extras?.deadline ?? null,
    voice: extras?.voice ?? null,
    voiceLang: extras?.voiceLang ?? null,
    style: extras?.style ?? null,
    tier: extras?.tier ?? null,
  };
}
