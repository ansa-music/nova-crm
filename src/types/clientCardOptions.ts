/**
 * Варианты «Визитки клиента», которые задаёт Owner («Настройки → Визитка»,
 * просьба Nurba 25.09.2026): языки озвучки, стили и уровни заказа. Лежат в
 * документе workspace (`clientCardOptions`), Тимлиду поле закрыто правилом.
 * Нет поля — умолчания ниже. В самой визитке рядом с вариантами всегда есть
 * «свой» — ввод текста, поэтому списки только подсказывают частое.
 */
export interface ClientCardOptions {
  /** Языки озвучки: «ru», «kz», «en»… */
  languages: string[];
  /** Стили: «Pixar»… */
  styles: string[];
  /** Уровни заказа: «База», «Premium», «Ultima»… */
  tiers: string[];
}

export const DEFAULT_CLIENT_CARD_OPTIONS: ClientCardOptions = {
  languages: ["ru", "kz", "en"],
  styles: ["Pixar"],
  tiers: ["База", "Premium", "Ultima"],
};

export const CLIENT_CARD_OPTION_MAX_ITEMS = 12;
export const CLIENT_CARD_OPTION_MAX_LENGTH = 24;

function cleanList(input: unknown, fallback: string[]): string[] {
  if (!Array.isArray(input)) return [...fallback];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const value = raw.trim().slice(0, CLIENT_CARD_OPTION_MAX_LENGTH);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= CLIENT_CARD_OPTION_MAX_ITEMS) break;
  }
  // Пустой список бессмысленен: чипов нет — остаётся один «свой». Тогда умолчания.
  return out.length > 0 ? out : [...fallback];
}

/** Списки без пустых, дублей и хвостов — то, что пишется в документ workspace. */
export function sanitizeClientCardOptions(input: Partial<ClientCardOptions> | null | undefined): ClientCardOptions {
  return {
    languages: cleanList(input?.languages, DEFAULT_CLIENT_CARD_OPTIONS.languages),
    styles: cleanList(input?.styles, DEFAULT_CLIENT_CARD_OPTIONS.styles),
    tiers: cleanList(input?.tiers, DEFAULT_CLIENT_CARD_OPTIONS.tiers),
  };
}

/** Варианты workspace или умолчания — читать без `?.`. */
export function clientCardOptionsOf(workspace: { clientCardOptions?: Partial<ClientCardOptions> | null } | null | undefined): ClientCardOptions {
  return sanitizeClientCardOptions(workspace?.clientCardOptions);
}
