/**
 * Чистая логика «Грок лимита»: отметка «использовано %», сброс лимита и
 * разбор ответа ElevenLabs. Без React и без Firebase — гоняется юнит-ригом.
 *
 * Модель Grok с июня 2026: у SuperGrok ОДНА недельная квота на все продукты,
 * на grok.com → Settings → Usage видно «использовано N %» и дату/время
 * недельного сброса. Официального API к этому нет, grok.com без CORS —
 * поэтому цифры сюда переносит человек, а страница делает из них максимум:
 * подсказывает, у какого аккаунта больше запаса, и сама считает аккаунт
 * доступным, когда время сброса прошло.
 */

export interface UsageAccount {
  available?: boolean;
  limitResetAt: number | null;
  usagePct?: number | null;
  usageAt?: number;
}

export interface UsagePatch {
  usagePct: number | null;
  usageAt: number;
  available?: boolean;
  limitResetAt?: number | null;
}

/** Что строка пула пишет в аккаунт (любой из двух коллекций). */
export type PoolPatch = {
  available?: boolean;
  limitResetAt?: number | null;
  nickname?: string;
  usagePct?: number | null;
  usageAt?: number;
};

/** 0–100 целое, иначе null («не отмечали»). */
export function clampUsagePct(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Что записать, когда человек отметил «использовано N %».
 * 100 % — лимит кончился: аккаунт недоступен (время возврата — как было:
 * недельный сброс уже стоит, а без него человек ставит его пресетом).
 * Меньше 100 — человек только что видел, что аккаунт работает: доступен;
 * время сброса, если оно уже прошло, стирается, будущее остаётся.
 */
export function usagePatch(account: UsageAccount, pct: number, now: number): UsagePatch {
  const value = clampUsagePct(pct) ?? 0;
  if (value >= 100) return { usagePct: 100, usageAt: now, available: false };
  const patch: UsagePatch = { usagePct: value, usageAt: now, available: true };
  if (account.limitResetAt != null && account.limitResetAt <= now) patch.limitResetAt = null;
  return patch;
}

/**
 * Какой процент показывать: отметка устарела, если после неё прошёл сброс
 * (недельный сброс обнуляет квоту, а цифру никто не перепишет сам).
 */
export function shownUsagePct(account: UsageAccount, now: number): number | null {
  const pct = clampUsagePct(account.usagePct);
  if (pct == null) return null;
  const resetAt = account.limitResetAt;
  if (resetAt != null && resetAt <= now && (account.usageAt ?? 0) < resetAt) return null;
  return pct;
}

export type UsageTone = "success" | "warning" | "danger";

/** Цвет полоски: до 70 % спокойно, до 90 % — внимание, дальше — почти всё. */
export function usageTone(pct: number): UsageTone {
  if (pct >= 90) return "danger";
  if (pct >= 70) return "warning";
  return "success";
}

/** Быстрые отметки в popover «Использовано». */
export const USAGE_PRESETS = [0, 25, 50, 75, 90, 100] as const;

// ---------------------------------------------------------------------------
// ElevenLabs — `GET https://api.elevenlabs.io/v1/user/subscription`
// ---------------------------------------------------------------------------

export interface ElevenLabsUsage {
  /** Символов потрачено в этом периоде. */
  used: number;
  /** Символов в периоде всего. */
  limit: number;
  /** Когда счётчик обнулится (мс), null — сервис не сказал. */
  resetAt: number | null;
  /** Тариф («creator», «pro»…). */
  tier: string;
  /** «active», «trialing», «past_due»… */
  status: string;
}

/** Разбор ответа сервиса. Не тот вид — null (ключ подошёл, но ответ чужой). */
export function parseElevenLabsSubscription(json: unknown): ElevenLabsUsage | null {
  if (!json || typeof json !== "object") return null;
  const data = json as Record<string, unknown>;
  const used = Number(data.character_count);
  const limit = Number(data.character_limit);
  if (!Number.isFinite(used) || !Number.isFinite(limit)) return null;
  const resetUnix = Number(data.next_character_count_reset_unix);
  return {
    used: Math.max(0, used),
    limit: Math.max(0, limit),
    resetAt: Number.isFinite(resetUnix) && resetUnix > 0 ? resetUnix * 1000 : null,
    tier: typeof data.tier === "string" ? data.tier : "",
    status: typeof data.status === "string" ? data.status : "",
  };
}

/** Сколько осталось, 0–100 %. Лимит 0 — считаем, что всё потрачено. */
export function elevenLabsUsedPct(usage: ElevenLabsUsage): number {
  if (usage.limit <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((usage.used / usage.limit) * 100)));
}

/** «12 340 из 30 000» — пробелы-разряды, без валюты. */
export function formatChars(n: number): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.max(0, Math.round(n)));
}
