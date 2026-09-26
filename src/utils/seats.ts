import type { WorkspaceMember } from "@/types";

/**
 * Предел мест компании (SaaS: `rows_workspaces.seats_limit`, ставит
 * администратор платформы). Считаются АКТИВНЫЕ участники с аккаунтом;
 * приглашённые по почте, но ещё не вошедшие, — тоже занимают место, иначе
 * предел обходился бы пачкой приглашений.
 *
 * Держится на клиенте: правила Firestore не видят Supabase, а копия прав в
 * Supabase пишется сверкой, и запрет там сломал бы её. Граница честная —
 * администратор платформы видит число участников в «Платформе».
 */
export function seatsUsed(members: readonly WorkspaceMember[]): number {
  return members.filter((m) => m.status === "active" || m.status === "invited").length;
}

export interface SeatsState {
  used: number;
  limit: number | null;
  /** Свободных мест (null — предела нет). */
  free: number | null;
  full: boolean;
}

export function seatsState(members: readonly WorkspaceMember[], limit: number | null | undefined): SeatsState {
  const used = seatsUsed(members);
  const lim = typeof limit === "number" && limit > 0 ? limit : null;
  return { used, limit: lim, free: lim === null ? null : Math.max(0, lim - used), full: lim !== null && used >= lim };
}

export class SeatsLimitError extends Error {
  constructor(limit: number) {
    super(`Достигнут предел мест — ${limit}. Чтобы добавить людей, попросите Nova увеличить предел.`);
    this.name = "SeatsLimitError";
  }
}

/** Бросает, если ещё один человек не влезает в предел. */
export function assertSeatAvailable(members: readonly WorkspaceMember[], limit: number | null | undefined): void {
  const state = seatsState(members, limit);
  if (state.full && state.limit !== null) throw new SeatsLimitError(state.limit);
}
