/**
 * How a status counts on the «Технари» screen:
 * free — done/closed, doesn't occupy the Технар;
 * busy — work in progress;
 * rework — «Переделка»: shown next to the state with its count, not busy;
 * freeze — «Заморозка»: shown next to the state with its count, not busy;
 * payment — «Ждём оплату»: work is done, money isn't in yet — its own green
 *   count, not busy.
 */
export type TechLoadKind = "free" | "busy" | "rework" | "freeze" | "payment";

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
  /**
   * Orders per ОС this month, keyed by the «Ответственный» option value the
   * Технар picked in the order's ОС column (an ОС nick is such an option).
   * Absent on docs published before ОС nicks existed.
   */
  osCounts?: Record<string, number>;
  /** The same orders per ОС, split by raw status like `statusCounts`. */
  osStatusCounts?: Record<string, Record<string, number>>;
  /**
   * Day (UTC midnight, ms) of the newest order from each ОС — created or last
   * edited. Kept for a while after the order leaves the month tab, so an ОС
   * can still rate right after the month rolls over. firestore.rules reads it
   * before letting an ОС rate this desk's Технар (OS_RATING_WINDOW_MS).
   */
  osLastOrderAt?: Record<string, number>;
  updatedAt: number;
  updatedBy: string;
}

/** One of an ОС's orders, as the desk publishes it for that ОС to see. */
export interface OsOrderItem {
  rowId: string;
  /** First text column («Клиент»/«Название»); may be empty. */
  title: string;
  /** Raw status cell value (option value or a legacy label); "" when none. */
  status: string;
  /** Order date column (ms) when the desk has one and it's filled. */
  date: number | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * This month's orders from one ОС on one desk. Readable by that ОС only
 * (members.osNickValue == osValue) and by the Owner — never by a Тимлид
 * or another ОС. Doc id `${pageId}_${osValue}`. Written by the desk
 * next to its DeskLoad; the ОС screen trusts it only while
 * deskLoad.osCounts[osValue] > 0 for the same month tab, so a stale doc
 * from an ОС whose orders were all reassigned never shows.
 */
export interface OsOrders {
  pageId: string;
  workspaceId: string;
  responsibleUserId: string;
  osValue: string;
  monthKey: string;
  subPageId: string;
  orders: OsOrderItem[];
  updatedAt: number;
  updatedBy: string;
}
