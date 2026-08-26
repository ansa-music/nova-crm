/**
 * One row in the cross-manager leaderboard. Written ONLY by the page's own
 * responsible person (or the Owner) — enforced in firestore.rules by
 * checking the actual page doc's responsibleUserId, so nobody can spoof
 * another page's numbers. Readable by every member, which is the whole
 * point: it lets everyone see how pages compare without ever granting read
 * access to each other's actual row data.
 */
export interface LeaderboardEntry {
  pageId: string;
  pageName: string;
  responsibleUserId: string;
  doneTotal: number;
  grandTotal: number;
  percent: number;
  /** Piece counts, not money. Optional on old docs until a dashboard write. */
  openCount?: number;
  doneCount?: number;
  updatedAt: number;
}
