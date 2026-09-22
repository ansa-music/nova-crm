import { onSnapshot, runTransaction, setDoc, type FirestoreError } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths, withErrorReporting } from "@/firebase/firestore";
import { WEEK_TEMPLATE_DOC_ID, type WeekTemplate } from "@/types/scheduleTemplate";
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

/** «алия » и «Алия» — один и тот же ник; сравниваем нормализованно. */
function sameNick(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = (a ?? "").trim().toLowerCase();
  const right = (b ?? "").trim().toLowerCase();
  return Boolean(left) && left === right;
}

/**
 * Ник ОС закрепили за живым аккаунтом — переносим на него строку графика из
 * своего раздела: неделя человека переезжает под его uid, а «ожидающая»
 * строка исчезает.
 *
 * Одной транзакцией по двум документам: иначе при сбое посередине человек
 * остался бы и в разделе, и на аккаунте — с ДВУМЯ строками в графике и двумя
 * разными неделями.
 *
 * `appliedThrough` у перенесённой недели снимаем: месяцы уже разложены на
 * старый `ext_`-id, и автопилот должен разложить их заново под новый uid.
 * Сами месячные документы `techSchedule/{ext_…}` не переносим — id там по
 * uid, а неделя всё равно ляжет сверху; прошлые дни остаются историей
 * «ожидающего» и в графике аккаунта не появятся.
 */
export async function bindScheduleGroupPersonToMember(input: {
  workspaceId: string;
  memberUid: string;
  osNickLabel: string;
  actorUid: string;
}): Promise<string | null> {
  if (!db) return null;
  const groupRef = paths.scheduleGroup(input.workspaceId, CUSTOM_SCHEDULE_GROUP_ID);
  const weekRef = paths.scheduleTemplate(input.workspaceId, WEEK_TEMPLATE_DOC_ID);
  return runTransaction(db, async (tx) => {
    const groupSnap = await tx.get(groupRef);
    if (!groupSnap.exists()) return null;
    const group = groupSnap.data() as ScheduleGroup;
    const person = (group.people ?? []).find(
      (p) => sameNick(p.osNick, input.osNickLabel) || sameNick(p.name, input.osNickLabel)
    );
    if (!person) return null;

    const weekSnap = await tx.get(weekRef);
    const week = weekSnap.exists() ? (weekSnap.data() as WeekTemplate) : null;
    const entry = week?.people?.[person.id];
    if (week && entry) {
      const people = { ...week.people };
      delete people[person.id];
      const { appliedThrough: _applied, ...rest } = entry;
      people[input.memberUid] = rest;
      tx.set(
        weekRef,
        {
          workspaceId: input.workspaceId,
          people,
          updatedAt: Date.now(),
          updatedBy: input.actorUid,
        }
      );
    }

    tx.set(groupRef, {
      workspaceId: input.workspaceId,
      name: group.name,
      people: (group.people ?? []).filter((p) => p.id !== person.id),
      updatedAt: Date.now(),
      updatedBy: input.actorUid,
    });
    return person.name;
  });
}
