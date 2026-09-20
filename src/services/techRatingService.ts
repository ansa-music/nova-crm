import { deleteDoc, onSnapshot, setDoc, updateDoc, type FirestoreError } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths, withErrorReporting } from "@/firebase/firestore";
import type { TechRating } from "@/types";

export function techRatingId(osUid: string, technicianUid: string, monthKey: string) {
  return `${osUid}_${technicianUid}_${monthKey}`;
}

/** Live while «Технари» is open — a small collection, one doc per ОС per Технарь. */
export function subscribeTechRatings(
  workspaceId: string,
  onData: (ratings: TechRating[]) => void,
  onError?: (error: FirestoreError) => void
) {
  if (!db) {
    onData([]);
    return () => {};
  }
  return onSnapshot(
    paths.techRatings(workspaceId),
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
