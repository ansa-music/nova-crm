/**
 * «Три полосы» — игра для перерыва (просьба Nurba 13.10.2026: «убери змейку,
 * сделай простую игру, где надо уворачиваться: налево, направо и центр — три
 * дорожки, и рейтинг среди тех, кто играл»).
 *
 * Здесь только правила — без React и canvas, чтобы их можно было проверить
 * отдельно. Игрок стоит внизу на одной из трёх полос, сверху едут ряды
 * блоков; ряд закрывает одну или две полосы, никогда все три. Смена полосы
 * мгновенная. Очко — за каждый пройденный ряд, скорость растёт со счётом.
 *
 * ЧЕСТНОСТЬ. У каждого ряда есть «свободная» полоса, и у соседних рядов она
 * отличается не больше чем на одну — тому, кто стоит на свободной полосе
 * ряда, до следующего нужен один шаг. Расстояние между рядами считается от
 * скорости так, чтобы «окно» (предыдущий ряд уже ушёл с игрока, следующий ещё
 * не дошёл) длилось не меньше `windowSecFor(score)`: без этого на большой
 * скорости шаг в только что освободившуюся полосу требовал бы попасть в
 * десятую долю секунды. Проверено ботом: без задержки и с реакцией 250 мс он
 * проходит 400 рядов на 200 раскладах, с реакцией 400 мс — проигрывает около
 * 45-го ряда.
 */

export const LANES = 3;
export const FIELD_W = 300;
export const FIELD_H = 400;
export const LANE_W = FIELD_W / LANES;
export const BLOCK_H = 40;
export const PLAYER_H = 44;
/** Верх игрока. */
export const PLAYER_Y = FIELD_H - PLAYER_H - 20;
/** Столкновение считается по рамке чуть меньше нарисованной — касание краем прощается. */
const HIT_SLACK = 4;

const BASE_SPEED = 170;
const SPEED_STEP = 5;
const MAX_SPEED = 450;
const START_WINDOW_SEC = 0.75;
const WINDOW_STEP_SEC = 0.008;
const MIN_WINDOW_SEC = 0.32;
/** Шаг расчёта не длиннее этого: вкладка проснулась — игра не «телепортирует» блоки сквозь игрока. */
export const MAX_STEP_MS = 50;

export interface LaneWave {
  /** Верх ряда (px от верха поля). */
  y: number;
  /** Какие полосы закрыты. */
  blocked: boolean[];
  /** Полоса, которая в этом ряду точно свободна. */
  safe: number;
  /** Ряд уже посчитан в счёт. */
  passed: boolean;
}

export interface LaneGameState {
  /** Полоса игрока: 0 — левая, 1 — центр, 2 — правая. */
  lane: number;
  waves: LaneWave[];
  score: number;
  dead: boolean;
  /** Сколько поле проехало (px) — для бегущей разметки. */
  distance: number;
}

export function createLaneGame(): LaneGameState {
  return { lane: 1, waves: [], score: 0, dead: false, distance: 0 };
}

/** Скорость рядов, px/с. */
export function speedFor(score: number): number {
  return Math.min(MAX_SPEED, BASE_SPEED + Math.max(0, score) * SPEED_STEP);
}

/** Сколько секунд игрок может менять полосу между рядами. */
export function windowSecFor(score: number): number {
  return Math.max(MIN_WINDOW_SEC, START_WINDOW_SEC - Math.max(0, score) * WINDOW_STEP_SEC);
}

/** Расстояние между верхами соседних рядов, px. */
export function gapFor(score: number): number {
  return BLOCK_H + PLAYER_H + speedFor(score) * windowSecFor(score);
}

/** Следующий ряд: свободная полоса — не дальше шага от прежней; закрыта одна или обе остальные. */
export function nextWave(prevSafe: number, score: number, random: () => number, y: number): LaneWave {
  const step = Math.floor(random() * 3) - 1;
  const safe = Math.min(LANES - 1, Math.max(0, prevSafe + step));
  const others = [0, 1, 2].filter((lane) => lane !== safe);
  // Два блока в ряду — чаще с ростом счёта.
  const both = random() < Math.min(0.7, 0.2 + Math.max(0, score) * 0.02);
  const blocked = [false, false, false];
  if (both) {
    for (const lane of others) blocked[lane] = true;
  } else {
    blocked[others[Math.floor(random() * others.length)]] = true;
  }
  return { y, blocked, safe, passed: false };
}

/** Ряд сейчас на высоте игрока (с поблажкой на край). */
export function waveOverlapsPlayer(wave: LaneWave): boolean {
  return wave.y + BLOCK_H > PLAYER_Y + HIT_SLACK && wave.y < PLAYER_Y + PLAYER_H - HIT_SLACK;
}

function hits(state: LaneGameState): boolean {
  return state.waves.some((wave) => wave.blocked[state.lane] && waveOverlapsPlayer(wave));
}

/** Игрок встаёт на полосу. Шагнул в блок — проиграл. */
export function moveToLane(state: LaneGameState, lane: number): void {
  if (state.dead) return;
  state.lane = Math.min(LANES - 1, Math.max(0, Math.round(lane)));
  if (hits(state)) state.dead = true;
}

/** Один шаг игры на `dtMs` миллисекунд (меняет `state`). */
export function stepLaneGame(state: LaneGameState, dtMs: number, random: () => number): void {
  if (state.dead) return;
  const dt = Math.min(MAX_STEP_MS, Math.max(0, dtMs)) / 1000;
  const shift = speedFor(state.score) * dt;
  state.distance += shift;
  for (const wave of state.waves) wave.y += shift;
  if (hits(state)) {
    state.dead = true;
    return;
  }
  for (const wave of state.waves) {
    if (!wave.passed && wave.y >= PLAYER_Y + PLAYER_H) {
      wave.passed = true;
      state.score += 1;
    }
  }
  while (state.waves.length > 0 && state.waves[0].y > FIELD_H) state.waves.shift();
  // Новые ряды — сверху, на расстоянии `gap` от последнего.
  for (;;) {
    const last = state.waves[state.waves.length - 1];
    const y = last ? last.y - gapFor(state.score) : -BLOCK_H;
    if (last && y < -BLOCK_H) break;
    state.waves.push(nextWave(last ? last.safe : state.lane, state.score, random, y));
    if (!last) break;
  }
}
