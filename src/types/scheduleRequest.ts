/**
 * Запрос на отметку в графике: «я вышел в свой выходной, отметьте меня».
 * Лежит в `workspaces/{ws}/scheduleRequests/{uid}_{monthKey}_{день}`.
 *
 * Сам график технарь и ОС не правят — иначе выходной, поставленный Тимлидом,
 * перебивался бы кем угодно. Но сказать «я работал» они должны уметь, поэтому
 * запрос отдельным документом: человек его создаёт, руководство подтверждает,
 * и только подтверждение пишет отметку в график.
 */
export type ScheduleRequestStatus = "pending" | "approved" | "declined";

export interface ScheduleRequest {
  id: string;
  workspaceId: string;
  uid: string;
  /** Имя на момент запроса — чтобы список читался без ростера участников. */
  name: string;
  monthKey: string;
  dayKey: string;
  status: ScheduleRequestStatus;
  createdAt: number;
  resolvedAt?: number | null;
  resolvedBy?: string | null;
}

/** Один запрос на человека и день: повторный перезапишет старый, а не размножит. */
export function scheduleRequestId(uid: string, monthKey: string, dayKey: string): string {
  return `${uid}_${monthKey}_${dayKey}`;
}
