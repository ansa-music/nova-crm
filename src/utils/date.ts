import { formatDistanceToNow, format } from "date-fns";
import { ru } from "date-fns/locale";

export function timeAgo(timestamp: number): string {
  return formatDistanceToNow(new Date(timestamp), { addSuffix: true, locale: ru });
}

export function formatDate(timestamp: number, pattern = "d MMM yyyy, HH:mm"): string {
  return format(new Date(timestamp), pattern, { locale: ru });
}
