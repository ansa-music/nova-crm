import type { OrderSoundPreset } from "@/types/orderSound";

/**
 * Готовые мелодии звука заказа, собранные в браузере в WAV (моно, 16 бит).
 * Файлов в сборке нет — только ноты ниже. Именно WAV, а не голые осцилляторы:
 * так мелодия идёт тем же путём, что и файл (AudioBuffer и запасной `<audio>`,
 * который на iPhone играет вне жеста), и громкость/повтор работают одинаково.
 */

const RATE = 22050;

type Shape = "sine" | "bell" | "square" | "tri" | "marimba";

interface Note {
  /** Начало, с. */
  at: number;
  freq: number;
  /** Длительность, с. */
  dur: number;
  gain: number;
  shape: Shape;
  /** Вторая частота одновременно (гудок телефона — 440 + 480). */
  freq2?: number;
}

const SCORES: Record<Exclude<OrderSoundPreset, "default" | "custom">, Note[]> = {
  chime: [
    { at: 0, freq: 1318.5, dur: 1.1, gain: 0.55, shape: "bell" },
    { at: 0.2, freq: 1975.5, dur: 1.3, gain: 0.5, shape: "bell" },
  ],
  ring: [0, 0.5, 1.4, 1.9].map((at) => ({ at, freq: 440, freq2: 480, dur: 0.38, gain: 0.45, shape: "sine" as Shape })),
  marimba: [523.25, 659.25, 783.99, 1046.5].map((freq, i) => ({ at: i * 0.13, freq, dur: 0.5, gain: 0.6, shape: "marimba" as Shape })),
  alarm: [988, 1318.5, 988, 1318.5, 988, 1318.5].map((freq, i) => ({ at: i * 0.2, freq, dur: 0.15, gain: 0.32, shape: "square" as Shape })),
  soft: [
    { at: 0, freq: 659.25, dur: 0.9, gain: 0.45, shape: "sine" },
    { at: 0.28, freq: 880, dur: 1.1, gain: 0.4, shape: "sine" },
  ],
  coin: [
    { at: 0, freq: 987.77, dur: 0.09, gain: 0.4, shape: "tri" },
    { at: 0.09, freq: 1318.5, dur: 0.55, gain: 0.4, shape: "tri" },
  ],
};

function wave(shape: Shape, phase: number): number {
  const s = Math.sin(phase);
  switch (shape) {
    case "square":
      // Смягчённый меандр: без щелчков и режущих верхов.
      return Math.tanh(s * 3) * 0.8;
    case "tri":
      return (2 / Math.PI) * Math.asin(s);
    case "bell":
      return s + 0.45 * Math.sin(phase * 2.76) + 0.25 * Math.sin(phase * 5.4);
    case "marimba":
      return s + 0.3 * Math.sin(phase * 4);
    default:
      return s;
  }
}

function envelope(shape: Shape, t: number, dur: number): number {
  const attack = shape === "sine" ? 0.02 : 0.004;
  if (t < attack) return t / attack;
  if (shape === "bell" || shape === "marimba" || shape === "tri") {
    // Удар: быстрый спад, как у колокола/пластины.
    return Math.exp(-(t - attack) * (shape === "marimba" ? 9 : shape === "tri" ? 6 : 3.5));
  }
  // Ровный тон с плавным хвостом — без щелчка в конце.
  const release = Math.min(0.08, dur / 3);
  return t > dur - release ? Math.max(0, (dur - t) / release) : 1;
}

export function renderScore(notes: Note[]): Float32Array {
  const total = Math.max(...notes.map((n) => n.at + n.dur)) + 0.05;
  const out = new Float32Array(Math.ceil(total * RATE));
  for (const note of notes) {
    const start = Math.floor(note.at * RATE);
    const len = Math.floor(note.dur * RATE);
    for (let i = 0; i < len && start + i < out.length; i += 1) {
      const t = i / RATE;
      const w =
        wave(note.shape, 2 * Math.PI * note.freq * t) +
        (note.freq2 ? wave(note.shape, 2 * Math.PI * note.freq2 * t) : 0);
      out[start + i] += w * envelope(note.shape, t, note.dur) * note.gain * (note.freq2 ? 0.5 : 1);
    }
  }
  // Нормируем пик, чтобы все мелодии звучали примерно одинаково громко.
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) for (let i = 0; i < out.length; i += 1) out[i] = (out[i] / peak) * 0.8;
  return out;
}

export function encodeWav(samples: Float32Array, rate = RATE): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // моно
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return buffer;
}

const urls = new Map<string, string>();

/** Ссылка на WAV мелодии (blob:, одна на вкладку). null — это не синтезируемая мелодия. */
export function synthOrderSoundUrl(preset: OrderSoundPreset): string | null {
  if (preset === "default" || preset === "custom") return null;
  const score = SCORES[preset];
  if (!score) return null;
  const cached = urls.get(preset);
  if (cached) return cached;
  if (typeof Blob === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) return null;
  const url = URL.createObjectURL(new Blob([encodeWav(renderScore(score))], { type: "audio/wav" }));
  urls.set(preset, url);
  return url;
}
