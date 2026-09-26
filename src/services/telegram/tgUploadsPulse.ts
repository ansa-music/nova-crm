/**
 * Сводка отправок в Telegram для остального сайта — без библиотеки
 * Telegram. Отправка идёт, пока открыта вкладка, и переход на другую
 * страницу Nova её не прерывает: пилюля в каркасе показывает прогресс и
 * ведёт обратно в раздел. Пишет её только tgClient.ts.
 */
export interface TgUploadsPulse {
  /** Сколько файлов сейчас уходит. */
  active: number;
  /** Общий прогресс активных, 0..1. */
  progress: number;
  /** Чат первой идущей отправки — пилюля ведёт прямо в него. */
  chatId: number | null;
}

let pulse: TgUploadsPulse = { active: 0, progress: 0, chatId: null };
const listeners = new Set<() => void>();

export function tgUploadsPulse(): TgUploadsPulse {
  return pulse;
}

export function subscribeTgUploadsPulse(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function setTgUploadsPulse(next: TgUploadsPulse) {
  if (next.active === pulse.active && next.chatId === pulse.chatId && Math.abs(next.progress - pulse.progress) < 0.005) return;
  pulse = next;
  listeners.forEach((fn) => fn());
}
