/**
 * Шансы «Рандома» (Настройки → Рандом, только Owner; просьба Nurba 03.10.2026:
 * «подкрутка шансов и настройка коэффициента», «подкрутить шансы на большие
 * чеки», «никто другой не должен про них знать»).
 *
 * - `weights` — личный множитель технаря: ×0 — не участвует в «Рандоме»,
 *   ×1 — обычный шанс (не хранится), ×3 — втрое выше.
 * - `checkBands` — пороги суммы чека по возрастанию (100 000, 300 000 → группы
 *   «до 100 тыс», «100–300 тыс», «от 300 тыс»); `bandWeights[uid][группа]` —
 *   множитель технаря на чеки этой группы.
 * - `fewerOrdersBoost` — коэффициент «меньше заказов за период — выше шанс»:
 *   у того, у кого заказов меньше всех в пуле, шанс в (1 + K) раз выше, чем у
 *   того, у кого больше всех. 0 — правило выключено.
 *
 * Хранится в Supabase `random_settings` (SQL 20261044), читает и пишет только
 * Owner; бросок делает база (`random_draw`) — выдающий шансов не видит, колесо
 * у всех с равными секторами. Здесь та же формула — для процентов у Owner.
 */
export interface RandomSettings {
  weights?: Record<string, number>;
  checkBands?: number[];
  bandWeights?: Record<string, number[]>;
  fewerOrdersBoost?: number;
}

export const RANDOM_WEIGHT_STEPS = [0, 0.5, 1, 1.5, 2, 3] as const;
export const RANDOM_WEIGHT_MAX = 3;
export const RANDOM_BOOST_MAX = 3;
export const RANDOM_BANDS_MAX = 4;
export const RANDOM_BAND_MIN = 1000;

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
  const bands = [
    ...new Set(
      (Array.isArray(input?.checkBands) ? input.checkBands : [])
        .filter((b): b is number => typeof b === "number" && Number.isFinite(b) && b >= RANDOM_BAND_MIN)
        .map((b) => Math.round(b))
    ),
  ]
    .sort((a, b) => a - b)
    .slice(0, RANDOM_BANDS_MAX);
  if (bands.length > 0) {
    out.checkBands = bands;
    const groups = bands.length + 1;
    const bandWeights: Record<string, number[]> = {};
    for (const [uid, raw] of Object.entries(input?.bandWeights ?? {})) {
      if (!uid || !Array.isArray(raw)) continue;
      const row = Array.from({ length: groups }, (_, i) => {
        const v = raw[i];
        return typeof v === "number" && Number.isFinite(v) ? clamp(v, RANDOM_WEIGHT_MAX) : 1;
      });
      if (row.some((v) => v !== 1)) bandWeights[uid] = row;
    }
    if (Object.keys(bandWeights).length > 0) out.bandWeights = bandWeights;
  }
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

/** Устойчивая подпись настройки (порядок ключей jsonb из базы не важен). */
export function randomSettingsKey(settings: RandomSettings): string {
  const clean = sanitizeRandomSettings(settings);
  const sortObj = <T,>(o: Record<string, T> | undefined) =>
    o ? Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : undefined;
  return JSON.stringify([sortObj(clean.weights) ?? null, clean.checkBands ?? null, sortObj(clean.bandWeights) ?? null, clean.fewerOrdersBoost ?? 0]);
}

/** Группа чека: число порогов, которые сумма достигла; нет суммы или порогов — -1. */
export function checkBandOf(total: number | null | undefined, bands: readonly number[] | undefined): number {
  if (!bands || bands.length === 0) return -1;
  if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) return -1;
  return bands.filter((b) => b <= total).length;
}

function money(value: number): string {
  if (value >= 1_000_000) return `${String(Math.round(value / 100_000) / 10).replace(".", ",")} млн`;
  if (value >= 1_000) return `${Math.round(value / 1_000)} тыс`;
  return String(value);
}

/** «до 100 тыс», «100–300 тыс», «от 300 тыс». */
export function checkBandLabels(bands: readonly number[] | undefined): string[] {
  if (!bands || bands.length === 0) return [];
  const out = [`до ${money(bands[0])}`];
  for (let i = 1; i < bands.length; i += 1) {
    const from = money(bands[i - 1]);
    const to = money(bands[i]);
    out.push(from.endsWith(" тыс") && to.endsWith(" тыс") ? `${from.slice(0, -4)}–${to}` : `${from}–${to}`);
  }
  out.push(`от ${money(bands[bands.length - 1])}`);
  return out;
}

export function bandRandomWeight(settings: RandomSettings, uid: string, band: number): number {
  if (band < 0) return 1;
  const v = settings.bandWeights?.[uid]?.[band];
  return typeof v === "number" ? v : 1;
}

/**
 * Вес технаря в ЭТОМ пуле: личный × множитель группы чека × (1 + K × (max − n)
 * / max), где n — его заказов за текущий период, max — наибольшее число в
 * пуле. При всех равных (и при max = 0) коэффициент ничего не меняет. Та же
 * формула — в SQL `random_draw`.
 */
export function randomWeightOf(
  uid: string,
  settings: RandomSettings,
  orderCounts: ReadonlyMap<string, number>,
  poolUids: readonly string[],
  checkTotal?: number | null
): number {
  const personal = personalRandomWeight(settings, uid) * bandRandomWeight(settings, uid, checkBandOf(checkTotal, settings.checkBands));
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
