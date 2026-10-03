/**
 * Шансы «Рандома» (Настройки → Рандом, только Owner; просьба Nurba 03.10.2026:
 * «подкрутка шансов и настройка коэффициента»).
 *
 * - `weights` — личный множитель технаря: ×0 — не участвует в «Рандоме»,
 *   ×1 — обычный шанс (не хранится), ×3 — втрое выше.
 * - `fewerOrdersBoost` — коэффициент «меньше заказов за период — выше шанс»:
 *   у того, у кого заказов меньше всех в пуле, шанс в (1 + K) раз выше, чем у
 *   того, у кого больше всех. 0 — правило выключено.
 *
 * Шансы видит только Owner: колесо у всех с равными секторами, победитель
 * выбирается по весам ДО вращения. Граница честная: документ workspace
 * читают все участники, а бросок делает браузер выдающего.
 */
export interface RandomSettings {
  weights?: Record<string, number>;
  fewerOrdersBoost?: number;
}

export const RANDOM_WEIGHT_STEPS = [0, 0.5, 1, 1.5, 2, 3] as const;
export const RANDOM_WEIGHT_MAX = 3;
export const RANDOM_BOOST_MAX = 3;

function clamp(n: number, max: number): number {
  return Math.min(max, Math.max(0, Math.round(n * 2) / 2));
}

/** Множитель 0–3 с шагом 0,5 (единицы не храним), коэффициент 0–3. */
export function sanitizeRandomSettings(input: RandomSettings | null | undefined): RandomSettings {
  const out: RandomSettings = {};
  const weights: Record<string, number> = {};
  for (const [uid, raw] of Object.entries(input?.weights ?? {})) {
    if (!uid || typeof raw !== "number" || !Number.isFinite(raw)) continue;
    const w = clamp(raw, RANDOM_WEIGHT_MAX);
    if (w !== 1) weights[uid] = w;
  }
  if (Object.keys(weights).length > 0) out.weights = weights;
  const boost = input?.fewerOrdersBoost;
  if (typeof boost === "number" && Number.isFinite(boost)) {
    const k = clamp(boost, RANDOM_BOOST_MAX);
    if (k > 0) out.fewerOrdersBoost = k;
  }
  return out;
}

export function randomSettingsOf(ws: { randomSettings?: RandomSettings } | null | undefined): RandomSettings {
  return sanitizeRandomSettings(ws?.randomSettings);
}

export function personalRandomWeight(settings: RandomSettings, uid: string): number {
  const w = settings.weights?.[uid];
  return typeof w === "number" ? w : 1;
}

/**
 * Вес технаря в ЭТОМ пуле: множитель × (1 + K × (max − n) / max), где n — его
 * заказов за текущий период, max — наибольшее число в пуле. При всех равных
 * (и при max = 0) коэффициент ничего не меняет.
 */
export function randomWeightOf(
  uid: string,
  settings: RandomSettings,
  orderCounts: ReadonlyMap<string, number>,
  poolUids: readonly string[]
): number {
  const personal = personalRandomWeight(settings, uid);
  if (personal <= 0) return 0;
  const k = settings.fewerOrdersBoost ?? 0;
  if (k <= 0) return personal;
  let max = 0;
  for (const u of poolUids) max = Math.max(max, orderCounts.get(u) ?? 0);
  if (max <= 0) return personal;
  const n = Math.min(max, orderCounts.get(uid) ?? 0);
  return personal * (1 + (k * (max - n)) / max);
}

/** Шансы в процентах (сумма 100 по наибольшему остатку) — для показа Owner. */
export function chancePercents(uids: readonly string[], weightOf: (uid: string) => number): Map<string, number> {
  const weights = uids.map((u) => Math.max(0, weightOf(u)));
  const total = weights.reduce((a, b) => a + b, 0);
  const out = new Map<string, number>();
  if (total <= 0) {
    for (const u of uids) out.set(u, 0);
    return out;
  }
  const raw = weights.map((w) => (w / total) * 100);
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - floors[i] })).sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (left <= 0) break;
    if (weights[i] <= 0) continue;
    floors[i] += 1;
    left -= 1;
  }
  uids.forEach((u, i) => out.set(u, floors[i]));
  return out;
}
