import { supabaseRows } from "@/lib/supabaseRows";
import { isSbMissingError } from "@/services/sb/sbCollections";
import type { Workspace } from "@/types";

/**
 * Рейтинг игры для перерыва — в Supabase (`game_scores`,
 * supabase/migrations/20261047_game_scores.sql). Одна строка на человека:
 * лучший счёт и число партий; читает любой участник workspace, пишет только
 * функция `game_submit_score` (uid берёт из токена, держит максимум).
 *
 * Рейтинг есть там, где строки таблиц живут в Supabase: только тогда ведётся
 * копия прав rows_*, по которой политика узнаёт участника. В остальных
 * workspace и пока SQL не накатан — игра работает как раньше, с личным
 * рекордом на устройстве; всё здесь возвращает `null` и никогда не бросает.
 */

/** Код игры «три полосы» в таблице рейтинга. */
export const LANES_GAME = "lanes";

/** Сколько мест читаем: рейтинг показывает верх списка и строку самого игрока. */
const BOARD_LIMIT = 200;

export interface GameScoreRow {
  uid: string;
  best: number;
  plays: number;
  /** Когда поставлен рекорд, мс; null — не разобрать. */
  bestAt: number | null;
}

/** Есть ли у этого workspace общий рейтинг (копия прав в Supabase). */
export function gameBoardAvailable(workspace: Pick<Workspace, "rowsBackend"> | null | undefined): boolean {
  return workspace?.rowsBackend === "supabase";
}

function warn(what: string, error: unknown) {
  // «SQL ещё не накатан» — ожидаемо, не шумим.
  if (!isSbMissingError(error)) console.warn(`[игра] ${what}`, error);
}

/**
 * Рейтинг workspace: выше — больший счёт, при равном — кто набрал раньше.
 * `null` — рейтинга нет (SQL не накатан, нет связи, отказ).
 */
export async function fetchGameBoard(workspaceId: string, game: string = LANES_GAME): Promise<GameScoreRow[] | null> {
  try {
    const { data, error } = await supabaseRows
      .from("game_scores")
      .select("uid,best,plays,best_at")
      .eq("workspace_id", workspaceId)
      .eq("game", game)
      .order("best", { ascending: false })
      .order("best_at", { ascending: true })
      .limit(BOARD_LIMIT);
    if (error) {
      warn("рейтинг не прочитан", error);
      return null;
    }
    const rows: GameScoreRow[] = [];
    for (const raw of Array.isArray(data) ? (data as Array<Record<string, unknown>>) : []) {
      const uid = typeof raw.uid === "string" ? raw.uid : "";
      const best = Number(raw.best);
      if (!uid || !Number.isFinite(best)) continue;
      const at = typeof raw.best_at === "string" ? Date.parse(raw.best_at) : NaN;
      rows.push({ uid, best, plays: Number(raw.plays) || 0, bestAt: Number.isFinite(at) ? at : null });
    }
    return rows;
  } catch (error) {
    warn("рейтинг не прочитан", error);
    return null;
  }
}

/**
 * Счёт партии — в рейтинг. Возвращает рекорд и число партий, как их видит
 * база; `null` — не записалось (рейтинга нет, человек не в копии прав, сеть).
 */
export async function submitGameScore(
  workspaceId: string,
  score: number,
  game: string = LANES_GAME
): Promise<{ best: number; plays: number } | null> {
  if (!Number.isFinite(score) || score < 0) return null;
  try {
    const { data, error } = await supabaseRows.rpc("game_submit_score", {
      p_workspace: workspaceId,
      p_game: game,
      p_score: Math.floor(score),
    });
    if (error) {
      warn("счёт не записан", error);
      return null;
    }
    const row = (Array.isArray(data) ? data[0] : data) as { best?: unknown; plays?: unknown } | null | undefined;
    const best = Number(row?.best);
    if (!row || !Number.isFinite(best)) return null;
    return { best, plays: Number(row.plays) || 0 };
  } catch (error) {
    warn("счёт не записан", error);
    return null;
  }
}
