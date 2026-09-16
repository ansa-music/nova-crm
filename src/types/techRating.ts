/**
 * An ОС's rating of a Технар: one per pair (doc id `${osUid}_${technicianUid}`),
 * 1–5 stars, changeable any time. Creating one needs a recent order from this
 * ОС on the Технар's desk — firestore.rules checks the desk's DeskLoad
 * (`osLastOrderAt`) against the ОС nick on the rater's member doc.
 */
export interface TechRating {
  id: string;
  workspaceId: string;
  osUid: string;
  technicianUid: string;
  stars: number;
  /** The rater's ОС nick option value at the time of the first rating. */
  osValue: string;
  /** Desk whose DeskLoad showed the recent order. */
  pageId: string;
  createdAt: number;
  updatedAt: number;
}

export const TECH_RATING_MAX = 5;
