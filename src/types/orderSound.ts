/**
 * Звук уведомления о заказе — один на workspace, выбирает Owner в
 * «Настройки → Звук заказа» (просьба Nurba 25.09.2026). Лежит в документе
 * workspace (`orderSound`), Тимлиду поле закрыто правилом. Нет поля —
 * прежний звук (`assets/sounds/new-order.mp3`), громкость 90 %, один раз.
 *
 * Готовые мелодии, кроме «Классического», синтезируются в браузере
 * (`utils/orderSoundSynth.ts`) — файлов в сборке нет. Свой файл Owner
 * загружает в Supabase Storage (`services/orderSoundService.ts`).
 */
export type OrderSoundPreset = "default" | "chime" | "ring" | "marimba" | "alarm" | "soft" | "coin" | "custom";

export interface OrderSoundSettings {
  preset: OrderSoundPreset;
  /** Свой файл (preset = "custom"): публичная ссылка, путь в бакете и имя файла. */
  customUrl: string | null;
  customPath: string | null;
  customName: string | null;
  /** 0.2…1 */
  volume: number;
  /** Сколько раз проиграть подряд: 1…3. */
  repeat: number;
}

export const ORDER_SOUND_PRESETS: Array<{ id: Exclude<OrderSoundPreset, "custom">; label: string; hint: string }> = [
  { id: "default", label: "Классический", hint: "Прежний звук заказа" },
  { id: "chime", label: "Колокольчик", hint: "Два звонких удара" },
  { id: "ring", label: "Телефон", hint: "Дзынь-дзынь, как звонок" },
  { id: "marimba", label: "Маримба", hint: "Весёлая мелодия вверх" },
  { id: "alarm", label: "Тревога", hint: "Громкие короткие сигналы — не пропустить" },
  { id: "soft", label: "Мягкий", hint: "Тихий спокойный тон" },
  { id: "coin", label: "Монетка", hint: "Как звук оплаты" },
];

export const DEFAULT_ORDER_SOUND: OrderSoundSettings = {
  preset: "default",
  customUrl: null,
  customPath: null,
  customName: null,
  volume: 0.9,
  repeat: 1,
};

const PRESET_IDS = new Set<string>([...ORDER_SOUND_PRESETS.map((p) => p.id), "custom"]);

function str(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

/**
 * То, что пишется в документ workspace: все ключи явно (null, а не
 * undefined — `ignoreUndefinedProperties` выключен), числа в пределах.
 */
export function sanitizeOrderSound(input: Partial<OrderSoundSettings> | null | undefined): OrderSoundSettings {
  const preset = typeof input?.preset === "string" && PRESET_IDS.has(input.preset) ? (input.preset as OrderSoundPreset) : "default";
  const customUrl = str(input?.customUrl, 1000);
  const volumeRaw = Number(input?.volume);
  const repeatRaw = Math.round(Number(input?.repeat));
  return {
    // Свой звук без файла — это прежний звук, а не тишина.
    preset: preset === "custom" && !customUrl ? "default" : preset,
    customUrl,
    customPath: str(input?.customPath, 500),
    customName: str(input?.customName, 120),
    volume: Number.isFinite(volumeRaw) ? Math.min(1, Math.max(0.2, Math.round(volumeRaw * 100) / 100)) : DEFAULT_ORDER_SOUND.volume,
    repeat: Number.isFinite(repeatRaw) ? Math.min(3, Math.max(1, repeatRaw)) : 1,
  };
}

/** Звук workspace или умолчание — читать без `?.`. */
export function orderSoundOf(workspace: { orderSound?: Partial<OrderSoundSettings> | null } | null | undefined): OrderSoundSettings {
  return sanitizeOrderSound(workspace?.orderSound);
}
