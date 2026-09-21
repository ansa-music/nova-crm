import { onSnapshot, setDoc, type FirestoreError } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths, withErrorReporting } from "@/firebase/firestore";
import {
  CUSTOM_SCHEDULE_GROUP_ID,
  DEFAULT_CUSTOM_GROUP_NAME,
  type ScheduleGroup,
  type SchedulePerson,
} from "@/types";

/** Документа может не быть — пока в свой раздел никого не добавили. */
export function subscribeScheduleGroup(
  workspaceId: string,
  onData: (group: ScheduleGroup | null) => void,
  onError?: (error: FirestoreError) => void
) {
  if (!db) {
    onData(null);
    return () => {};
  }
  return onSnapshot(
    paths.scheduleGroup(workspaceId, CUSTOM_SCHEDULE_GROUP_ID),
    (snapshot) =>
      onData(snapshot.exists() ? { ...(snapshot.data() as ScheduleGroup), id: snapshot.id } : null),
    withErrorReporting(onError)
  );
}

/**
 * Пишем документ ЦЕЛИКОМ, а не по полям: правило проверяет `hasOnly` ровно
 * по этому набору ключей, и частичный merge разошёлся бы с ним при первой
 * же записи в пустой раздел (создание — это тот же вызов).
 */
export async function saveScheduleGroup(input: {
  workspaceId: string;
  name: string;
  people: SchedulePerson[];
  actorUid: string;
}) {
  if (!db) throw new Error("Firebase не настроен");
  const name = input.name.trim() || DEFAULT_CUSTOM_GROUP_NAME;
  await setDoc(paths.scheduleGroup(input.workspaceId, CUSTOM_SCHEDULE_GROUP_ID), {
    workspaceId: input.workspaceId,
    name,
    people: input.people,
    updatedAt: Date.now(),
    updatedBy: input.actorUid,
  });
}
