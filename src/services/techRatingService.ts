import { deleteDoc, onSnapshot, setDoc, updateDoc, type FirestoreError } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths, withErrorReporting } from "@/firebase/firestore";
import type { TechRating } from "@/types";

export function techRatingId(osUid: string, technicianUid: string) {
  return `${osUid}_${technicianUid}`;
}

/** Live while «Технари» is open — a small collection, one doc per ОС per Технар. */
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
 * First rating creates the pair's doc (rules demand a recent order from this
 * ОС on `pageId`); every later change only touches the stars.
 */
export async function rateTechnician(input: {
  workspaceId: string;
  osUid: string;
  technicianUid: string;
  stars: number;
  osValue: string;
  pageId: string;
  existing: TechRating | null;
}) {
  if (!db) return;
  const stars = Math.max(1, Math.min(5, Math.round(input.stars)));
  const ref = paths.techRating(input.workspaceId, techRatingId(input.osUid, input.technicianUid));
  const now = Date.now();
  if (input.existing) {
    await updateDoc(ref, { stars, updatedAt: now });
    return;
  }
  const rating: Omit<TechRating, "id"> = {
    workspaceId: input.workspaceId,
    osUid: input.osUid,
    technicianUid: input.technicianUid,
    stars,
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
