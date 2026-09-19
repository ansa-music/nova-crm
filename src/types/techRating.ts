/**
 * An ОС's rating of a Технар for ONE MONTH: doc id
 * `${osUid}_${technicianUid}_${monthKey}`, 1–5 stars, changeable any time
 * within that month. Creating one needs a recent order from this
 * ОС on the Технар's desk — firestore.rules checks the desk's DeskLoad
 * (`osLastOrderAt`) against the ОС nick on the rater's member doc.
 */
export interface TechRating {
  id: string;
  workspaceId: string;
  osUid: string;
  technicianUid: string;
  stars: number;
  /** «YYYY-MM» по Алматы. Оценки живут месяцами: в новом месяце всё начинается заново. */
  monthKey: string;
  /** The rater's ОС nick option value at the time of the first rating. */
  osValue: string;
  /** Desk whose DeskLoad showed the recent order. */
  pageId: string;
  createdAt: number;
  updatedAt: number;
}

export const TECH_RATING_MAX = 5;

/**
 * Месяц оценки. У документов, созданных до перехода на помесячные оценки,
 * поля нет — они относятся к тому месяцу, когда их поставили, а не к
 * текущему: иначе вся прошлая история разом «переехала» бы в этот месяц и
 * сломала ровно тот смысл, ради которого месяцы и вводятся.
 */
export function ratingMonthKey(rating: { monthKey?: string; createdAt?: number }, fallbackMonthKey: string): string {
  if (rating.monthKey) return rating.monthKey;
  return rating.createdAt ? monthKeyOfMillis(rating.createdAt) : fallbackMonthKey;
}

/** «YYYY-MM» по Алматы из миллисекунд — без импорта сервисов, чтобы типы ни от чего не зависели. */
export function monthKeyOfMillis(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Almaty",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(ms));
  const year = parts.find((p) => p.type === "year")?.value ?? "1970";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${year}-${month}`;
}
