/**
 * How a status counts on the «Технари» screen:
 * free — done/closed, doesn't occupy the Технар;
 * busy — work in progress;
 * rework — «Переделка»: shown next to the state with its count, not busy;
 * freeze — «Заморозка»: shown next to the state with its count, not busy.
 */
export type TechLoadKind = "free" | "busy" | "rework" | "freeze";

/**
 * Per-desk order counts for the current month's tab — the privacy-preserving
 * aggregate the «Технари» screen reads instead of anyone's rows (same idea as
 * the leaderboard). Written by whoever has the desk's rows open with edit
 * rights (the Технар themselves, the Owner); readable by every member.
 * Doc id = pageId.
 */
export interface DeskLoad {
  pageId: string;
  workspaceId: string;
  responsibleUserId: string;
  /** "YYYY-MM" — counts from any other month are ignored. */
  monthKey: string;
  subPageId: string;
  /** Orders = rows with at least one filled cell. */
  total: number;
  /**
   * Orders per RAW status cell value (option value, or a legacy label).
   * Raw, not classified: the Owner can re-map statuses later without every
   * desk having to republish. Empty status → NO_STATUS_KEY.
   */
  statusCounts: Record<string, number>;
  updatedAt: number;
  updatedBy: string;
}
