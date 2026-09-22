import { deleteDoc, onSnapshot, query, setDoc, updateDoc, where, type FirestoreError } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths, withErrorReporting } from "@/firebase/firestore";
import { previousMonthKey } from "@/services/monthTabService";
import { almatyNoonMillis } from "@/utils/date";
import type { TechRating } from "@/types";

export function techRatingId(osUid: string, technicianUid: string, monthKey: string) {
  return `${osUid}_${technicianUid}_${monthKey}`;
}

/** 00:00 первого числа месяца ПЕРЕД `monthKey` по Алматы (UTC+5, без летнего времени). */
function previousMonthStartMillis(monthKey: string): number {
  const [year, month] = previousMonthKey(monthKey).split("-").map(Number);
  return almatyNoonMillis(year, month - 1, 1) - 12 * 60 * 60 * 1000;
}

/**
 * Live while «Технари» or «Дашборд» is open. Одна оценка на пару ОС×Технарь
 * В МЕСЯЦ — коллекция растёт каждый месяц, а оба экрана показывают только
 * текущий месяц и закреплённый итог прошлого. Поэтому читаем лишь оценки с
 * начала прошлого месяца: без границы каждая подписка на Spark оплачивала бы
 * всю историю оценок целиком.
 *
 * Граница по `createdAt`, а не по `monthKey`: у оценок, поставленных до
 * перехода на помесячные, поля monthKey нет, и их месяц — месяц createdAt
 * (`ratingMonthKey`). У помесячных createdAt не раньше начала их месяца
 * (документ заводится первой оценкой В ЭТОМ месяце), так что ни одна оценка
 * текущего или прошлого месяца за границу не выпадает. Один диапазон по
 * одному полю — хватает автоматического индекса, составной не нужен.
 * `monthKey` — текущий месяц экрана: сменился месяц — хук переподписывается.
 */
export function subscribeTechRatings(
  workspaceId: string,
  monthKey: string,
  onData: (ratings: TechRating[]) => void,
  onError?: (error: FirestoreError) => void
) {
  if (!db) {
    onData([]);
    return () => {};
  }
  return onSnapshot(
    query(paths.techRatings(workspaceId), where("createdAt", ">=", previousMonthStartMillis(monthKey))),
    (snapshot) => onData(snapshot.docs.map((d) => ({ ...(d.data() as TechRating), id: d.id }))),
    withErrorReporting(onError)
  );
}

/**
 * Первая оценка в месяце создаёт документ пары за ЭТОТ месяц (правила
 * требуют свежий заказ этого ОС на `pageId`); дальше внутри месяца меняются
 * только звёзды.
 */
export async function rateTechnician(input: {
  workspaceId: string;
  osUid: string;
  technicianUid: string;
  stars: number;
  osValue: string;
  pageId: string;
  monthKey: string;
  existing: TechRating | null;
}) {
  if (!db) return;
  const stars = Math.max(1, Math.min(5, Math.round(input.stars)));
  // Оценка этого месяца — своя запись. Прошлый месяц уже закрыт и правкой
  // звёзд не меняется: он висит на дашборде как итог.
  const ref = paths.techRating(
    input.workspaceId,
    techRatingId(input.osUid, input.technicianUid, input.monthKey)
  );
  const now = Date.now();
  // Менять звёзды можно только у документа ЭТОГО месяца. Оценки, стоявшие до
  // перехода на помесячные, лежат под старым id без месяца — для них
  // `existing` найдётся (ростер оценок фильтруется по месяцу, а не по форме
  // id), но updateDoc ушёл бы в несуществующий документ и упал бы «No
  // document to update». Такой случай — это первая оценка в новом формате.
  if (input.existing && input.existing.id === ref.id) {
    await updateDoc(ref, { stars, updatedAt: now });
    return;
  }
  const rating: Omit<TechRating, "id"> = {
    workspaceId: input.workspaceId,
    osUid: input.osUid,
    technicianUid: input.technicianUid,
    stars,
    monthKey: input.monthKey,
    osValue: input.osValue,
    pageId: input.pageId,
    createdAt: now,
    updatedAt: now,
  };
  await setDoc(ref, rating);
}

/** Owner/Тимлид only — removing an unfair rating. */
export async function deleteTechRating(workspaceId: string, ratingId: string) {
  if (!db) return;
  await deleteDoc(paths.techRating(workspaceId, ratingId));
}
