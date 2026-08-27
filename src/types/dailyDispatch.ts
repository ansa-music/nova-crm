export interface DailyDispatch {
  id: string;
  workspaceId: string;
  checkNo: string;
  /** Snapshot of the roster nickname at the moment this entry was created — kept readable even if the roster entry is later renamed or deleted. */
  technicianName: string;
  /** The DispatchTechnician roster entry this was assigned through — never a raw member pick, see DispatchTechnician below. */
  technicianRosterId: string | null;
  technicianUid: string | null;
  /** Order price, KZT. 0 when not filled in. */
  amount: number;
  /** Ordered video length in minutes. Null when not filled in — distinct from 0. */
  minutes: number | null;
  /** Free text — which character(s) the order is for. */
  character: string;
  /** "ОС" — value, not free text: always one of the workspace's shared "Ответственный" options. */
  os: string;
  /** Bound technician desk. Stored on this doc only — never mutates desk rows. */
  linkedPageId: string | null;
  linkedPageName: string | null;
  /**
   * Set only when technicianUid is present at creation — the bound account
   * has a real order request waiting on their own desk to accept. Absent
   * (not just "pending") for entries whose technician isn't linked to a
   * real account yet, so old/unlinked rows don't show as stuck requests.
   */
  requestStatus: "pending" | "accepted" | null;
  acceptedAt: number | null;
  /** Row created on the technician desk from this order. Null until written. */
  sheetRowId: string | null;
  dayKey: string;
  marks: Record<string, true>;
  createdAt: number;
  createdBy: string;
}

/**
 * Admin-curated technician roster, scoped to the workspace. Exists so
 * dispatch entries are assigned by a name the shop actually uses out loud
 * ("Айбек", "новенький") rather than by hunting through real accounts'
 * self-chosen nicknames or emails. memberUid is set only once someone
 * manually links the entry to a real account — an unlinked nickname is
 * still usable for entries (technicianUid stays null on them), just
 * without the accept-request flow, since there's no account to notify.
 */
export interface DispatchTechnician {
  id: string;
  workspaceId: string;
  nickname: string;
  memberUid: string | null;
  /**
   * Owner-configured destination desk for this nick.
   * "own" = the bound account's own desk (responsibleUserId === memberUid).
   * A page id = that specific desk, still only written if it belongs to the technician.
   * Null = not configured.
   */
  deskTarget: "own" | string | null;
  /**
   * Column keys on the destination sheet. All five must be set before
   * Accept auto-writes a row. Never inferred from column labels.
   */
  columnMap: DispatchColumnMap | null;
  createdAt: number;
  createdBy: string;
  updatedAt: number;
}

/** Keys are PageColumn.key on the destination sheet (current-month tab when the desk hides Основная). */
export interface DispatchColumnMap {
  checkNo: string;
  amount: string;
  minutes: string;
  character: string;
  os: string;
}

export function isDispatchColumnMapComplete(
  map: DispatchColumnMap | null | undefined
): map is DispatchColumnMap {
  return Boolean(map?.checkNo && map?.amount && map?.minutes && map?.character && map?.os);
}
